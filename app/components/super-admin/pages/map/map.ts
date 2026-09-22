import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import * as L from 'leaflet';
import { EMPTY, expand, map, reduce } from 'rxjs';
import { buildApiUrl } from '../../../../core/config/api';

interface DestinationMarker {
  id: number;
  name: string;
  typeName: string;
  destinationTypeId: number;
  latitude: number;
  longitude: number;
  country: string;
  isActive: boolean;
}

interface ContentMarker {
  id: number;
  markerType: 'Object' | 'Event' | 'Activity';
  name: string;
  description?: string;
  latitude: number;
  longitude: number;
  subType?: string;
  imageUrl?: string;
  address?: string;
  price?: number;
  currency?: string;
  startDatetime?: string;
}

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './map.html',
  styleUrl: './map.css'
})
export class MapComponent implements AfterViewInit, OnDestroy {
  private map!: L.Map;
  private destinationMarkersLayer = L.layerGroup();
  private contentMarkersLayer = L.layerGroup();
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private zoomTimer: ReturnType<typeof setTimeout> | null = null;
  private currentDestinationId: number | null = null;
  private selectedContentMarker: L.Marker | null = null;
  private scrollContainer: HTMLElement | null = null;

  readonly DESTINATION_ZOOM_THRESHOLD = 9;
  readonly initialCenter: L.LatLngExpression = [20, 0];
  readonly initialZoom = 3;

  // ── Signals ───────────────────────────────────────────────────────
  private destinations = signal<DestinationMarker[]>([]);
  showBackButton = signal(false);
  isLoading = signal(false);
  isLoadingMarkers = signal(false);
  selectedMarker = signal<ContentMarker | null>(null);
  selectedDestination = signal<DestinationMarker | null>(null);
  showDetailsPanel = signal(false);
  showFilters = signal(false);

  // ── Filters ───────────────────────────────────────────────────────
  showObjects = signal(true);
  showEvents = signal(true);
  showActivities = signal(true);

  // ── Destination type filter ──────────────────────────────────────
  destinationTypes = signal<{ id: number; name: string }[]>([]);
  selectedTypeIds = signal<Set<number>>(new Set());

