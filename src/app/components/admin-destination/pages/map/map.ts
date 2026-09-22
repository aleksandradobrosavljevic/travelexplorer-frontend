import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  inject,
  NgZone,
  OnDestroy,
  signal,
  HostListener,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgFor, NgIf } from '@angular/common';
import * as L from 'leaflet';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError, takeUntil } from 'rxjs/operators';
import { of } from 'rxjs';
import { AdminDestinationMapService, MapContext } from './map.service';
import {
  DestinationRecord,
  TouristObjectRecord,
} from '../../shared/admin-destination.models';
import { DestinationBounds, DestinationBoundsService } from '../../shared/destination-bounds.service';
import { ActivatedRoute } from '@angular/router';
import { buildAssetUrl } from '../../../../core/config/api';

type MapCategory = 'all' | 'object' | 'activity' | 'event';
type ContentCategory = Exclude<MapCategory, 'all'>;

interface MapItem {
  key: string;
  id: number;
  name: string;
  category: ContentCategory;
  categoryLabel: string;
  typeName: string;
  latitude: number;
  longitude: number;
  source: string;
  linkedObjectName?: string | null;
  dateLabel?: string | null;
  imageUrl?: string | null;
  address?: string | null;
  averageRating?: number | null;
  reviewCount?: number | null;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  startDatetime?: string | null;
}

interface LocationIssue {
  key: string;
  name: string;
  categoryLabel: string;
}

@Component({
  selector: 'app-admin-destination-map',
  standalone: true,
  imports: [NgIf, NgFor],
  templateUrl: './map.html',
  styleUrl: './map.css',
})
export class AdminDestinationMapComponent implements AfterViewInit, OnDestroy {
  private readonly mapService = inject(AdminDestinationMapService);
  private readonly boundsService = inject(DestinationBoundsService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);

  private map?: L.Map;
  private destinationBounds: DestinationBounds | null = null;
  private readonly contentLayer = L.layerGroup();
  private readonly destinationLayer = L.layerGroup();
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly destroy$ = new Subject<void>();
  private readonly addressSearch$ = new Subject<string>();
  readonly addressFocusedIndex = signal(-1);
  readonly addressFilter = signal('');

  private lastMarkerClickTime = 0;

  private readonly CONTENT_ZOOM = 15;
  private categorySelectTimer: ReturnType<typeof setTimeout> | null = null;
  private isRenderingMarkers = false;

  readonly destination = signal<DestinationRecord | null>(null);
  readonly allItems = signal<MapItem[]>([]);
  readonly locationIssues = signal<LocationIssue[]>([]);
  readonly selectedItem = signal<MapItem | null>(null);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly searchQuery = signal('');
  readonly selectedCategory = signal<MapCategory>('all');
  readonly proximityCenter = signal<{ lat: number; lng: number } | null>(null);
  readonly isFilterOpen = signal(false);

  readonly addressQuery = signal('');
  readonly addressResults = signal<{ label: string; lat: number; lng: number }[]>([]);
  readonly addressLoading = signal(false);
  readonly showAddressResults = signal(false);

  readonly categoryOptions: { value: MapCategory; label: string }[] = [
    { value: 'all',      label: 'All content' },
    { value: 'object',   label: 'Objects' },
    { value: 'activity', label: 'Activities' },
    { value: 'event',    label: 'Events' },
  ];

  readonly selectedCategoryLabel = computed(() => {
    return this.categoryOptions.find(o => o.value === this.selectedCategory())?.label ?? 'All content';
  });

