import { AfterViewInit, Component, NgZone, OnDestroy, signal, computed, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import * as L from 'leaflet';
import { HttpClient } from '@angular/common/http';
import { EMPTY, expand, map, reduce } from 'rxjs';
import { PublisherHeaderComponent } from '../publisher-header/publisher-header';
import { PublisherContentService, PublisherContentType } from '../../services/publisher-content.service';
import { buildApiUrl, FALLBACK_IMAGE_URL, firstAssetUrl } from '../../core/config/api';
import { PublisherStateService } from '../../services/publisher-state.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';

const DefaultIcon = L.icon({
  iconUrl: 'marker-icon.png',
  shadowUrl: 'marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

type MarkerType = 'Object' | 'Event' | 'Activity';

interface DestinationOption {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

interface MapItem {
  id: number;
  name: string;
  markerType: MarkerType;
  subType: string;
  lat: number;
  lng: number;
  address: string;
  description: string;
  rating: number;
  reviewCount: number;
  image: string;
  price: number;
  currency: string;
}

interface SubtypeFilter {
  name: string;
  checked: boolean;
}

interface GroupFilter {
  label: string;
  markerType: MarkerType;
  checked: boolean;
  subtypes: SubtypeFilter[];
}

@Component({
  selector: 'app-publisher-map',
  standalone: true,
  imports: [CommonModule, FormsModule, PublisherHeaderComponent, TranslatePipe],
  templateUrl: './publisher-map.html',
  styleUrl: './publisher-map.css'
})
export class PublisherMapComponent implements AfterViewInit, OnDestroy {
  private map!: L.Map;
  private markersLayer = L.layerGroup();
  private pendingContentId: number | null = null;
  private pendingLat: number | null = null;
  private pendingLng: number | null = null;
  private readonly subtypeTranslationKeys: Record<string, string> = {
    beach: 'beach',
    church: 'church',
    hotel: 'hotel',
    museum: 'museum',
    restaurant: 'restaurant',
    viewpoint: 'viewpoint',
    'view point': 'viewpoint',
    hiking: 'hiking',
    fishing: 'fishing',
    cycling: 'cycling',
    swimming: 'swimming',
    kayaking: 'kayaking',
    concert: 'concert',
    festival: 'festival',
    exhibition: 'exhibition',
    sports: 'sports',
  };

  private isRestoring = false;
  private isProgrammaticFly = false;

  destinations = signal<DestinationOption[]>([]);
  selectedDestinationId = signal<number | null>(null);
  destinationQuery = signal('');
  showDestinationDropdown = signal(false);

  allItems = signal<MapItem[]>([]);
  selectedItem = signal<MapItem | null>(null);
  selectedItemId = signal<number | null>(null);
  showDetailsPanel = signal(false);
  isLoading = signal(false);
  nameSearch = signal('');
  minRating = signal(0);

  myItemIds = signal<Set<number>>(new Set());
  publisherType = signal<PublisherContentType>('Object');
  filterGroups = signal<GroupFilter[]>([]);
  showOnlyMine = signal(false);
  popupX = signal<number | null>(null);
  popupY = signal<number | null>(null);

  filteredDestinations = computed(() => {
    const q = this.destinationQuery().trim().toLowerCase();
    if (!q) return this.destinations().slice(0, 5);
    return this.destinations().filter(d => d.name.toLowerCase().includes(q)).slice(0, 5);
  });

  filteredItems = computed(() => {
    const groups = this.filterGroups();
    const minR = this.minRating();
    const q = this.nameSearch().trim().toLowerCase();
    const onlyMine = this.showOnlyMine();
    const result = this.allItems().filter(item => {
      if (onlyMine && !this.myItemIds().has(item.id)) return false;
      const group = groups.find(g => g.markerType === item.markerType);
      if (!group?.checked) return false;
      if (group.subtypes.length > 0) {
        const sub = group.subtypes.find(s => s.name.toLowerCase() === item.subType.toLowerCase());
        if (sub && !sub.checked) return false;
      }
      if (minR > 0 && item.rating < minR) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
    return result;
  });

  constructor(
    private http: HttpClient,
    private zone: NgZone,
    private router: Router,
    private route: ActivatedRoute,
    private publisherContentService: PublisherContentService,
    private stateService: PublisherStateService,
    private translation: TranslationService
  ) {
    effect(() => {
      const items = this.filteredItems();
      untracked(() => this.renderMarkers(items));
    });
    effect(() => {
      const items = this.filteredItems();
      const selectedId = this.selectedItemId();
      if (selectedId && !items.find(i => i.id === selectedId)) {
        untracked(() => this.closeDetails());
      }
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
    this.loadDestinations();
    this.loadPublisherInfo();

    const urlParams = new URLSearchParams(window.location.search);
    const contentId = urlParams.get('contentId');
    const lat = urlParams.get('lat');
    const lng = urlParams.get('lng');
    const destinationId = urlParams.get('destinationId');

    if (contentId && lat && lng) {
      this.pendingContentId = +contentId;
      this.pendingLat = +lat;
      this.pendingLng = +lng;

      if (destinationId) {
        const tryFind = () => {
          const dest = this.destinations().find(d => d.id === +destinationId);
          if (dest) {
            this.selectDestination(dest);
          } else {
            setTimeout(tryFind, 200);
          }
        };
        setTimeout(tryFind, 300);
      }
      return;
    }

    const mapLat = urlParams.get('mapLat');
    const mapLng = urlParams.get('mapLng');
    const mapZoom = urlParams.get('mapZoom');
    const destId = urlParams.get('destId');
    const selectedId = urlParams.get('selectedId');

    const saved = this.stateService.mapState();
    const stateToRestore = mapLat && mapLng && mapZoom ? {
      lat: +mapLat,
      lng: +mapLng,
      zoom: +mapZoom,
      destinationId: destId ? +destId : null,
      nameSearch: urlParams.get('nameSearch') ?? '',
      minRating: +(urlParams.get('minRating') ?? 0),
      selectedItemId: selectedId ? +selectedId : null,
      onlyMine: urlParams.get('onlyMine') === 'true',
    } : saved ? {
      lat: saved.lat,
      lng: saved.lng,
      zoom: saved.zoom,
      destinationId: saved.destinationId,
      nameSearch: saved.nameSearch,
      minRating: saved.minRating,
      selectedItemId: saved.selectedItemId,
      onlyMine: false,
    } : null;

    if (stateToRestore) {
      this.isRestoring = true;
      setTimeout(() => {
        this.map.setView([stateToRestore.lat, stateToRestore.lng], stateToRestore.zoom);
        this.nameSearch.set(stateToRestore.nameSearch);
        this.minRating.set(stateToRestore.minRating);
        this.showOnlyMine.set(stateToRestore.onlyMine);

        if (stateToRestore.destinationId) {
          const tryRestoreDestination = () => {
            const dest = this.destinations().find(d => d.id === stateToRestore.destinationId);
            if (dest) {
              this.destinationQuery.set(dest.name);
              this.selectDestination(dest, true);
              if (stateToRestore.selectedItemId) {
                setTimeout(() => {
                  const target = this.allItems().find(i => i.id === stateToRestore.selectedItemId);
                  if (target) this.openDetails(target, true);
                  this.isRestoring = false;
                  this.saveMapState();
                }, 1200);
              } else {
                this.isRestoring = false;
                this.saveMapState();
              }
            } else {
              setTimeout(tryRestoreDestination, 200);
            }
          };
          setTimeout(tryRestoreDestination, 200);
        } else {
          this.isRestoring = false;
          this.saveMapState();
        }
      }, 200);
    }
  }

  ngOnDestroy(): void {
    this.saveMapState();
    if (this.map) this.map.remove();
  }

  private initMap(): void {
    this.map = L.map('publisherMap', {
      zoomControl: false,
      minZoom: 5,
      maxZoom: 18,
    }).setView([44.0165, 21.0059], 7);

    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    this.markersLayer.addTo(this.map);

    this.map.on('moveend', () => this.zone.run(() => this.saveMapState()));
    this.map.on('movestart', () => this.zone.run(() => {
      if (this.showDetailsPanel() && !this.isProgrammaticFly) this.closeDetails();
    }));
  }

  private loadPublisherInfo(): void {
    this.publisherContentService.getCurrentPublisherContentType().subscribe(type => {
      this.publisherType.set(type);
      this.filterGroups.set([{
        label: type === 'Object' ? 'Objects' : type === 'Activity' ? 'Activities' : 'Events',
        markerType: type,
        checked: true,
        subtypes: []
      }]);
      this.loadReferenceFilters(type);
      this.publisherContentService.getAllContentItems(50).subscribe(items => {
        this.myItemIds.set(new Set(items.map(i => i.id)));
      });
    });
  }

  private loadDestinations(): void {
    this.loadAllDestinationRows().subscribe({
      next: rows => {
        this.destinations.set(
          (rows ?? []).map(d => ({
            id: d.id,
            name: d.name ?? '',
            latitude: d.latitude ?? null,
            longitude: d.longitude ?? null
          })).filter(d => d.name)
        );
      },
      error: () => this.destinations.set([])
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

  private loadReferenceFilters(type: PublisherContentType): void {
    const endpoint = type === 'Object' ? 'reference-data/object-types'
                : type === 'Activity' ? 'reference-data/activity-types'
                : 'reference-data/event-types';

  const saved = this.stateService.mapState();
  const urlUnchecked = (new URLSearchParams(window.location.search).get('unchecked') ?? '').split(',').filter(Boolean);
  const urlGroupUnchecked = urlUnchecked.filter(u => u.startsWith('GROUP:')).map(u => u.replace('GROUP:', ''));
  const urlSubtypeUnchecked = urlUnchecked.filter(u => !u.startsWith('GROUP:'));

  this.http.get<any[]>(buildApiUrl(endpoint)).subscribe({
    next: types => {
      if (saved?.filterGroups?.length) {
        this.filterGroups.update(groups =>
          groups.map(g => ({
            ...g,
            checked: saved.filterGroups.find(sg => sg.markerType === g.markerType)?.checked ?? true,
            subtypes: saved.filterGroups.find(sg => sg.markerType === g.markerType)?.subtypes?.length
              ? saved.filterGroups.find(sg => sg.markerType === g.markerType)!.subtypes
              : (types ?? []).map(t => ({
                name: t.name ?? '',
                checked: urlSubtypeUnchecked.length ? !urlSubtypeUnchecked.includes(t.name ?? '') : true
              }))
          }))
        );
      } else {
        this.filterGroups.update(groups =>
          groups.map(g => ({
            ...g,
            checked: !urlGroupUnchecked.includes(g.markerType),
            subtypes: (types ?? []).map(t => ({
              name: t.name ?? '',
              checked: urlSubtypeUnchecked.length ? !urlSubtypeUnchecked.includes(t.name ?? '') : true
            }))
          }))
        );
      }
    }
  });
  }

  selectDestination(dest: DestinationOption, skipFly = false): void {
    this.selectedDestinationId.set(dest.id);
    this.destinationQuery.set(dest.name);
    this.showDestinationDropdown.set(false);

    if (!skipFly && dest.latitude && dest.longitude) {
      this.map.flyTo([dest.latitude, dest.longitude], 13, { duration: 0.8 });
    }

    this.loadMarkers(dest.id);
  }

  clearDestination(): void {
    this.selectedDestinationId.set(null);
    this.destinationQuery.set('');
    this.allItems.set([]);
    this.markersLayer.clearLayers();
    this.closeDetails();
  }

  private loadMarkers(destinationId: number): void {
    this.isLoading.set(true);
    const type = this.publisherType();
    this.http.get<any[]>(buildApiUrl(`map/markers/filtered?types=${type}&destinationId=${destinationId}`)).subscribe({
      next: response => {
        const items = (response ?? []).map(m => this.mapMarkerToItem(m));
        this.allItems.set(items);
        this.isLoading.set(false);

        if (this.pendingContentId !== null) {
          const target = items.find(i => i.id === this.pendingContentId);
          if (target) {
            setTimeout(() => {
              this.zone.run(() => this.openDetails(target));
            }, 400);
          }
          this.pendingContentId = null;
          this.pendingLat = null;
          this.pendingLng = null;
        }
      },
      error: () => {
        this.allItems.set([]);
        this.isLoading.set(false);
      }
    });
  }

  setMinRating(rating: number): void {
    this.minRating.set(this.minRating() === rating ? 0 : rating);
    this.saveMapState();
  }

  groupLabel(markerType: MarkerType): string {
    const keyByType: Record<MarkerType, string> = {
      Object: 'publisher.map.typeLabels.objects',
      Activity: 'publisher.map.typeLabels.activities',
      Event: 'publisher.map.typeLabels.events',
    };

    return this.translateWithFallback(keyByType[markerType], markerType);
  }

  subtypeLabel(name: string): string {
    if (!name) return '';
    const normalized = name.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    const subtypeKey = this.subtypeTranslationKeys[normalized] ?? normalized.replace(/\s+/g, '');
    return this.translateWithFallback(`publisher.map.subtypes.${subtypeKey}`, name);
  }

  detailTypeLabel(item: MapItem): string {
    return item.subType ? this.subtypeLabel(item.subType) : this.groupLabel(item.markerType);
  }

  private translateWithFallback(key: string, fallback: string): string {
    this.translation.currentLanguage();
    const translated = this.translation.translate(key);
    return translated === key ? fallback : translated;
  }

  private getMarkerHtml(item: MapItem, isMine: boolean): string {
    const isSelected = this.selectedItemId() === item.id;
    const bg = isMine ? '#2a9d8f' : '#9ca3af';
    const shadow = isSelected
      ? '0 0 0 2px white, 0 0 0 5px rgba(242,184,75,0.9), 0 6px 14px rgba(0,0,0,0.2)'
      : '0 6px 14px rgba(0,0,0,0.15)';
    const size = isSelected ? '44px' : '38px';
    const icon = this.getIconSvg(item);
    return `<div style="width:${size};height:${size};background:${bg};border:none;border-radius:50%;box-shadow:${shadow};display:flex;align-items:center;justify-content:center;transition:all 0.2s;">${icon}</div>`;
  }

  private getIconSvg(item: MapItem): string {
    const w = 'stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"';
    switch (item.subType.toLowerCase()) {
      case 'hotel': return `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="5" y="7" width="4" height="3" rx="1" fill="white"/><rect x="15" y="7" width="4" height="3" rx="1" fill="white"/><rect x="4" y="10" width="16" height="6" rx="1" ${w}/><line x1="5" y1="16" x2="5" y2="19" ${w}/><line x1="19" y1="16" x2="19" y2="19" ${w}/><line x1="4" y1="19" x2="20" y2="19" ${w}/></svg>`;
      case 'restaurant': return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 3v6M5 3v6M9 3v6M7 9v9" ${w}/><path d="M15 3c2 2 2 5 0 7v9" ${w}/></svg>`;
      case 'museum': return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 9l9-5 9 5" ${w}/><line x1="3" y1="9" x2="21" y2="9" ${w}/><line x1="3" y1="19" x2="21" y2="19" ${w}/><line x1="7" y1="9" x2="7" y2="19" ${w}/><line x1="12" y1="9" x2="12" y2="19" ${w}/><line x1="17" y1="9" x2="17" y2="19" ${w}/></svg>`;
      case 'church': return `<svg viewBox="0 0 24 24" width="18" height="18"><line x1="12" y1="2" x2="12" y2="7" ${w}/><line x1="10" y1="4" x2="14" y2="4" ${w}/><rect x="7" y="7" width="10" height="13" ${w}/><rect x="10" y="14" width="4" height="6" fill="white" ${w}/></svg>`;
      case 'beach': return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 18c3-4 6-6 9-6s6 2 9 6" ${w}/><path d="M12 12V6" ${w}/><path d="M8 8l4-2 4 2" ${w}/><circle cx="17" cy="5" r="2" fill="white"/></svg>`;
      case 'viewpoint': return `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="3" fill="white"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" ${w}/></svg>`;
      case 'hiking': return `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="4" r="1.5" fill="white"/><path d="M12 6l-2 5 3 2-1 5" ${w}/><path d="M10 11l-3 5" ${w}/><path d="M14 13l3 5" ${w}/></svg>`;
      case 'fishing': return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 6c5-3 10 0 10 6" ${w}/><path d="M13 12l5 5" ${w}/><path d="M18 17l2-2M16 19l2-2" ${w}/><circle cx="7" cy="17" r="2" fill="white"/></svg>`;
      case 'cycling': return `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="6" cy="16" r="3" ${w}/><circle cx="18" cy="16" r="3" ${w}/><path d="M6 16l4-7h4l2 7M10 9l2-4" ${w}/><circle cx="12" cy="5" r="1" fill="white"/></svg>`;
      case 'swimming': return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0" ${w}/><path d="M3 13c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0" ${w}/><circle cx="17" cy="6" r="1.5" fill="white"/></svg>`;
      case 'kayaking': return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 12c5-5 13-5 18 0" ${w}/><path d="M7 8l10 8M5 7l2 2M17 15l2 2" ${w}/><circle cx="12" cy="10" r="1.5" fill="white"/></svg>`;
      case 'concert': return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 18V6l12-2v12" ${w}/><circle cx="6" cy="18" r="3" fill="white"/><circle cx="18" cy="16" r="3" fill="white"/></svg>`;
      case 'festival': return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2l2 5h5l-4 3 1.5 5L12 12l-4.5 3L9 10 5 7h5z" fill="white" ${w}/></svg>`;
      case 'exhibition': return `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="8" height="8" rx="1" fill="white"/><rect x="13" y="3" width="8" height="8" rx="1" ${w}/><rect x="3" y="13" width="8" height="8" rx="1" ${w}/><rect x="13" y="13" width="8" height="8" rx="1" fill="white"/></svg>`;
      case 'sports': return `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="9" ${w}/><path d="M12 3c0 5-3 8-3 9s3 4 3 9M3 12h18" ${w}/></svg>`;
      default: return `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z" fill="white"/><circle cx="12" cy="10" r="2.5" fill="#2a9d8f"/></svg>`;
    }
  }

  private renderMarkers(items: MapItem[]): void {
    if (!this.map) return;
    this.markersLayer.clearLayers();

    const coordCount = new Map<string, number>();

    items.forEach(item => {
      const key = `${item.lat},${item.lng}`;
      const count = coordCount.get(key) ?? 0;
      coordCount.set(key, count + 1);
      const offset = count * 0.0003;

      const isMine = this.myItemIds().has(item.id);
      const icon = L.divIcon({
        className: '',
        html: this.getMarkerHtml(item, isMine),
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });

      const marker = L.marker([item.lat + offset, item.lng + offset], { icon });
      marker.on('click', () => this.zone.run(() => this.openDetails(item)));
      this.markersLayer.addLayer(marker);
    });
  }

  private updatePopupPosition(item: MapItem): void {
    const point = this.map.latLngToContainerPoint([item.lat, item.lng]);
    const popupWidth = 260;
    const popupHeight = 320;
    const sidePanelWidth = 300;

    let x = point.x - popupWidth - 20;
    if (x < 10) x = point.x + 20;
    if (x + popupWidth > this.map.getContainer().clientWidth - sidePanelWidth - 10) {
      x = point.x - popupWidth - 20;
    }

    let y = point.y - popupHeight / 2;
    if (y < 10) y = 10;
    if (y + popupHeight > this.map.getContainer().clientHeight - 10) {
      y = this.map.getContainer().clientHeight - popupHeight - 10;
    }

    this.zone.run(() => {
      this.popupX.set(x);
      this.popupY.set(y);
    });
  }

  openDetails(item: MapItem, skipFly = false): void {
    this.selectedItem.set(item);
    this.selectedItemId.set(item.id);
    this.showDetailsPanel.set(true);
    this.renderMarkers(this.filteredItems());
    if (!skipFly) {
      this.isProgrammaticFly = true;
      this.map.flyTo([item.lat, item.lng], 17, { duration: 0.8 });
      this.map.once('moveend', () => this.zone.run(() => {
        this.isProgrammaticFly = false;
        this.updatePopupPosition(item);
      }));
      setTimeout(() => {
        if (this.selectedItemId() === item.id && this.popupX() === null) {
          this.isProgrammaticFly = false;
          this.zone.run(() => this.updatePopupPosition(item));
        }
      }, 1200);
    } else {
      this.updatePopupPosition(item);
    }
  }

  closeDetails(): void {
    this.showDetailsPanel.set(false);
    this.selectedItem.set(null);
    this.selectedItemId.set(null);
    this.popupX.set(null);
    this.popupY.set(null);
    this.renderMarkers(this.filteredItems());
    this.saveMapState();
  }

  toggleSubtypeItem(sub: SubtypeFilter, group: GroupFilter): void {
    this.filterGroups.update(groups =>
      groups.map(g => g.markerType !== group.markerType ? g : {
        ...g,
        subtypes: g.subtypes.map(s => s.name !== sub.name ? s : { ...s, checked: !s.checked }),
        checked: g.subtypes.some(s => s.name === sub.name ? !s.checked : s.checked)
      })
    );
    this.saveMapState();
  }

  clearFilters(): void {
    this.minRating.set(0);
    this.nameSearch.set('');
    this.showOnlyMine.set(false);
    this.filterGroups.update(groups =>
      groups.map(g => ({ ...g, checked: true, subtypes: g.subtypes.map(s => ({ ...s, checked: true })) }))
    );
    this.saveMapState();
  }

  onNameSearchChange(value: string): void {
    this.nameSearch.set(value);
    this.saveMapState();
  }

  isMyItem(): boolean {
    const item = this.selectedItem();
    if (!item) return false;
    return this.myItemIds().has(item.id);
  }

  goToDetails(): void {
    const item = this.selectedItem();
    if (!item) return;
    this.stateService.detailsFrom.set('map');
    this.router.navigate(['/publisher-content-details', item.id]);
  }

  private mapMarkerToItem(m: any): MapItem {
    return {
      id: m.id,
      name: m.name ?? '',
      markerType: m.markerType === 'Event' ? 'Event' : m.markerType === 'Activity' ? 'Activity' : 'Object',
      subType: m.subType ?? '',
      lat: Number(m.latitude ?? 0),
      lng: Number(m.longitude ?? 0),
      address: m.address ?? '',
      description: m.description ?? '',
      rating: Number(m.averageRating ?? 0),
      reviewCount: Number(m.reviewCount ?? 0),
      image: firstAssetUrl(m) ?? FALLBACK_IMAGE_URL,
      price: Number(m.price ?? 0),
      currency: m.currency ?? 'RSD'
    };
  }

  private saveMapState(): void {
    if (!this.map || this.isRestoring) return;
    const center = this.map.getCenter();
    const selectedItem = this.selectedItem();

    this.stateService.mapState.set({
      lat: center.lat,
      lng: center.lng,
      zoom: this.map.getZoom(),
      destinationId: this.selectedDestinationId(),
      destinationName: this.destinationQuery(),
      nameSearch: this.nameSearch(),
      minRating: this.minRating(),
      selectedItemId: this.selectedItemId(),
      selectedItemLat: selectedItem?.lat ?? null,
      selectedItemLng: selectedItem?.lng ?? null,
      filterGroups: this.filterGroups()
    });

    const unchecked = [
      ...this.filterGroups().filter(g => !g.checked).map(g => `GROUP:${g.markerType}`),
      ...this.filterGroups().flatMap(g => g.subtypes.filter(s => !s.checked).map(s => s.name))
    ].join(',');

    this.router.navigate([], {
      queryParams: {
        mapLat: center.lat.toFixed(5),
        mapLng: center.lng.toFixed(5),
        mapZoom: this.map.getZoom(),
        destId: this.selectedDestinationId() ?? null,
        selectedId: this.selectedItemId() ?? null,
        nameSearch: this.nameSearch() || null,
        minRating: this.minRating() || null,
        unchecked: unchecked || null,
        onlyMine: this.showOnlyMine() ? 'true' : null
      },
      replaceUrl: true
    });
  }

  getSubtypeColor(name: string): string {
    const colors: Record<string, string> = {
      'Hotel': '#2563eb', 'Restaurant': '#dc2626', 'Museum': '#7c3aed',
      'Church': '#b45309', 'Viewpoint': '#0891b2', 'Beach': '#0d9488',
      'Hiking': '#16a34a', 'Fishing': '#0284c7', 'Cycling': '#ea580c',
      'Swimming': '#0891b2', 'Kayaking': '#0e7490', 'Concert': '#9333ea',
      'Festival': '#db2777', 'Exhibition': '#4f46e5', 'Sports': '#16a34a',
    };
    return colors[name] ?? '#6b7280';
  }

  getSubtypeEmoji(name: string): string {
    const emojis: Record<string, string> = {
      'Hotel': '🏨', 'Restaurant': '🍽️', 'Museum': '🏛️', 'Church': '⛪',
      'Viewpoint': '👁️', 'Beach': '🏖️', 'Hiking': '🥾', 'Fishing': '🎣',
      'Cycling': '🚴', 'Swimming': '🏊', 'Kayaking': '🛶', 'Concert': '🎵',
      'Festival': '🎪', 'Exhibition': '🖼️', 'Sports': '⚽',
    };
    return emojis[name] ?? '📍';
  }

  onDestinationEnter(): void {
    const query = this.destinationQuery().trim().toLowerCase();
    if (!query) return;
    const exact = this.destinations().find(d => d.name.toLowerCase() === query);
    if (exact) {
      this.selectDestination(exact);
    } else {
      this.showDestinationDropdown.set(false);
    }
  }
}