  // ── Search ────────────────────────────────────────────────────────
  searchQuery = '';
  isSearching = signal(false);
  searchResults = signal<any[]>([]);
  searchDropdownTop = signal(0);
  searchDropdownLeft = signal(0);
  searchDropdownWidth = signal(0);
  private geocodeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private http: HttpClient,
    private zone: NgZone,
    private route: ActivatedRoute,
    private router: Router,
    private elementRef: ElementRef
  ) {}

  ngAfterViewInit(): void {
    this.scrollContainer = this.elementRef.nativeElement.closest('.super-admin-content');
    if (this.scrollContainer) {
      this.scrollContainer.style.overflowY = 'hidden';
      this.scrollContainer.style.setProperty('scrollbar-gutter', 'auto');
    }
    this.initMap();
    this.loadDestinations();
    this.loadDestinationTypes();
  }

  ngOnDestroy(): void {
    if (this.scrollContainer) {
      this.scrollContainer.style.overflowY = '';
      this.scrollContainer.style.removeProperty('scrollbar-gutter');
    }
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.zoomTimer) clearTimeout(this.zoomTimer);
    if (this.geocodeTimer) clearTimeout(this.geocodeTimer);
    if (this.map) this.map.remove();
  }

  goBack(): void {
    this.router.navigate(['/super-admin/destinations']);
  }

  private loadDestinationTypes(): void {
    this.http.get<any[]>(buildApiUrl('destination-types')).subscribe({
      next: (data) => {
        this.destinationTypes.set((data ?? []).map(t => ({ id: t.id, name: t.name })));
      },
      error: () => {}
    });
  }

  toggleTypeFilter(typeId: number): void {
    const current = new Set(this.selectedTypeIds());
    if (current.has(typeId)) {
      current.delete(typeId);
    } else {
      current.add(typeId);
    }
    this.selectedTypeIds.set(current);
    this.refreshVisibleMarkers();
  }

  clearTypeFilter(): void {
    this.selectedTypeIds.set(new Set());
    this.refreshVisibleMarkers();
  }

  isTypeSelected(typeId: number): boolean {
    return this.selectedTypeIds().size === 0 || this.selectedTypeIds().has(typeId);
  }

  private refreshVisibleMarkers(): void {
    if (this.map && this.map.getZoom() >= this.DESTINATION_ZOOM_THRESHOLD) {
      this.renderVisibleDestinationMarkers(this.map.getBounds());
    }
  }

  // ── Map init ──────────────────────────────────────────────────────
  private initMap(): void {
    const worldBounds = L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180));

    this.map = L.map('super-admin-map', {
      zoomControl: false,
      worldCopyJump: true,
      minZoom: 3,
      maxZoom: 18,
      maxBounds: worldBounds,
      maxBoundsViscosity: 0.8
    }).setView(this.initialCenter, this.initialZoom);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      noWrap: false
    }).addTo(this.map);

    this.destinationMarkersLayer.addTo(this.map);
    this.contentMarkersLayer.addTo(this.map);

    // Show destination markers only when zoomed in enough
    this.map.on('zoomend moveend', () => {
      if (this.zoomTimer) clearTimeout(this.zoomTimer);
      this.zoomTimer = setTimeout(() => {
        this.zone.run(() => this.onMapMoved());
      }, 200);
    });
  }

  // ── Load destinations ─────────────────────────────────────────────
  private loadDestinations(): void {
    this.isLoading.set(true);
    this.loadAllDestinationRows().subscribe({
      next: (rows) => {
        const mapped = rows
          .filter((d: any) => d.latitude && d.longitude)
          .map((d: any) => ({
            id: Number(d.id),
            name: d.name ?? '',
            typeName: d.destinationTypeName ?? '',
            destinationTypeId: Number(d.destinationTypeId ?? 0),
            latitude: Number(d.latitude),
            longitude: Number(d.longitude),
            country: d.country ?? '',
            isActive: d.isActive ?? true
          }));
        this.destinations.set(mapped);
        this.isLoading.set(false);

        // Check query params
        this.route.queryParams.subscribe(params => {
          if (params['from'] === 'destinations') {
            this.showBackButton.set(true);
          }
          const destinationId = params['destinationId'];
          if (destinationId) {
            const dest = mapped.find((d: DestinationMarker) => d.id === Number(destinationId));
            if (dest) {
              this.map.flyTo([dest.latitude, dest.longitude], 12, { duration: 0.8 });
            }
          }
        });
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  private loadAllDestinationRows(pageSize = 50) {
    return this.loadDestinationRowsPage(1, pageSize).pipe(
      expand(result => result.rows.length === pageSize
        ? this.loadDestinationRowsPage(result.page + 1, pageSize)
        : EMPTY
      ),
      reduce((allRows, result) => [...allRows, ...result.rows], [] as any[])
    );
  }

  private loadDestinationRowsPage(page: number, pageSize: number) {
    return this.http.get<any>(buildApiUrl(`destinations?page=${page}&pageSize=${pageSize}`)).pipe(
      map(response => ({
        page,
        rows: Array.isArray(response) ? response : response?.items ?? response?.data ?? []
      }))
    );
  }

  // ── Map moved/zoomed ──────────────────────────────────────────────
  private onMapMoved(): void {
    const zoom = this.map.getZoom();
    const bounds = this.map.getBounds();

    if (zoom >= this.DESTINATION_ZOOM_THRESHOLD) {
      // Show destination pins that are in view
      this.renderVisibleDestinationMarkers(bounds);

      // Find closest destination to map center and load its content
      const center = this.map.getCenter();
      const closest = this.findClosestDestination(center.lat, center.lng, bounds);
      if (closest && closest.id !== this.currentDestinationId) {
        this.currentDestinationId = closest.id;
        this.loadContentMarkers(closest.id);
      }
    } else {
      // Zoomed out — clear everything
      this.destinationMarkersLayer.clearLayers();
      this.contentMarkersLayer.clearLayers();
      this.currentDestinationId = null;
      if (this.showDetailsPanel()) {
        this.closeDetails();
      }
    }
  }

  private renderVisibleDestinationMarkers(bounds: L.LatLngBounds): void {
    this.destinationMarkersLayer.clearLayers();
    this.destinations()
      .filter(d => bounds.contains([d.latitude, d.longitude]))
      .filter(d => this.selectedTypeIds().size === 0 || this.selectedTypeIds().has((d as any).destinationTypeId))
      .forEach(dest => {
        const marker = L.marker([dest.latitude, dest.longitude], {
          icon: this.createDestinationIcon(dest.isActive)
        });
        marker.on('click', () => {
          this.zone.run(() => {
            this.selectedDestination.set(dest);
            this.selectedMarker.set(null);
            this.showDetailsPanel.set(true);
            if (dest.id !== this.currentDestinationId) {
              this.currentDestinationId = dest.id;
              this.loadContentMarkers(dest.id);
            }
            this.map.flyTo([dest.latitude, dest.longitude], 12, { duration: 0.6 });
          });
        });
        this.destinationMarkersLayer.addLayer(marker);
      });
  }

  private findClosestDestination(lat: number, lng: number, bounds: L.LatLngBounds): DestinationMarker | null {
    const visible = this.destinations().filter(d => bounds.contains([d.latitude, d.longitude]));
    if (visible.length === 0) return null;
    return visible.reduce((closest, dest) => {
      const dist = Math.hypot(dest.latitude - lat, dest.longitude - lng);
      const closestDist = Math.hypot(closest.latitude - lat, closest.longitude - lng);
      return dist < closestDist ? dest : closest;
    });
  }

  // ── Load content markers ──────────────────────────────────────────
  private loadContentMarkers(destinationId: number): void {
    this.isLoadingMarkers.set(true);
    this.contentMarkersLayer.clearLayers();

    const types: string[] = [];
    if (this.showObjects()) types.push('Object');
    if (this.showEvents()) types.push('Event');
    if (this.showActivities()) types.push('Activity');

    if (types.length === 0) {
      this.isLoadingMarkers.set(false);
      return;
    }

    const typeParams = types.map(t => `types=${t}`).join('&');
    const url = buildApiUrl(`map/markers?destinationId=${destinationId}&${typeParams}`);

    this.http.get<ContentMarker[]>(url).subscribe({
      next: (markers) => {
        this.zone.run(() => {
          const offsetMarkers = this.applyOverlapOffsets(markers ?? []);
          offsetMarkers.forEach(({ item: m, lat, lng }) => {
            const icon = this.createContentIcon(m.markerType);
            const marker = L.marker([lat, lng], { icon });
            marker.on('click', () => {
              this.zone.run(() => {
                // Resetuj prethodni selektovani marker
                if (this.selectedContentMarker && this.selectedContentMarker !== marker) {
                const prev = (this.selectedContentMarker as any)._lastType as 'Object' | 'Event' | 'Activity';
                this.selectedContentMarker.setIcon(this.createContentIcon(prev));
                }
                // Oboji novi marker u narandžasto
                marker.setIcon(this.createContentIconSelected(m.markerType));
                this.selectedContentMarker = marker;
                (marker as any)._lastType = m.markerType;
                this.selectedMarker.set(m);
                this.selectedDestination.set(null);
                this.showDetailsPanel.set(true);
              });
            });
            this.contentMarkersLayer.addLayer(marker);
          });
          this.isLoadingMarkers.set(false);
        });
      },
      error: () => {
        this.isLoadingMarkers.set(false);
      }
    });
  }

  // ── Filter toggles ────────────────────────────────────────────────
  toggleObjects(): void {
    this.showObjects.set(!this.showObjects());
    this.refreshContentMarkers();
  }

  toggleEvents(): void {
    this.showEvents.set(!this.showEvents());
    this.refreshContentMarkers();
  }

  toggleActivities(): void {
    this.showActivities.set(!this.showActivities());
    this.refreshContentMarkers();
  }

  private refreshContentMarkers(): void {
    if (this.currentDestinationId) {
      this.loadContentMarkers(this.currentDestinationId);
    }
  }

  toggleFilters(): void {
    this.showFilters.set(!this.showFilters());
  }

  // ── Geocoding search ──────────────────────────────────────────────
  onSearchChange(event?: Event): void {
    if (this.geocodeTimer) clearTimeout(this.geocodeTimer);
    const query = this.searchQuery.trim();
    if (!query) { this.searchResults.set([]); return; }

    if (event?.target) {
      const input = (event.target as HTMLElement).closest('.search-box');
      if (input) {
        const rect = input.getBoundingClientRect();
        this.searchDropdownTop.set(rect.bottom + 4);
        this.searchDropdownLeft.set(rect.left);
        this.searchDropdownWidth.set(rect.width);
      }
    }

    this.geocodeTimer = setTimeout(() => {
      this.isSearching.set(true);
      const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(query) + '&limit=5&lang=en';
      fetch(url)
        .then(r => r.json())
        .then((response: any) => {
          const results = (response?.features ?? []).map((f: any) => ({
            display_name: [f.properties?.name, f.properties?.city, f.properties?.state, f.properties?.country].filter(Boolean).join(', '),
            lat: String(f.geometry?.coordinates?.[1]),
            lon: String(f.geometry?.coordinates?.[0]),
            _type: f.properties?.type ?? 'city'
          }));
          this.zone.run(() => {
            this.searchResults.set(results);
            this.isSearching.set(false);
          });
        })
        .catch(() => {
          this.zone.run(() => {
            this.searchResults.set([]);
            this.isSearching.set(false);
          });
        });
    }, 400);
  }

  selectSearchResult(result: any): void {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    this.searchQuery = result.display_name;
    this.searchResults.set([]);
    const zoom = result._type === 'house' ? 17 : result._type === 'city' ? 11 : 13;
    this.map.flyTo([lat, lng], zoom, { duration: 0.8 });
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults.set([]);
  }

  // ── Details panel ─────────────────────────────────────────────────
  closeDetails(): void {
    this.showDetailsPanel.set(false);
    this.selectedMarker.set(null);
    this.selectedDestination.set(null);
    if (this.selectedContentMarker) {
      const t = (this.selectedContentMarker as any)._lastType as 'Object' | 'Event' | 'Activity';
      this.selectedContentMarker.setIcon(this.createContentIcon(t));
      this.selectedContentMarker = null;
    }
  }

  getMarkerTypeColor(type: string): string {
    switch (type) {
      case 'Object': return '#2a9d8f';
      case 'Event': return '#1d3557';
      case 'Activity': return '#7c3aed';
      default: return '#6b7280';
    }
  }

  // ── Icons ─────────────────────────────────────────────────────────
  private applyOverlapOffsets(items: ContentMarker[]): { item: ContentMarker; lat: number; lng: number }[] {
    const key = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const groups = new Map<string, ContentMarker[]>();
    items.forEach(item => {
      const k = key(item.latitude, item.longitude);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(item);
    });
    const result: { item: ContentMarker; lat: number; lng: number }[] = [];
    groups.forEach(group => {
      if (group.length === 1) {
        result.push({ item: group[0], lat: group[0].latitude, lng: group[0].longitude });
        return;
      }
      const offsetDeg = 0.0003;
      const angleStep = (2 * Math.PI) / group.length;
      group.forEach((item, index) => {
        const angle = index * angleStep;
        result.push({
          item,
          lat: item.latitude + offsetDeg * Math.sin(angle),
          lng: item.longitude + offsetDeg * Math.cos(angle)
        });
      });
    });
    return result;
  }

  private createDestinationIcon(isActive: boolean): L.DivIcon {
    const color = isActive ? '#239485' : '#9ca3af';
    return L.divIcon({
      className: '',
      html: `<svg viewBox="0 0 24 24" width="36" height="36">
        <path d="M12 22s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
        <circle cx="12" cy="11" r="2.5" fill="#ffffff"/>
      </svg>`,
      iconSize: [36, 36],
      iconAnchor: [18, 36]
    });
  }

  private markerSvg(type: 'Object' | 'Event' | 'Activity'): string {
    if (type === 'Object') {
      return `<div style="width:38px;height:38px;background:#2a9d8f;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(0,0,0,0.15);">
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
      return `<div style="width:38px;height:38px;background:#1d3557;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(0,0,0,0.15);">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <rect x="4.5" y="6" width="15" height="13" rx="2.5" fill="none" stroke="#ffffff" stroke-width="1.9"/>
          <path d="M8 4.3v3.2M16 4.3v3.2M4.5 9.5h15" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round"/>
          <circle cx="9" cy="13" r="1" fill="#ffffff"/>
          <circle cx="12" cy="13" r="1" fill="#ffffff"/>
          <circle cx="15" cy="13" r="1" fill="#ffffff"/>
        </svg></div>`;
    }
    // Activity — running figure
    return `<div style="width:38px;height:38px;background:#7c3aed;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(0,0,0,0.15);">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
        <circle cx="14.5" cy="3.5" r="1.5" fill="#ffffff"/>
        <path d="M10 7.5l2.5 1.5L14 6.5" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8.5 9.5l2 2.5-3 4" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10.5 12l3.5 1-1 5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7.5 16l-1.5 4" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M13 18l2 2.5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg></div>`;
  }

  private createContentIcon(type: 'Object' | 'Event' | 'Activity'): L.DivIcon {
    return L.divIcon({
      className: 'custom-map-marker',
      html: this.markerSvg(type),
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });
  }

  private createContentIconSelected(type: 'Object' | 'Event' | 'Activity'): L.DivIcon {
    const bg = '#f97316';
    const inner = this.markerSvg(type).replace(
    /background:(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|[a-z]+)/,
    `background:${bg}`
    );
    return L.divIcon({
    className: 'custom-map-marker',
    html: inner,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
    });
  }

  private normalize(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
}