  readonly filteredItems = computed(() => {
    const query = this.normalize(this.searchQuery());
    const addrQuery = this.normalize(this.addressFilter());
    const category = this.selectedCategory();
    const proximity = this.proximityCenter();
    const RADIUS_KM = 1.5;
    const allItems = this.allItems();

    return allItems.filter((item) => {
      const matchesQuery =
        !query ||
        this.normalize(item.name).includes(query) ||
        this.normalize(item.linkedObjectName).includes(query) ||
        this.normalize(item.address).includes(query);
  
      const matchesAddress =
        !addrQuery ||
        this.normalize(item.address).includes(addrQuery) ||
        this.normalize(item.name).includes(addrQuery) ||
        allItems.some(other =>
          this.normalize(other.address).includes(addrQuery) &&
          other.latitude === item.latitude &&
          other.longitude === item.longitude
        );
  
      const matchesCategory = category === 'all' || item.category === category;
  
      const matchesProximity = !proximity || (() => {
        const dLat = (item.latitude - proximity.lat) * Math.PI / 180;
        const dLng = (item.longitude - proximity.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) ** 2 +
                  Math.cos(proximity.lat * Math.PI / 180) *
                  Math.cos(item.latitude * Math.PI / 180) *
                  Math.sin(dLng/2) ** 2;
        const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return km <= RADIUS_KM;
      })();

      return matchesQuery && matchesAddress && matchesCategory && matchesProximity;
    });
  });
  readonly hasActiveFilters = computed(
    () => this.searchQuery() !== '' || this.selectedCategory() !== 'all' || this.addressFilter() !== ''
  );

  readonly filteredIssues = computed(() => {
    const query = this.normalize(this.searchQuery());
    const category = this.selectedCategory();
    const categoryMap: Record<string, ContentCategory> = {
      'Object': 'object',
      'Activity': 'activity',
      'Event': 'event',
    };
    return this.locationIssues().filter((issue) => {
      const matchesQuery =
        !query ||
        this.normalize(issue.name).includes(query) ||
        this.normalize(issue.categoryLabel).includes(query);
      const matchesCategory = category === 'all' || categoryMap[issue.categoryLabel] === category;
      return matchesQuery && matchesCategory;
    });
  });

  toggleFilter(): void {
    this.isFilterOpen.update(v => !v);
  }

  selectCategory(value: string): void {
    if (this.categorySelectTimer) clearTimeout(this.categorySelectTimer);
    this.categorySelectTimer = setTimeout(() => {
      if (this.selectedCategory() === (value as MapCategory)) {
        this.isFilterOpen.set(false);
        return;
      }
  
      const selected = this.selectedItem();
      this.selectedCategory.set(value as MapCategory);
      this.saveStateToSession();
      this.isFilterOpen.set(false);
  
      const stillVisible = selected
        ? (value === 'all' || selected.category === value)
        : false;
  
      if (stillVisible && selected) {
        this.renderMarkers(selected.key);
        this.map?.flyTo([selected.latitude, selected.longitude], this.CONTENT_ZOOM, { duration: 0.7 });
        this.openPopupForSelected();
      } else {
        this.renderMarkers(null);
        setTimeout(() => {
          if (value === 'all') {
            this.fitToFilteredItems(false);
          } else {
            this.fitToFilteredItems(true);
          }
        }, 0);
      }
    }, 10);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const insideControls = target.closest('.map-controls');
    if (!insideControls) {
      this.isFilterOpen.set(false);
      this.showAddressResults.set(false);
    }
  }

  ngAfterViewInit(): void {
    this.initMap();
    this.initAddressSearch();

    setTimeout(() => this.map?.invalidateSize(), 100);

    const resolvedContext = this.route.snapshot.data['mapContext'] as MapContext | null | undefined;
    if (resolvedContext) {
      this.applyContext(resolvedContext);
    } else {
      this.loadMapContext();
    }

    this.boundsService.getBounds().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(b => {
      this.destinationBounds = b;
      this.renderDestinationLayer();
      if (!this.allItems().length) {
        this.fitToCurrentData(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.addressLocalTimer) clearTimeout(this.addressLocalTimer);
    this.map?.remove();
  }

  private initAddressSearch(): void {
    this.addressSearch$.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      switchMap(query => {
        this.addressLoading.set(true);
        return this.mapService.geocode(query).pipe(
          catchError(() => of([]))
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe(results => {
      this.addressResults.set((results as any[]).slice(0, 5));
      this.addressLoading.set(false);
      this.addressFocusedIndex.set(-1);
    });
  }

  private addressLocalTimer: ReturnType<typeof setTimeout> | null = null;

  onAddressSearchChange(value: string): void {
    this.addressQuery.set(value);
    this.selectedCategory.set('all');
  
    if (value.trim().length < 3) {
      this.addressResults.set([]);
      this.showAddressResults.set(false);
      this.addressLoading.set(false);
      this.proximityCenter.set(null);
      this.searchQuery.set('');
      if (this.addressLocalTimer) clearTimeout(this.addressLocalTimer);
      this.addressFilter.set('');
      this.renderMarkers();
      this.fitToCurrentData(true);
      return;
    }
  
    if (this.addressLocalTimer) clearTimeout(this.addressLocalTimer);
    this.addressLocalTimer = setTimeout(() => {
      const normalizedValue = this.normalize(value.trim());
      const localMatches = this.allItems().filter(item =>
        this.normalize(item.address ?? '').includes(normalizedValue) ||
        this.normalize(item.name).includes(normalizedValue)
      );
  
      if (localMatches.length > 0) {
        this.showAddressResults.set(false);
        this.addressResults.set([]);
        this.proximityCenter.set(null);
        this.addressFilter.set(value.trim());
      
        if (localMatches.length === 1) {
          this.map?.flyTo([localMatches[0].latitude, localMatches[0].longitude], 16, { duration: 0.8 });
        } else {
          const bounds = L.latLngBounds(
            localMatches.map(i => [i.latitude, i.longitude] as L.LatLngExpression)
          );
          this.map?.flyToBounds(bounds, { padding: [60, 60], maxZoom: 17, duration: 0.8 });
        }
      
        this.renderMarkers();
      } else {
        this.addressFilter.set('');
        this.showAddressResults.set(true);
        this.addressSearch$.next(value.trim());
      }
    }, 500);
  }

  selectAddress(result: { label: string; lat: number; lng: number }): void {
    if (this.destinationBounds) {
      const leafletBounds = this.boundsService.toLatLngBounds(this.destinationBounds);
      if (!leafletBounds.contains([result.lat, result.lng])) {
        this.errorMessage.set('This address is outside the destination area.');
        setTimeout(() => this.errorMessage.set(null), 4000);
        this.showAddressResults.set(false);
        this.addressResults.set([]);
        this.addressFocusedIndex.set(-1);
        this.addressQuery.set('');
        return;
      }
    }
  
    this.selectedCategory.set('all');
    this.addressQuery.set(result.label);
    this.showAddressResults.set(false);
    this.addressResults.set([]);
    this.addressFocusedIndex.set(-1);
    this.searchQuery.set('');
    this.proximityCenter.set({ lat: result.lat, lng: result.lng });
    this.map?.flyTo([result.lat, result.lng], 15, { duration: 0.8 });
    this.renderMarkers();
    this.saveStateToSession();
  }

  clearAddressSearch(): void {
    if (this.addressLocalTimer) clearTimeout(this.addressLocalTimer);
    this.addressQuery.set('');
    this.addressResults.set([]);
    this.showAddressResults.set(false);
    this.addressLoading.set(false);
    this.proximityCenter.set(null);
    this.searchQuery.set('');
    this.addressFilter.set('');
    this.renderMarkers();
    this.fitToCurrentData(true);
    this.saveStateToSession();
  }

  loadMapContext(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.mapService
      .getMapContext()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (context) => {
          this.applyContext(context);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.errorMessage.set('Map data could not be loaded.');
        },
      });
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.addressQuery.set('');
    this.addressFilter.set('');
    this.proximityCenter.set(null);
    this.addressResults.set([]);
    this.showAddressResults.set(false);
    this.saveStateToSession();
    if (this.addressLocalTimer) clearTimeout(this.addressLocalTimer);
    
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.renderMarkers();
      this.fitToFilteredItems(true);
    }, 250);
  }

  private fitToFilteredItems(animated: boolean): void {
    const items = this.filteredItems();
  
    if (items.length === 0) {
      this.fitToCurrentData(animated);
      return;
    }
  
    if (items.length === 1) {
      this.map?.flyTo(
        [items[0].latitude, items[0].longitude],
        16,
        { duration: animated ? 0.8 : 0.001 }
      );
      return;
    }
  
    const bounds = L.latLngBounds(
      items.map(i => [i.latitude, i.longitude] as L.LatLngExpression)
    );
  
    if (animated) {
      this.map?.flyToBounds(bounds, { padding: [80, 80], maxZoom: 16, duration: 0.8 });
    } else {
      this.map?.fitBounds(bounds, { padding: [80, 80], maxZoom: 16 });
    }
  }

  onFilterChange(type: 'category', value: string): void {
    const selected = this.selectedItem();
    const willBeVisible = selected
      ? (value === 'all' || selected.category === (value as MapCategory))
      : false;

    this.selectedCategory.set(value as MapCategory);

    if (willBeVisible && selected) {
      this.renderMarkers(selected.key);
      this.map?.flyTo([selected.latitude, selected.longitude], this.CONTENT_ZOOM, { duration: 0.7 });
    } else {
      this.selectedItem.set(null);
      this.renderMarkers(null);
      this.fitToFilteredItems(true);
    }
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.selectedCategory.set('all');
    this.addressQuery.set('');
    this.proximityCenter.set(null);
    this.addressResults.set([]);
    this.showAddressResults.set(false);
    if (this.addressLocalTimer) clearTimeout(this.addressLocalTimer);
    this.addressFilter.set('');
    this.renderMarkers();
    this.fitToCurrentData(true);
    this.saveStateToSession();
  }

  closeDetail(): void {
    this.selectedItem.set(null);
    this.renderMarkers(null);
  }

  focusItem(item: MapItem): void {
    this.selectedItem.set(item);
    this.renderMarkers(item.key);
    this.map?.flyTo([item.latitude, item.longitude], this.CONTENT_ZOOM, { duration: 0.7 });
    this.openPopupForSelected();
    this.saveStateToSession();
  }

  categoryCount(category: ContentCategory): number {
    return this.allItems().filter((i) => i.category === category).length;
  }

  trackByKey(_: number, item: { key: string }): string {
    return item.key;
  }

  private initMap(): void {
    this.map = L.map('admin-destination-map', {
      zoomControl: false,
      minZoom: 3,
      maxZoom: 18,
      center: [0, 0],
      zoom: 2,
    });
  
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);
  
    this.destinationLayer.addTo(this.map);
    this.contentLayer.addTo(this.map);
  
    this.map.on('popupclose', () => {
      this.zone.run(() => {
        if (this.isRenderingMarkers) return;
        setTimeout(() => {
          if (this.isRenderingMarkers) return;
          if (Date.now() - this.lastMarkerClickTime < 200) return;
          this.selectedItem.set(null);
          this.renderMarkers(null);
        }, 50);
      });
    });
  }

  private applyContext(context: MapContext): void {
    this.destination.set(context.destination);
    const { items, issues } = this.buildMapItems(context);
    this.allItems.set(items);
    this.locationIssues.set(issues);
    this.renderDestinationLayer();
  
    setTimeout(() => {
      const raw = sessionStorage.getItem('mapState');
  
      if (!raw) {
        this.renderMarkers();
        this.fitToCurrentData(false);
        return;
      }
  
      this.restoreStateFromSession();
  
      const state = JSON.parse(raw);
      const selectedItem = state.selectedKey
        ? this.allItems().find(i => i.key === state.selectedKey) ?? null
        : null;
  
      if (selectedItem) {
        this.selectedItem.set(selectedItem);
        this.renderMarkers(selectedItem.key);
        this.map?.flyTo([selectedItem.latitude, selectedItem.longitude], this.CONTENT_ZOOM, { duration: 0.001 });
        setTimeout(() => this.openPopupForSelected(), 300);
        return;
      }
  
      this.renderMarkers();
      this.filteredItems().length ? this.fitToFilteredItems(false) : this.fitToCurrentData(false);
    }, 0);
  }

  private restoreStateFromSession(): void {
    const raw = sessionStorage.getItem('mapState');
    if (!raw) return;
    try {
      const state = JSON.parse(raw);
      this.searchQuery.set(state.searchQuery ?? '');
      this.selectedCategory.set(state.selectedCategory ?? 'all');
      this.addressQuery.set(state.addressQuery ?? '');
      this.addressFilter.set(state.addressFilter ?? '');
      this.proximityCenter.set(state.proximityCenter ?? null);
    } catch {
      sessionStorage.removeItem('mapState');
    }
  }

  private buildMapItems(context: MapContext): { items: MapItem[]; issues: LocationIssue[] } {
    const items: MapItem[] = [];
    const issues: LocationIssue[] = [];

    context.objects.forEach((obj) => {
      const coords = this.resolveCoords(obj);
      if (!coords) {
        issues.push({ key: `object-missing-${obj.id}`, name: obj.name, categoryLabel: 'Object' });
        return;
      }
      items.push({ key: `object-${obj.id}`, id: obj.id, name: obj.name, category: 'object', categoryLabel: 'Object', typeName: (obj as any).subType ?? '', imageUrl: obj.imageUrl, address: (obj as any).address ?? null, averageRating: (obj as any).averageRating ?? null, reviewCount: (obj as any).reviewCount ?? null, description: (obj as any).description ?? null, price: null, currency: null, startDatetime: null, ...coords });
    });

    context.activities.forEach((act) => {
      const coords = this.resolveCoords(act);
      if (!coords) {
        issues.push({ key: `activity-missing-${act.id}`, name: act.name, categoryLabel: 'Activity' });
        return;
      }
      items.push({ key: `activity-${act.id}`, id: act.id, name: act.name, category: 'activity', categoryLabel: 'Activity', typeName: (act as any).subType ?? '', linkedObjectName: null, imageUrl: act.imageUrl, address: (act as any).address ?? null, averageRating: (act as any).averageRating ?? null, reviewCount: (act as any).reviewCount ?? null, description: (act as any).description ?? null, price: (act as any).price ?? null, currency: (act as any).currency ?? null, startDatetime: null, ...coords });
    });

    context.events.forEach((evt) => {
      const coords = this.resolveCoords(evt);
      if (!coords) {
        issues.push({ key: `event-missing-${evt.id}`, name: evt.name, categoryLabel: 'Event' });
        return;
      }
      items.push({ key: `event-${evt.id}`, id: evt.id, name: evt.name, category: 'event', categoryLabel: 'Event', typeName: (evt as any).subType ?? '', linkedObjectName: null, dateLabel: null, imageUrl: evt.imageUrl, address: (evt as any).address ?? null, averageRating: (evt as any).averageRating ?? null, reviewCount: (evt as any).reviewCount ?? null, description: (evt as any).description ?? null, price: (evt as any).price ?? null, currency: (evt as any).currency ?? null, startDatetime: (evt as any).startDatetime ?? null, ...coords });
    });

    return { items, issues };
  }

  private resolveCoords(
    item: { latitude?: number | null; longitude?: number | null },
    linked?: TouristObjectRecord
  ): { latitude: number; longitude: number; source: string } | null {
    const lat = this.toNum(item.latitude);
    const lng = this.toNum(item.longitude);
    if (lat !== null && lng !== null) return { latitude: lat, longitude: lng, source: 'Own coordinates' };
    const oLat = this.toNum(linked?.latitude);
    const oLng = this.toNum(linked?.longitude);
    if (oLat !== null && oLng !== null) return { latitude: oLat, longitude: oLng, source: 'Linked object' };
    return null;
  }

  private markerMap = new Map<string, L.Marker>();

  private spreadOverlapping(items: MapItem[]): Map<string, [number, number]> {
    const positions = new Map<string, [number, number]>();
    const THRESHOLD = 0.0001;
    const SPREAD = 0.0003;

    const groups = new Map<string, MapItem[]>();
    items.forEach(item => {
      const key = `${Math.round(item.latitude / THRESHOLD)}_${Math.round(item.longitude / THRESHOLD)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });

    groups.forEach(group => {
      if (group.length === 1) {
        positions.set(group[0].key, [group[0].latitude, group[0].longitude]);
      } else {
        const angleStep = (2 * Math.PI) / group.length;
        group.forEach((item, i) => {
          const angle = i * angleStep;
          positions.set(item.key, [
            item.latitude + Math.cos(angle) * SPREAD,
            item.longitude + Math.sin(angle) * SPREAD,
          ]);
        });
      }
    });

    return positions;
  }

  private renderMarkers(selectedKey: string | null = this.selectedItem()?.key ?? null): void {
    if (!this.map) return;
    this.isRenderingMarkers = true;
    this.contentLayer.clearLayers();
    this.markerMap.clear();

    const items = this.filteredItems();
    const positions = this.spreadOverlapping(items);

    items.forEach((item) => {
      const [lat, lng] = positions.get(item.key) ?? [item.latitude, item.longitude];
      const isSelected = item.key === selectedKey;
      const marker = L.marker([lat, lng], {
        icon: this.createIcon(item, isSelected),
        zIndexOffset: isSelected ? 1000 : 0,
      });

      const safeName = this.escapeHtml(item.name);
      const safeTypeName = this.escapeHtml(item.typeName);
      const safeAddress = this.escapeHtml(item.address);
      const safeImageUrl = this.safeImageUrl(item.imageUrl);

      const stars = (r: number | null | undefined) => {
        if (!r) return '';
        const full = Math.round(r);
        return '★'.repeat(full) + '☆'.repeat(5 - full);
      };
      const formatDate = (d: string | null | undefined) => {
        if (!d) return null;
        return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      };
      const formatPrice = (p: number | null | undefined, c: string | null | undefined) => {
        if (p === null || p === undefined) return null;
        if (p === 0) return 'Free';
        return `${p.toLocaleString()} ${c ?? ''}`.trim();
      };

      const ratingHtml = item.averageRating && item.reviewCount
        ? `<div class="ad-popup-rating">
            <span class="ad-popup-stars">${stars(item.averageRating)}</span>
            <span class="ad-popup-rating-val">${item.averageRating.toFixed(1)}</span>
            <span class="ad-popup-review-count">(${item.reviewCount})</span>
           </div>`
        : '';

      const addressHtml = item.address
        ? `<div class="ad-popup-address">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2"/></svg>
            ${safeAddress}
           </div>`
        : '';

      const dateHtml = formatDate(item.startDatetime)
        ? `<div class="ad-popup-date">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            ${formatDate(item.startDatetime)}
           </div>`
        : '';

      const priceHtml = formatPrice(item.price, item.currency)
        ? `<div class="ad-popup-price">${formatPrice(item.price, item.currency)}</div>`
        : '';

      const imageHtml = safeImageUrl
        ? `<img src="${safeImageUrl}" class="ad-popup-img" alt="${safeName}" />`
        : '';

      const popupContent = `
        <div class="ad-popup">
          ${imageHtml}
          <div class="ad-popup-body">
            <div class="ad-popup-top">
              <span class="ad-popup-badge ad-popup-badge--${item.category}">${item.categoryLabel}</span>
              ${item.typeName ? `<span class="ad-popup-typename">${safeTypeName}</span>` : ''}
            </div>
            ${priceHtml}
            <div class="ad-popup-name">${safeName}</div>
            ${addressHtml}
            ${dateHtml}
            ${ratingHtml}
           <a class="ad-popup-btn" href="/admin-destination/content/${item.category}/${item.id}"
              onclick="sessionStorage.setItem('contentDetailReturnUrl','/admin-destination/map'); sessionStorage.setItem('mapReturnState','1')">
              View details
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </a>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent, {
        closeButton: false,
        className: 'ad-map-popup',
        offset: [0, -24],
        maxWidth: 260,
        minWidth: 220,
      });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.zone.run(() => {
          this.lastMarkerClickTime = Date.now();
          const alreadySelected = this.selectedItem()?.key === item.key;
          if (alreadySelected) {
            this.selectedItem.set(null);
            this.renderMarkers(null);
          } else {
            this.selectedItem.set(item);
            this.renderMarkers(item.key);
            this.openPopupForSelected();
          }
          this.saveStateToSession();
        });
      });
      this.contentLayer.addLayer(marker);
      this.markerMap.set(item.key, marker);
    });

    this.isRenderingMarkers = false;
  }

  private renderDestinationLayer(): void {
    if (!this.map) return;
    this.destinationLayer.clearLayers();
  
    if (this.destinationBounds && !this.boundsLayersDrawn) {
      this.boundsService.applyToMap(this.map, this.destinationBounds, {
        fit: true,
        lockBounds: true
      });
      this.boundsLayersDrawn = true;
    }
  }

  private openPopupForSelected(): void {
    const key = this.selectedItem()?.key;
    if (!key) return;
    setTimeout(() => {
      this.markerMap.get(key)?.openPopup();
    }, 100);
  }

  private boundsLayersDrawn = false;

  private fitToCurrentData(animated: boolean): void {
    if (!this.map) return;

    if (this.destinationBounds) {
      const leafletBounds = this.boundsService.toLatLngBounds(this.destinationBounds);
      this.map.flyToBounds(leafletBounds, {
        padding: [24, 24],
        duration: animated ? 0.8 : 0.001,
      });
      return;
    }

    const dest = this.destination();
    const lat = this.toNum(dest?.latitude);
    const lng = this.toNum(dest?.longitude);
    if (lat !== null && lng !== null) {
      this.map.flyTo([lat, lng], 13, { duration: animated ? 0.8 : 1.5 });
      return;
    }
    this.errorMessage.set('Destination has no coordinates set.');
  }

  private readonly SELECTED_COLOR = '#dc2626';

  private markerSvg(type: 'Object' | 'Event' | 'Activity', selected = false): string {
    const bg = selected ? this.SELECTED_COLOR : undefined;

    if (type === 'Object') {
      return `<div style="width:38px;height:38px;background:${bg ?? '#2a9d8f'};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(0,0,0,0.15);">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
          <polygon points="12,3 22,8 2,8" fill="#ffffff" opacity="0.9"/>
          <rect x="4" y="8" width="2.5" height="8" fill="#ffffff"/>
          <rect x="8.75" y="8" width="2.5" height="8" fill="#ffffff"/>
          <rect x="13.5" y="8" width="2.5" height="8" fill="#ffffff"/>
          <rect x="17.5" y="8" width="2.5" height="8" fill="#ffffff"/>
          <rect x="2" y="16" width="20" height="2" fill="#ffffff"/>
          <rect x="3.5" y="18" width="17" height="2.5" rx="0.5" fill="#ffffff"/>
        </svg></div>`;
    }
    if (type === 'Event') {
      return `<div style="width:38px;height:38px;background:${bg ?? '#1d3557'};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(0,0,0,0.15);">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <rect x="4.5" y="6" width="15" height="13" rx="2.5" fill="none" stroke="#ffffff" stroke-width="1.9"/>
          <path d="M8 4.3v3.2M16 4.3v3.2M4.5 9.5h15" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round"/>
          <circle cx="9" cy="13" r="1" fill="#ffffff"/>
          <circle cx="12" cy="13" r="1" fill="#ffffff"/>
          <circle cx="15" cy="13" r="1" fill="#ffffff"/>
        </svg></div>`;
    }
    return `<div style="width:38px;height:38px;background:${bg ?? '#7c3aed'};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(0,0,0,0.15);">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
        <circle cx="14.5" cy="3.5" r="1.5" fill="#ffffff"/>
        <path d="M10 7.5l2.5 1.5L14 6.5" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8.5 9.5l2 2.5-3 4" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10.5 12l3.5 1-1 5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7.5 16l-1.5 4" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M13 18l2 2.5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg></div>`;
  }

  private categoryToType(category: ContentCategory): 'Object' | 'Event' | 'Activity' {
    if (category === 'object') return 'Object';
    if (category === 'event')  return 'Event';
    return 'Activity';
  }

  private createIcon(item: MapItem, selected = false): L.DivIcon {
    return L.divIcon({
      className: `ad-map-marker-clean ${item.category}${selected ? ' selected' : ''}`,
      html: this.markerSvg(this.categoryToType(item.category), selected),
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -23],
    });
  }

  private toNum(value: unknown): number | null {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  // ── Ćirilica → latinica mapa ──────────────────────────────
  private readonly CYRILLIC_TO_LATIN: Record<string, string> = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','ђ':'dj','е':'e','ж':'z',
    'з':'z','и':'i','ј':'j','к':'k','л':'l','љ':'lj','м':'m','н':'n',
    'њ':'nj','о':'o','п':'p','р':'r','с':'s','т':'t','ћ':'c','у':'u',
    'ф':'f','х':'h','ц':'c','ч':'c','џ':'dz','ш':'s',
    'А':'a','Б':'b','В':'v','Г':'g','Д':'d','Ђ':'dj','Е':'e','Ж':'z',
    'З':'z','И':'i','Ј':'j','К':'k','Л':'l','Љ':'lj','М':'m','Н':'n',
    'Њ':'nj','О':'o','П':'p','Р':'r','С':'s','Т':'t','Ћ':'c','У':'u',
    'Ф':'f','Х':'h','Ц':'c','Ч':'c','Џ':'dz','Ш':'s',
  };

  private transliterate(value: string): string {
    return value.split('').map(ch => this.CYRILLIC_TO_LATIN[ch] ?? ch).join('');
  }

  private normalize(value: string | null | undefined): string {
    const raw = (value ?? '').trim().toLowerCase();
    const transliterated = this.transliterate(raw);
    return transliterated.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char] ?? char));
  }

  private safeImageUrl(value: string | null | undefined): string | null {
    const url = buildAssetUrl(value);
    if (!url) return null;
    if (/^(https?:|data:|blob:)/i.test(url)) return this.escapeHtml(url);
    return null;
  }

  selectFirstAddressResult(): void {
    const results = this.addressResults();
    if (results.length > 0) {
      this.selectAddress(results[0]);
    }
  }

  onAddressKeyDown(event: KeyboardEvent): void {
    const results = this.addressResults();
  
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.addressFocusedIndex.set(
        Math.min(this.addressFocusedIndex() + 1, results.length - 1)
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.addressFocusedIndex.set(
        Math.max(this.addressFocusedIndex() - 1, 0)
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const index = this.addressFocusedIndex();
      if (index >= 0 && index < results.length) {
        this.selectAddress(results[index]);
      } else if (results.length > 0) {
        this.selectAddress(results[0]);
      }
      this.addressFocusedIndex.set(-1);
    } else if (event.key === 'Escape') {
      this.showAddressResults.set(false);
      this.addressFocusedIndex.set(-1);
    }
  }

  private saveStateToSession(): void {
    const state = {
      searchQuery: this.searchQuery(),
      selectedCategory: this.selectedCategory(),
      addressQuery: this.addressQuery(),
      addressFilter: this.addressFilter(),
      proximityCenter: this.proximityCenter(),
      selectedKey: this.selectedItem()?.key ?? null,
    };
    sessionStorage.setItem('mapState', JSON.stringify(state));
  }
}