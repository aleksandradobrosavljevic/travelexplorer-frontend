import {
  AfterViewInit,
  Component,
  HostListener,
  NgZone,
  OnDestroy,
  signal,
  computed,
  effect,
  untracked
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { ToastrService } from 'ngx-toastr';
import { catchError, of } from 'rxjs';

import { HeaderComponent } from '../../components/header/header';
import { CheckboxModule } from 'primeng/checkbox';
import { SelectModule } from 'primeng/select';
import { HttpClient } from '@angular/common/http';
import { FALLBACK_IMAGE_URL, buildApiUrl, firstAssetUrl } from '../../core/config/api';
import { FavouritesService } from '../../core/services/favourites';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import { PriceFormatService } from '../../core/services/price-format.service';
import { AuthState } from '../../core/services/auth-state.service';

type MarkerType = 'Object' | 'Event' | 'Activity';
type MapCategory = 'hotel' | 'restaurant' | 'event' | 'activity';
type RatingFilterOption = 'all' | 'good' | 'very-good' | 'excellent';
type RouteMode = 'walking' | 'driving' | 'cycling';
type RoutePointKind = 'start' | 'end';
type RoutePointSource = 'user' | 'map' | 'address';

export interface MapDataItem {
  id: number;
  name: string;
  markerType: MarkerType;
  subType: string;
  category: MapCategory;
  lat: number;
  lng: number;
  address: string;
  description: string;
  price: number | null;
  currency: string;
  reviewCount: number;
  rating: number;
  image: string;
  isFavorite: boolean;
  recentReviews: MapReviewItem[];
}

interface DestinationOption {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

interface MapSubtypeFilter {
  id?: number;
  name: string;
  checked: boolean;
}

interface MapGroupFilter {
  label: string;
  markerType: MarkerType;
  checked: boolean;
  subtypes: MapSubtypeFilter[];
}

interface MapItem extends MapDataItem {}

interface MapReviewItem {
  id: number;
  author: string;
  rating: number;
  comment: string;
  createdAt: string;
}

interface MapSelectedMarkerState {
  markerType: MarkerType;
  id: number;
  lat: number;
  lng: number;
}

interface MapReturnTarget {
  markerType: MarkerType;
  id: number;
  title?: string | null;
}

interface MapStateSnapshot {
  destinationQuery: string;
  itemSearchQuery: string;
  selectedDestinationId: number | null;
  ratingFilter?: RatingFilterOption;
  minPriceFilter?: string;
  maxPriceFilter?: string;
  sortOption?: string;
  filterGroups: MapGroupFilter[];
  center: { lat: number; lng: number } | null;
  zoom: number;
  showFilterPanel: boolean;
  selectedMarker: MapSelectedMarkerState | null;
  returnToDetails?: MapReturnTarget | null;
}

interface MapFocusState {
  markerType: MarkerType;
  id: number;
  destinationId?: number | null;
  destinationName?: string | null;
  returnToDetails?: MapReturnTarget | null;
}

interface RoutePoint {
  lat: number;
  lng: number;
  source: RoutePointSource;
  address?: string;
}

interface RouteAddressResult {
  label: string;
  lat: number;
  lng: number;
}

interface RouteSummary {
  distanceMeters: number;
  durationSeconds: number;
  mode: RouteMode;
  provider?: string;
}

interface RouteResponse extends RouteSummary {
  geometry: { lat: number; lng: number }[];
}

@Component({
  selector: 'app-maps-page',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent, CheckboxModule, SelectModule, TranslatePipe],
  templateUrl: './maps-page.html',
  styleUrl: './maps-page.css'
})
export class MapsPageComponent implements AfterViewInit, OnDestroy {
  private readonly mapStateStorageKey = 'travelExplorer.mapState';
  private readonly locationPreferenceKey = 'travelExplorer.locationEnabled';
  private readonly locationPromptSeenKey = 'travelExplorer.locationPromptSeen';
  private readonly locationPreferenceChangedEvent = 'travelExplorer.locationPreferenceChanged';
  private map!: L.Map;
  private markersLayer = L.layerGroup();
  private routeLayer = L.layerGroup();
  private userLocationMarker: L.Marker | null = null;
  private userLocationWatchId: number | null = null;
  private destinationSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private mapMoveTimer: ReturnType<typeof setTimeout> | null = null;
  private markerFilterTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressMapReloadUntil = 0;
  private pendingRestoreState: MapStateSnapshot | null = null;
  private pendingFocusState: MapFocusState | null = null;
  private readonly favouriteKeys = new Set<string>();
  private readonly favouriteRequestsInFlight = new Set<string>();
  private mapIsAnimating = false;
  private mapAnimationTimer: ReturnType<typeof setTimeout> | null = null;
  private destinationNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  private locationDeniedNoticeShown = false;
  private routeRequestId = 0;
  private suppressMarkerDetailsUntil = 0;
  private routeAddressSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly routeAddressSearchRequestIds: Record<RoutePointKind, number> = { start: 0, end: 0 };
  private readonly routeReverseGeocodeRequestIds: Record<RoutePointKind, number> = { start: 0, end: 0 };
  private readonly locationPreferenceChangedHandler = (event: Event) => {
    const enabled = !!(event as CustomEvent<boolean>).detail;

    if (enabled) {
      this.startLocationTracking(true);
      return;
    }

    this.stopLocationTracking();
  };

  readonly initialCenter: L.LatLngExpression = [20, 0];
  readonly initialZoom = 2;
  readonly destinationZoom = 13;

  readonly showLocationPrompt = signal(false);
  readonly showDestinationSuggestions = signal(false);
  readonly showDestinationNotice = signal(false);
  readonly showFilterPanel = signal(false);
  readonly showRoutePanel = signal(false);
  readonly showDetailsPanel = signal(false);
  readonly isNearbyCollapsed = signal(false);
  readonly isLocationTracking = signal(false);
  readonly userLocation = signal<{ lat: number; lng: number } | null>(null);
  readonly hasUserLocation = computed(() => !!this.userLocation());

  readonly destinationQuery = signal('');
  readonly itemSearchQuery = signal('');
  readonly selectedDestinationId = signal<number | null>(null);
  readonly ratingFilter = signal<RatingFilterOption>('all');
  readonly minPriceFilter = signal('');
  readonly maxPriceFilter = signal('');
  readonly routeMode = signal<RouteMode>('walking');
  readonly routeStart = signal<RoutePoint | null>(null);
  readonly routeEnd = signal<RoutePoint | null>(null);
  readonly armedRoutePoint = signal<RoutePointKind | null>(null);
  readonly routeLoading = signal(false);
  readonly routeError = signal('');
  readonly routeSummary = signal<RouteSummary | null>(null);
  readonly routeGeometry = signal<{ lat: number; lng: number }[]>([]);
  readonly routeAddressQueries = signal<Record<RoutePointKind, string>>({ start: '', end: '' });
  readonly routeAddressResults = signal<Record<RoutePointKind, RouteAddressResult[]>>({ start: [], end: [] });
  readonly routeAddressLoading = signal<RoutePointKind | null>(null);
  readonly routeAddressOpen = signal<RoutePointKind | null>(null);

  readonly filterGroups = signal<MapGroupFilter[]>([
    { label: 'Objects', markerType: 'Object', checked: false, subtypes: [] },
    { label: 'Events', markerType: 'Event', checked: false, subtypes: [] },
    { label: 'Activities', markerType: 'Activity', checked: false, subtypes: [] }
  ]);

  readonly selectedItem = signal<MapItem | null>(null);
  readonly allItems = signal<MapItem[]>([]);
  readonly destinations = signal<DestinationOption[]>([]);
  readonly returnToDetails = signal<MapReturnTarget | null>(null);

  readonly destinationSuggestions = computed(() => {
    return this.destinations().slice(0, 8);
  });

  readonly ratingFilterOptions: { labelKey: string; value: RatingFilterOption }[] = [
    { labelKey: 'map.ratingAny', value: 'all' },
    { labelKey: 'map.ratingGood', value: 'good' },
    { labelKey: 'map.ratingVeryGood', value: 'very-good' },
    { labelKey: 'map.ratingExcellent', value: 'excellent' }
  ];

  readonly routeModeOptions: { labelKey: string; value: RouteMode }[] = [
    { labelKey: 'map.routeWalking', value: 'walking' },
    { labelKey: 'map.routeDriving', value: 'driving' },
    { labelKey: 'map.routeCycling', value: 'cycling' }
  ];

  readonly filteredItemsForList = computed(() =>
    this.applyFiltersToItems(this.allItems())
  );

  readonly sortedNearbyItems = computed(() => {
    return this.filteredItemsForList().slice(0, 5);
  });
  readonly showNearbyStrip = computed(() =>
    !!this.selectedDestinationId() && this.sortedNearbyItems().length > 0
  );

  readonly filteredItems = computed(() =>
    this.applyFiltersToItems(this.allItems()).slice(0, this.maxMarkersForCurrentZoom())
  );

  constructor(
    private router: Router,
    private http: HttpClient,
    private zone: NgZone,
    private toastr: ToastrService,
    private favouritesService: FavouritesService,
    private translation: TranslationService,
    private priceFormat: PriceFormatService,
    private authState: AuthState
  ) {
    effect(() => {
      const items = this.filteredItems();
      const selected = this.selectedItem();
      untracked(() => this.renderMarkers(items, selected));
    });
  }

  ngAfterViewInit(): void {
    if (this.isPhoneDevice()) {
      this.isNearbyCollapsed.set(true);
    }

    this.pendingRestoreState = this.getPendingRestoreState();
    this.pendingFocusState = this.getPendingFocusState();
    this.returnToDetails.set(this.getPendingReturnToDetails());
    window.addEventListener(this.locationPreferenceChangedEvent, this.locationPreferenceChangedHandler);
    this.initMap();
    this.showTemporaryDestinationNotice();
    this.applyStoredMapStateBasics();
    this.maybeShowLocationPrompt();
    this.loadFavouriteSummary();
    this.loadDestinations();
    this.loadReferenceFilters();
    this.restoreFocusedMarker();
  }

  ngOnDestroy(): void {
    window.removeEventListener(this.locationPreferenceChangedEvent, this.locationPreferenceChangedHandler);
    if (this.destinationSearchTimer) clearTimeout(this.destinationSearchTimer);
    if (this.routeAddressSearchTimer) clearTimeout(this.routeAddressSearchTimer);
    if (this.mapMoveTimer) clearTimeout(this.mapMoveTimer);
    if (this.markerFilterTimer) clearTimeout(this.markerFilterTimer);
    if (this.mapAnimationTimer) clearTimeout(this.mapAnimationTimer);
    if (this.destinationNoticeTimer) clearTimeout(this.destinationNoticeTimer);
    this.stopLocationTracking(false);
    if (this.map) this.map.remove();
  }

  private initMap(): void {
    this.map = L.map('map', {
      zoomControl: false,
      minZoom: 2,
      maxZoom: 18,
      worldCopyJump: false,
      maxBounds: [[-90, -180], [90, 180]],
      maxBoundsViscosity: 1.0
    }).setView(this.initialCenter, this.initialZoom);

    L.control.zoom({ position: 'topleft' }).addTo(this.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      noWrap: true,
      bounds: [[-90, -180], [90, 180]]
    }).addTo(this.map);

    this.markersLayer.addTo(this.map);
    this.routeLayer.addTo(this.map);
    this.map.on('click', event => this.zone.run(() => this.handleRouteMapClick(event)));

    this.map.on('movestart zoomstart', () => {
      this.mapIsAnimating = true;
      if (this.mapAnimationTimer) clearTimeout(this.mapAnimationTimer);
    });

    this.map.on('moveend zoomend', () => {
      if (this.mapAnimationTimer) clearTimeout(this.mapAnimationTimer);
      this.mapAnimationTimer = setTimeout(() => {
        this.mapIsAnimating = false;
        this.renderMarkers(this.filteredItems());
      }, 100);

      this.onMapViewChanged();
    });

    setTimeout(() => {
      const minZoom = this.calculateMinZoom();
      this.map.setMinZoom(minZoom);
      if (!this.pendingRestoreState && !this.pendingFocusState) {
        this.map.setView(this.initialCenter, minZoom, { animate: false });
      }
    }, 0);
  }

  private calculateMinZoom(): number {
    const container = this.map.getContainer();
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const zoomX = Math.log2(w / 256);
    const zoomY = Math.log2(h / 256);
    return Math.ceil(Math.max(zoomX, zoomY) * 10) / 10;
  }

  private loadDestinations(): void {
    this.loadDestinationSuggestions(this.destinationQuery(), true);
  }

  private loadDestinationSuggestions(query: string, restoreStoredState = false): void {
    const params = new URLSearchParams({ page: '1', pageSize: '8' });
    const search = query.trim();
    if (search) {
      params.set('search', search);
    }

    this.http.get<any>(buildApiUrl(`destinations?${params.toString()}`)).subscribe({
      next: response => {
        const rows = Array.isArray(response) ? response : response?.items ?? response?.data ?? [];
        this.destinations.set(
          rows
            .map((d: any) => ({
              id: Number(d.id),
              name: d.name ?? '',
              latitude: this.toNumberOrNull(d.latitude),
              longitude: this.toNumberOrNull(d.longitude)
            }))
            .filter((d: DestinationOption) => d.id && d.name)
        );

        if (restoreStoredState) {
          this.restoreMarkersFromStoredState();
        }
      },
      error: () => this.destinations.set([])
    });
  }

  private loadReferenceFilters(): void {
    this.loadReferenceGroup('Object', 'reference-data/object-types');
    this.loadReferenceGroup('Event', 'reference-data/event-types');
    this.loadReferenceGroup('Activity', 'reference-data/activity-types');
  }

  private loadReferenceGroup(markerType: MarkerType, endpoint: string): void {
    this.http.get<any[]>(buildApiUrl(endpoint)).subscribe({
      next: types => {
        this.filterGroups.update(groups =>
          groups.map(group => {
            if (group.markerType !== markerType) return group;
            return {
              ...group,
              subtypes: (types ?? [])
                .map(type => ({ id: Number(type.id) || undefined, name: type.name ?? '', checked: false }))
                .filter(type => type.name)
            };
          })
        );
        this.applyStoredFilterState();
      },
      error: () => {}
    });
  }

  private loadMarkersForCurrentView(): void {
    if (!this.map) return;
    const center = this.map.getCenter();
    this.loadMarkers({ lat: center.lat, lng: center.lng });
  }

  private loadMarkers(options: { destinationId?: number | null; lat?: number; lng?: number }): void {
    const markerTypes = this.selectedMarkerTypes;
    if (markerTypes.length === 0) {
      this.allItems.set([]);
      return;
    }

    const params = new URLSearchParams();
    markerTypes.forEach(type => params.append('types', type));
    this.appendMarkerFilterParams(params);

    if (options.destinationId) {
      params.set('destinationId', String(options.destinationId));
    } else if (options.lat != null && options.lng != null) {
      params.set('userLat', options.lat.toFixed(6));
      params.set('userLng', options.lng.toFixed(6));
    }

    const query = params.toString();
    this.http.get<any[]>(buildApiUrl(`map/markers/filtered${query ? `?${query}` : ''}`)).subscribe({
      next: response => {
        const items = (response ?? []).map(marker => this.mapMarkerToItem(marker));
        this.syncFavouriteState(items);
        this.ensureSubtypeFiltersFromItems(items);

        if (options.destinationId) {
          const delay = this.mapIsAnimating ? 900 : 0;
          setTimeout(() => {
            this.suppressMapReloadUntil = Date.now() + 1500;
            this.allItems.set(items);
            this.applyRestoredSelectedMarker(items);
            this.applyFocusedMarkerFromItems(items);
          }, delay);
          return;
        }

        this.allItems.set(items);
        this.applyRestoredSelectedMarker(items);
        this.applyFocusedMarkerFromItems(items);
      },
      error: () => this.allItems.set([])
    });
  }

  private onMapViewChanged(): void {
    if (
      Date.now() < this.suppressMapReloadUntil ||
      (this.showDetailsPanel() && this.selectedItem())
    ) {
      this.renderMarkers(this.filteredItems());
      return;
    }

    if (this.selectedDestinationId()) {
      this.renderMarkers(this.filteredItems());
      return;
    }

    if (this.isLocationTracking() && this.userLocation()) {
      this.renderMarkers(this.filteredItems());
      return;
    }

    if (!this.itemSearchQuery().trim()) {
      this.allItems.set([]);
      return;
    }

    if (this.mapMoveTimer) clearTimeout(this.mapMoveTimer);
    this.mapMoveTimer = setTimeout(() => this.loadMarkersForCurrentView(), 300);
  }

  onDestinationSearchChange(): void {
    if (this.destinationSearchTimer) clearTimeout(this.destinationSearchTimer);
    this.showDestinationSuggestions.set(true);
    const query = this.destinationQuery().trim();

    if (!query) {
      this.selectedDestinationId.set(null);
      this.allItems.set([]);
      this.destinationSearchTimer = setTimeout(() => this.loadDestinationSuggestions(''), 200);
      return;
    }

    const selectedDestination = this.selectedDestinationId()
      ? this.destinations().find(destination => destination.id === this.selectedDestinationId())
      : null;

    if (
      this.selectedDestinationId() &&
      (!selectedDestination ||
      this.normalize(selectedDestination.name) !== this.normalize(this.destinationQuery())
      )
    ) {
      this.selectedDestinationId.set(null);
      this.allItems.set([]);
    }

    this.destinationSearchTimer = setTimeout(() => this.loadDestinationSuggestions(query), 250);
  }

  selectDestinationSuggestion(destination: DestinationOption): void {
    this.destinationQuery.set(destination.name);
    this.showDestinationSuggestions.set(false);
    this.applyDestinationSearch();
  }

  applyDestinationSearch(): void {
    this.showDestinationSuggestions.set(false);
    const query = this.normalize(this.destinationQuery());
    if (!query) {
      this.selectedDestinationId.set(null);
      this.allItems.set([]);
      return;
    }

    const destination = this.destinations().find(d => this.normalize(d.name) === query);

    if (!destination) return;

    this.allItems.set([]);
    this.selectedDestinationId.set(destination.id);
    this.destinationQuery.set(destination.name);
    this.mapIsAnimating = true;

    if (destination.latitude != null && destination.longitude != null) {
      this.map.flyTo([destination.latitude, destination.longitude], this.destinationZoom, { duration: 0.8 });
    }

    this.loadMarkers({ destinationId: destination.id });
  }

  applyItemSearch(): void {
    this.scheduleMarkerReload();
  }

  clearItemSearch(): void {
    this.itemSearchQuery.set('');
    this.scheduleMarkerReload();
  }

  clearDestinationSearch(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.destinationSearchTimer) clearTimeout(this.destinationSearchTimer);

    this.destinationQuery.set('');
    this.selectedDestinationId.set(null);
    this.allItems.set([]);
    this.selectedItem.set(null);
    this.showDetailsPanel.set(false);
    this.showDestinationSuggestions.set(false);
    this.loadDestinationSuggestions('');
  }

  openDestinationSuggestions(event?: Event): void {
    event?.stopPropagation();
    this.showDestinationSuggestions.set(true);
    this.showDetailsPanel.set(false);
    this.showRoutePanel.set(false);
    this.armedRoutePoint.set(null);
  }

  toggleGroup(group: MapGroupFilter): void {
    this.filterGroups.update(groups =>
      groups.map(current =>
        current.markerType !== group.markerType
          ? current
          : {
              ...current,
              checked: group.checked,
              subtypes: current.subtypes.map(subtype => ({ ...subtype, checked: false }))
            }
      )
    );
    this.scheduleMarkerReload();
  }

  toggleSubtype(group: MapGroupFilter): void {
    this.filterGroups.update(groups =>
      groups.map(current =>
        current.markerType !== group.markerType
          ? current
          : {
              ...current,
              checked: current.subtypes.length === 0 || current.subtypes.some(subtype => subtype.checked)
            }
      )
    );
    this.scheduleMarkerReload();
  }

  clearFilters(): void {
    this.filterGroups.update(groups =>
      groups.map(group => ({
        ...group,
        checked: false,
        subtypes: group.subtypes.map(subtype => ({ ...subtype, checked: false }))
      }))
    );
    this.itemSearchQuery.set('');
    this.ratingFilter.set('all');
    this.minPriceFilter.set('');
    this.maxPriceFilter.set('');
    this.scheduleMarkerReload();
  }

  toggleNearbyPanel(): void {
    this.isNearbyCollapsed.update(value => !value);
  }

  allowLocation(): void {
    this.showLocationPrompt.set(false);
    localStorage.setItem(this.locationPreferenceKey, 'true');
    localStorage.setItem(this.locationPromptSeenKey, 'true');
    this.locationDeniedNoticeShown = false;
    this.startLocationTracking(true);
  }

  openLocationPrompt(): void {
    this.showLocationPrompt.set(true);
  }

  notNow(): void {
    this.showLocationPrompt.set(false);
    localStorage.setItem(this.locationPromptSeenKey, 'true');
  }

  openFilterPanel(): void {
    this.showFilterPanel.update(value => !value);
    if (this.showFilterPanel()) {
      this.showDetailsPanel.set(false);
      this.showRoutePanel.set(false);
      this.armedRoutePoint.set(null);
    }
  }

  closeFilterPanel(): void {
    this.showFilterPanel.set(false);
  }

  toggleRoutePanel(): void {
    this.showRoutePanel.update(value => !value);
    if (!this.showRoutePanel()) {
      this.armedRoutePoint.set(null);
      return;
    }

    this.showFilterPanel.set(false);
    this.showDetailsPanel.set(false);
    this.showDestinationSuggestions.set(false);
    this.primeRouteStartFromUserLocation(false);
  }

  closeRoutePanel(): void {
    this.showRoutePanel.set(false);
    this.armedRoutePoint.set(null);
    this.routeAddressOpen.set(null);
  }

  dismissDestinationNotice(): void {
    if (this.destinationNoticeTimer) {
      clearTimeout(this.destinationNoticeTimer);
      this.destinationNoticeTimer = null;
    }

    this.showDestinationNotice.set(false);
  }

  setRouteMode(mode: RouteMode): void {
    this.routeMode.set(mode);
    if (this.routeStart() && this.routeEnd()) {
      this.calculateRoute();
    }
  }

  armRoutePoint(kind: RoutePointKind): void {
    this.showRoutePanel.set(true);
    this.showFilterPanel.set(false);
    this.showDetailsPanel.set(false);
    this.routeError.set('');
    this.armedRoutePoint.set(kind);
  }

  refreshRouteStartFromUserLocation(): void {
    if (!this.userLocation()) {
      this.openLocationPrompt();
      return;
    }

    this.primeRouteStartFromUserLocation(true);
  }

  clearRoute(): void {
    this.routeRequestId++;
    this.routeStart.set(null);
    this.routeEnd.set(null);
    this.armedRoutePoint.set(null);
    this.routeLoading.set(false);
    this.routeError.set('');
    this.routeSummary.set(null);
    this.routeGeometry.set([]);
    this.routeAddressQueries.set({ start: '', end: '' });
    this.routeAddressResults.set({ start: [], end: [] });
    this.routeAddressLoading.set(null);
    this.routeAddressOpen.set(null);
    if (this.routeAddressSearchTimer) clearTimeout(this.routeAddressSearchTimer);
    this.routeLayer.clearLayers();
  }

  recenterMap(): void {
    if (!this.map) return;

    const userLocation = this.userLocation();
    this.selectedDestinationId.set(null);
    this.destinationQuery.set('');
    this.showDestinationSuggestions.set(false);
    this.itemSearchQuery.set('');
    this.showDetailsPanel.set(false);
    this.selectedItem.set(null);

    if (userLocation) {
      this.mapIsAnimating = true;
      this.map.flyTo([userLocation.lat, userLocation.lng], 16, { duration: 0.8 });
      this.loadMarkersAroundUserLocation();
      return;
    }

    this.allItems.set([]);
    const minZoom = this.map.getMinZoom();
    this.map.flyTo(this.initialCenter, minZoom, { duration: 1 });
  }

  handleLocationButton(): void {
    if (this.userLocation()) {
      this.recenterMap();
      return;
    }

    if (localStorage.getItem(this.locationPreferenceKey) === 'true') {
      this.startLocationTracking(true);
      return;
    }

    this.openLocationPrompt();
  }

  @HostListener('document:click', ['$event'])
  closeFloatingMapMenus(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.search-box')) {
      this.showDestinationSuggestions.set(false);
    }
  }

  focusItem(item: MapItem): void {
    this.openDetails(item);
  }

  openDetails(item: MapItem): void {
    this.selectedItem.set(item);
    this.showDetailsPanel.set(true);
    this.showFilterPanel.set(false);
    this.showRoutePanel.set(false);
    this.armedRoutePoint.set(null);
    this.isNearbyCollapsed.set(true);

    if (this.map) {
      this.suppressMapReloadUntil = Date.now() + 1400;
      this.map.flyTo([item.lat, item.lng], 15, { duration: 1 });
      if (this.isPhoneDevice()) {
        setTimeout(() => this.map?.panBy([0, -110], { animate: true, duration: 0.35 }), 700);
      }
    }
  }

  closeDetails(): void {
    this.showDetailsPanel.set(false);
    this.selectedItem.set(null);
    this.renderMarkers(this.filteredItems(), null);
    if (!this.selectedDestinationId() && !this.itemSearchQuery().trim()) {
      this.allItems.set([]);
    }
  }

  goToDetailsPage(item?: MapItem, event?: MouseEvent): void {
    event?.stopPropagation();
    const target = item ?? this.selectedItem();
    if (!target) return;

    const mapState = this.persistMapState(target);
    this.router.navigate(
      ['/details', this.markerTypeToRouteType(target.markerType), target.id],
      { state: { fromMap: true, mapState } }
    );
  }

  goBackToSourceDetails(): void {
    const target = this.returnToDetails();
    if (!target) return;

    const mapState = this.persistMapState(this.selectedItem() ?? undefined);
    this.router.navigate(
      ['/details', this.markerTypeToRouteType(target.markerType), target.id],
      { state: { fromMap: true, mapState } }
    );
  }

  toggleFavourite(item: MapItem, event?: MouseEvent): void {
    event?.stopPropagation();
    if (!this.authState.isLoggedIn()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }

    if (!this.canUseFavourites()) return;

    const key = this.toFavouriteKey(item.markerType, item.id);
    if (this.favouriteRequestsInFlight.has(key)) return;

    const previousState = item.isFavorite;
    const nextState = !previousState;
    this.favouriteRequestsInFlight.add(key);
    this.updateFavouriteState(item.markerType, item.id, nextState);

    this.favouritesService.toggleFavourite(item.markerType, item.id).subscribe({
      next: response => {
        this.updateFavouriteState(item.markerType, item.id, !!response?.isSaved);
      },
      error: error => {
        this.favouriteRequestsInFlight.delete(key);
        this.updateFavouriteState(item.markerType, item.id, previousState);
        if (error?.status === 401 || error?.status === 403) {
          this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
        } else {
          this.toastr.error(this.translation.translate('favourites.updateError'));
        }
      },
      complete: () => {
        this.favouriteRequestsInFlight.delete(key);
      }
    });
  }

  hasDisplayPrice(item: MapItem): boolean {
    return item.price != null;
  }

  formatPrice(price: number | null, currency: string | null = 'RSD'): string {
    if (price == null) return '';
    return this.priceFormat.formatPrice(price, currency);
  }

  getPriceSuffix(category: MapCategory): string {
    if (category === 'restaurant') return this.translation.translate('price.meal');
    if (category === 'event') return this.translation.translate('price.ticket');
    if (category === 'activity') return this.translation.translate('price.activity');
    return this.translation.translate('price.night');
  }

  getFilterGroupLabel(group: MapGroupFilter): string {
    if (group.markerType === 'Object') return this.translation.translate('entity.objects');
    if (group.markerType === 'Activity') return this.translation.translate('entity.activities');
    return this.translation.translate('entity.events');
  }

  reviewsLabel(count: number): string {
    return count === 1
      ? this.translation.translate('reviews.one')
      : this.translation.translate('reviews.many');
  }

  getDestinationQuery(): string {
    return this.destinationQuery();
  }

  setDestinationQuery(value: string): void {
    this.destinationQuery.set(value);
  }

  getItemSearchQuery(): string {
    return this.itemSearchQuery();
  }

  setItemSearchQuery(value: string): void {
    this.itemSearchQuery.set(value);
  }

  getRatingFilter(): RatingFilterOption {
    return this.ratingFilter();
  }

  setRatingFilter(value: RatingFilterOption): void {
    this.ratingFilter.set(value ?? 'all');
    this.scheduleMarkerReload();
  }

  setMinPriceFilter(value: string | number | null): void {
    this.minPriceFilter.set(this.normalizePriceFilterInput(value));
    this.scheduleMarkerReload();
  }

  setMaxPriceFilter(value: string | number | null): void {
    this.maxPriceFilter.set(this.normalizePriceFilterInput(value));
    this.scheduleMarkerReload();
  }

  onRouteAddressQueryChange(kind: RoutePointKind, value: string): void {
    this.routeAddressQueries.update(current => ({ ...current, [kind]: value }));
    this.routeAddressOpen.set(kind);

    if (this.routeAddressSearchTimer) {
      clearTimeout(this.routeAddressSearchTimer);
    }

    if (value.trim().length < 3) {
      this.routeAddressResults.update(current => ({ ...current, [kind]: [] }));
      if (this.routeAddressLoading() === kind) this.routeAddressLoading.set(null);
      return;
    }

    this.routeAddressLoading.set(kind);
    this.routeAddressSearchTimer = setTimeout(() => this.searchRouteAddress(kind), 350);
  }

  openRouteAddressSearch(kind: RoutePointKind): void {
    this.compactRouteAddressQuery(kind);
    this.routeAddressOpen.set(kind);
  }

  searchRouteAddress(kind: RoutePointKind, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    const query = this.routeAddressQueries()[kind].trim();
    if (query.length < 3) {
      this.routeAddressResults.update(current => ({ ...current, [kind]: [] }));
      return;
    }

    const requestId = ++this.routeAddressSearchRequestIds[kind];
    this.routeAddressLoading.set(kind);
    this.routeAddressOpen.set(kind);

    this.http.get<RouteAddressResult[]>(buildApiUrl(`map/geocode?query=${encodeURIComponent(query)}`)).subscribe({
      next: results => {
        if (requestId !== this.routeAddressSearchRequestIds[kind]) return;

        this.routeAddressResults.update(current => ({
          ...current,
          [kind]: (results ?? [])
            .filter(result => Number.isFinite(result.lat) && Number.isFinite(result.lng) && !!result.label?.trim())
            .slice(0, 5)
        }));
      },
      error: () => {
        if (requestId !== this.routeAddressSearchRequestIds[kind]) return;

        this.routeAddressResults.update(current => ({ ...current, [kind]: [] }));
        this.routeError.set(this.translation.translate('map.routeAddressError'));
      },
      complete: () => {
        if (requestId === this.routeAddressSearchRequestIds[kind] && this.routeAddressLoading() === kind) {
          this.routeAddressLoading.set(null);
        }
      }
    });
  }

  selectRouteAddress(kind: RoutePointKind, result: RouteAddressResult, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    const address = result.label.trim();
    this.routeAddressQueries.update(current => ({ ...current, [kind]: address }));
    this.routeAddressResults.update(current => ({ ...current, [kind]: [] }));
    this.routeAddressOpen.set(null);

    if (this.map) {
      this.suppressMapReloadUntil = Date.now() + 900;
      this.map.flyTo([result.lat, result.lng], Math.max(this.map.getZoom(), 15), { duration: 0.5 });
    }

    this.setRoutePoint(kind, {
      lat: result.lat,
      lng: result.lng,
      source: 'address',
      address
    });
  }

  routeAddressNoResults(kind: RoutePointKind): boolean {
    return this.routeAddressOpen() === kind
      && this.routeAddressQueries()[kind].trim().length >= 3
      && this.routeAddressLoading() !== kind
      && this.routeAddressResults()[kind].length === 0;
  }

  routePointText(kind: RoutePointKind): string {
    const point = this.routePointForKind(kind);
    if (!point) return this.translation.translate('map.routePointMissing');

    return this.disambiguateRoutePointLabel(kind, point, this.routePointBaseText(point));
  }

  routeAddressQueryText(kind: RoutePointKind): string {
    const value = this.routeAddressQueries()[kind];
    if (this.routeAddressOpen() === kind) return value;

    const point = this.routePointForKind(kind);
    if (!point) return value;

    return this.disambiguateRoutePointLabel(kind, point, this.compactRouteLocationLabel(value));
  }

  routeActionLabel(kind: RoutePointKind): string {
    return (kind === 'start' ? this.routeStart() : this.routeEnd())
      ? this.translation.translate('map.routeChange')
      : this.translation.translate(kind === 'start' ? 'map.routeChooseStart' : 'map.routeChooseEnd');
  }

  formatRouteDistance(meters: number): string {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.max(1, Math.round(meters))} m`;
  }

  formatRouteDuration(seconds: number): string {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
  }

  private isPhoneDevice(): boolean {
    const width = window.innerWidth || document.documentElement.clientWidth;
    const userAgent = navigator.userAgent.toLowerCase();
    return width <= 767 || /iphone|ipod|android.*mobile|windows phone/.test(userAgent);
  }

  private getPendingFocusState(): MapFocusState | null {
    const state = window.history.state as { focusMapItem?: MapFocusState } | null;
    const focus = state?.focusMapItem;
    if (!focus?.id) return null;

    return {
      markerType: this.toMarkerType(focus.markerType),
      id: Number(focus.id),
      destinationId: this.toNumberOrNull(focus.destinationId),
      destinationName: focus.destinationName ?? null,
      returnToDetails: this.normalizeMapReturnTarget(focus.returnToDetails)
    };
  }

  private getPendingReturnToDetails(): MapReturnTarget | null {
    return this.pendingFocusState?.returnToDetails
      ?? this.normalizeMapReturnTarget(this.pendingRestoreState?.returnToDetails)
      ?? null;
  }

  private restoreFocusedMarker(): void {
    const focus = this.pendingFocusState;
    if (!focus) return;

    if (focus.destinationId) {
      this.selectedDestinationId.set(focus.destinationId);
      this.destinationQuery.set(focus.destinationName ?? this.destinationQuery());
      this.loadMarkers({ destinationId: focus.destinationId });
      return;
    }

    this.http.get<any>(
      buildApiUrl(`map/marker-location?markerType=${focus.markerType}&id=${focus.id}`)
    ).subscribe({
      next: marker => {
        const item = this.mapMarkerToItem(marker);
        this.syncFavouriteState([item]);
        this.allItems.set([item]);
        this.pendingFocusState = null;
        this.openDetails(item);
      },
      error: () => {}
    });
  }

  private loadFavouriteSummary(): void {
    if (!this.canUseFavourites()) return;

    this.http.get<any>(buildApiUrl('favourites/summary?previewCount=0'))
      .pipe(catchError(() => of({})))
      .subscribe(summary => {
      this.favouriteKeys.clear();

      for (const id of summary?.savedObjectIds ?? []) {
        if (id) this.favouriteKeys.add(this.toFavouriteKey('Object', id));
      }

      for (const id of summary?.savedActivityIds ?? []) {
        if (id) this.favouriteKeys.add(this.toFavouriteKey('Activity', id));
      }

      for (const id of summary?.savedEventIds ?? []) {
        if (id) this.favouriteKeys.add(this.toFavouriteKey('Event', id));
      }

      for (const item of summary?.objects ?? []) {
        if (item?.objectId) this.favouriteKeys.add(this.toFavouriteKey('Object', item.objectId));
      }

      for (const item of summary?.activities ?? []) {
        if (item?.activityId) this.favouriteKeys.add(this.toFavouriteKey('Activity', item.activityId));
      }

      for (const item of summary?.events ?? []) {
        if (item?.eventId) this.favouriteKeys.add(this.toFavouriteKey('Event', item.eventId));
      }

      this.allItems.update(items => {
        const nextItems = items.map(item => ({
          ...item,
          isFavorite: this.isFavourite(item.markerType, item.id)
        }));
        this.selectedItem.update(selected => selected
          ? nextItems.find(item => item.id === selected.id && item.markerType === selected.markerType) ?? selected
          : selected);
        return nextItems;
      });
    });
  }

  private syncFavouriteState(items: MapItem[]): void {
    items.forEach(item => {
      item.isFavorite = this.isFavourite(item.markerType, item.id);
    });
  }

  private updateFavouriteState(markerType: MarkerType, id: number, isSaved: boolean): void {
    const key = this.toFavouriteKey(markerType, id);
    if (isSaved) this.favouriteKeys.add(key);
    else this.favouriteKeys.delete(key);

    this.allItems.update(items =>
      items.map(item =>
        item.id === id && item.markerType === markerType
          ? { ...item, isFavorite: isSaved }
          : item
      )
    );

    const selected = this.selectedItem();
    if (selected?.id === id && selected.markerType === markerType) {
      this.selectedItem.set({ ...selected, isFavorite: isSaved });
    }
  }

  private isFavourite(markerType: MarkerType, id: number): boolean {
    return this.favouriteKeys.has(this.toFavouriteKey(markerType, id));
  }

  private toFavouriteKey(markerType: MarkerType, id: number): string {
    return `${markerType}:${id}`;
  }

  private canUseFavourites(): boolean {
    return this.authState.isLoggedIn()
      && (this.authState.getUserRole() ?? '').toLowerCase() === 'tourist';
  }

  private handleRouteMapClick(event: L.LeafletMouseEvent): void {
    const armedPoint = this.armedRoutePoint();
    if (!armedPoint || !this.showRoutePanel()) return;

    this.setRoutePoint(armedPoint, {
      lat: event.latlng.lat,
      lng: event.latlng.lng,
      source: 'map'
    });
  }

  private primeRouteStartFromUserLocation(force: boolean): void {
    const userLocation = this.userLocation();
    if (!userLocation) return;

    const currentStart = this.routeStart();
    if (!force && currentStart && currentStart.source !== 'user') return;
    if (!force && currentStart) return;

    this.setRoutePoint('start', {
      lat: userLocation.lat,
      lng: userLocation.lng,
      source: 'user'
    }, false);
  }

  private setRoutePoint(kind: RoutePointKind, point: RoutePoint, shouldCalculate = true): void {
    const normalizedPoint: RoutePoint = point.address?.trim()
      ? { ...point, address: this.compactRouteLocationLabel(point.address) }
      : point;

    if (kind === 'start') {
      this.routeStart.set(normalizedPoint);
    } else {
      this.routeEnd.set(normalizedPoint);
    }

    this.armedRoutePoint.set(null);
    this.routeAddressOpen.set(null);
    this.routeAddressResults.update(current => ({ ...current, [kind]: [] }));
    if (normalizedPoint.address?.trim()) {
      this.routeAddressQueries.update(current => ({ ...current, [kind]: normalizedPoint.address!.trim() }));
    } else if (normalizedPoint.source !== 'user') {
      this.routeAddressQueries.update(current => ({ ...current, [kind]: '' }));
    }
    this.routeError.set('');
    this.routeSummary.set(null);
    this.routeGeometry.set([]);
    this.renderRoute();
    this.resolveRoutePointAddress(kind, normalizedPoint);

    if (shouldCalculate && this.routeStart() && this.routeEnd()) {
      this.calculateRoute();
    }
  }

  private resolveRoutePointAddress(kind: RoutePointKind, point: RoutePoint): void {
    if (point.address?.trim()) return;

    const requestId = ++this.routeReverseGeocodeRequestIds[kind];
    const params = new URLSearchParams({
      lat: point.lat.toFixed(6),
      lng: point.lng.toFixed(6)
    });

    this.http.get<RouteAddressResult>(buildApiUrl(`map/reverse-geocode?${params.toString()}`)).subscribe({
      next: result => {
        if (requestId !== this.routeReverseGeocodeRequestIds[kind]) return;
        const address = this.compactRouteLocationLabel(result?.label);
        if (!address) return;

        const current = kind === 'start' ? this.routeStart() : this.routeEnd();
        if (!current || !this.sameRoutePoint(current, point)) return;

        const nextPoint = { ...current, address };
        if (kind === 'start') {
          this.routeStart.set(nextPoint);
        } else {
          this.routeEnd.set(nextPoint);
        }

        this.routeAddressQueries.update(currentQueries => ({ ...currentQueries, [kind]: address }));
      },
      error: () => {}
    });
  }

  private compactRouteLocationLabel(value: string | null | undefined): string {
    const raw = (value ?? '').trim();
    const parts = raw
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
    const compactParts = parts.filter(part => !this.isShortAdministrativeCode(part));

    if (compactParts.length !== parts.length) {
      return compactParts.join(', ');
    }

    return raw;
  }

  private compactRouteAddressQuery(kind: RoutePointKind): void {
    const currentValue = this.routeAddressQueries()[kind];
    const compactValue = this.compactRouteLocationLabel(currentValue);
    if (compactValue === currentValue) return;

    this.routeAddressQueries.update(current => ({ ...current, [kind]: compactValue }));
  }

  private routePointForKind(kind: RoutePointKind): RoutePoint | null {
    return kind === 'start' ? this.routeStart() : this.routeEnd();
  }

  private routePointBaseText(point: RoutePoint): string {
    if (point.address?.trim()) return this.compactRouteLocationLabel(point.address);
    if (point.source === 'user') return this.translation.translate('map.routePointCurrentLocation');
    return this.translation.translate('map.routePointSelected');
  }

  private disambiguateRoutePointLabel(kind: RoutePointKind, point: RoutePoint, label: string): string {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) return trimmedLabel;

    const otherKind: RoutePointKind = kind === 'start' ? 'end' : 'start';
    const otherPoint = this.routePointForKind(otherKind);
    if (!otherPoint || this.sameRoutePoint(point, otherPoint)) return trimmedLabel;

    const otherLabel = this.routePointBaseText(otherPoint);
    return this.sameRouteLabel(trimmedLabel, otherLabel)
      ? `${trimmedLabel} (${this.formatRoutePointCoordinates(point)})`
      : trimmedLabel;
  }

  private sameRouteLabel(first: string, second: string): boolean {
    return first.trim().toLocaleLowerCase() === second.trim().toLocaleLowerCase();
  }

  private formatRoutePointCoordinates(point: RoutePoint): string {
    return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
  }

  private isShortAdministrativeCode(value: string): boolean {
    const text = value.trim();
    return text.length > 0
      && text.length <= 3
      && text === text.toUpperCase()
      && /^[\p{Lu}]+$/u.test(text);
  }

  private sameRoutePoint(first: RoutePoint, second: RoutePoint): boolean {
    return Math.abs(first.lat - second.lat) < 0.000001
      && Math.abs(first.lng - second.lng) < 0.000001;
  }

  private calculateRoute(): void {
    const start = this.routeStart();
    const end = this.routeEnd();
    if (!start || !end) return;

    const params = new URLSearchParams({
      mode: this.routeMode(),
      startLat: start.lat.toFixed(6),
      startLng: start.lng.toFixed(6),
      endLat: end.lat.toFixed(6),
      endLng: end.lng.toFixed(6)
    });

    const requestId = ++this.routeRequestId;
    this.routeLoading.set(true);
    this.routeError.set('');

    this.http.get<RouteResponse>(buildApiUrl(`map/route?${params.toString()}`)).subscribe({
      next: response => {
        if (requestId !== this.routeRequestId) return;

        this.routeGeometry.set(response.geometry ?? []);
        this.routeSummary.set({
          distanceMeters: Number(response.distanceMeters ?? 0),
          durationSeconds: Number(response.durationSeconds ?? 0),
          mode: this.routeMode(),
          provider: response.provider
        });
        this.renderRoute(true);
      },
      error: error => {
        if (requestId !== this.routeRequestId) return;

        this.routeGeometry.set([]);
        this.routeSummary.set(null);
        this.routeError.set(typeof error?.error === 'string' && error.error.trim()
          ? error.error
          : this.translation.translate('map.routeError'));
        this.routeLoading.set(false);
        this.renderRoute();
      },
      complete: () => {
        if (requestId === this.routeRequestId) this.routeLoading.set(false);
      }
    });
  }

  private renderRoute(fitRoute = false): void {
    if (!this.map) return;

    this.routeLayer.clearLayers();
    const geometry = this.routeGeometry();

    if (geometry.length > 1) {
      const line = L.polyline(
        geometry.map(point => [point.lat, point.lng] as L.LatLngExpression),
        {
          color: '#1d3557',
          weight: 6,
          opacity: 0.88,
          lineCap: 'round',
          lineJoin: 'round'
        }
      );
      this.routeLayer.addLayer(line);

      if (fitRoute) {
        this.suppressMapReloadUntil = Date.now() + 1200;
        this.map.fitBounds(line.getBounds(), {
          paddingTopLeft: [80, 120],
          paddingBottomRight: [360, 160],
          maxZoom: 16
        });
      }
    }

    const start = this.routeStart();
    const end = this.routeEnd();
    if (start) {
      this.routeLayer.addLayer(this.createRoutePointMarker('start', start));
    }
    if (end) {
      this.routeLayer.addLayer(this.createRoutePointMarker('end', end));
    }
  }

  private createRoutePointMarker(kind: RoutePointKind, point: RoutePoint): L.Marker {
    return L.marker([point.lat, point.lng], {
      icon: this.createRoutePointIcon(kind),
      interactive: false,
      zIndexOffset: 2600
    });
  }

  private renderMarkers(items: MapItem[], selectedItem: MapItem | null = this.selectedItem()): void {
    if (!this.map) return;

    this.markersLayer.clearLayers();

    const offsetItems = this.applyOverlapOffsets(items);

    offsetItems.forEach(({ item, lat, lng }) => {
      const isSelected = !!selectedItem && selectedItem.id === item.id && selectedItem.markerType === item.markerType;
      const marker = L.marker([lat, lng], {
        icon: this.createCategoryIcon(item.category, isSelected),
        zIndexOffset: isSelected ? 2000 : 0
      });

      marker.on('click', event => this.openDetailsFromMarker(item, event.originalEvent));
      marker.on('add', () => this.wireMarkerElement(marker, item));

      this.markersLayer.addLayer(marker);
      this.wireMarkerElement(marker, item);
    });
  }

  private applyOverlapOffsets(items: MapItem[]): { item: MapItem; lat: number; lng: number }[] {
    const key = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const groups = new Map<string, MapItem[]>();

    items.forEach(item => {
      const coordinateKey = key(item.lat, item.lng);
      if (!groups.has(coordinateKey)) groups.set(coordinateKey, []);
      groups.get(coordinateKey)!.push(item);
    });

    const result: { item: MapItem; lat: number; lng: number }[] = [];

    groups.forEach(group => {
      if (group.length === 1) {
        result.push({ item: group[0], lat: group[0].lat, lng: group[0].lng });
        return;
      }

      const offsetDeg = 0.0004;
      const angleStep = (2 * Math.PI) / group.length;

      group.forEach((item, index) => {
        const angle = index * angleStep;
        result.push({
          item,
          lat: item.lat + offsetDeg * Math.sin(angle),
          lng: item.lng + offsetDeg * Math.cos(angle)
        });
      });
    });

    return result;
  }

  private wireMarkerElement(marker: L.Marker, item: MapItem): void {
    const element = marker.getElement();
    if (!element || element.dataset['detailsWired'] === 'true') return;

    element.dataset['detailsWired'] = 'true';
    element.setAttribute('aria-label', item.name);
    element.setAttribute('tabindex', '0');

    element.addEventListener('click', event => this.openDetailsFromMarker(item, event), true);
    element.addEventListener('touchstart', event => this.openDetailsFromMarker(item, event), { passive: false, capture: true });
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        this.openDetailsFromMarker(item, event);
      }
    });
  }

  private openDetailsFromMarker(item: MapItem, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    const armedPoint = this.armedRoutePoint();
    if (armedPoint && this.showRoutePanel()) {
      this.suppressMarkerDetailsUntil = Date.now() + 600;
      this.zone.run(() => this.setRoutePoint(armedPoint, {
        lat: item.lat,
        lng: item.lng,
        source: 'map',
        address: item.address || item.name || item.subType
      }));
      return;
    }

    if (Date.now() < this.suppressMarkerDetailsUntil) return;

    this.zone.run(() => this.openDetails(item));
  }

  private appendMarkerFilterParams(params: URLSearchParams): void {
    const search = this.itemSearchQuery().trim();
    if (search) {
      params.set('search', search);
    }

    const minRating = this.ratingFilterToMinRating(this.ratingFilter());
    if (minRating != null) {
      params.set('minRating', String(minRating));
    }

    const minPrice = this.parsePriceFilter(this.minPriceFilter());
    const maxPrice = this.parsePriceFilter(this.maxPriceFilter());
    if (minPrice != null) {
      params.set('minPrice', String(minPrice));
    }
    if (maxPrice != null) {
      params.set('maxPrice', String(maxPrice));
    }

    this.appendSelectedSubtypeIds(params);
  }

  private appendSelectedSubtypeIds(params: URLSearchParams): void {
    const paramByType: Record<MarkerType, string> = {
      Object: 'objectTypeIds',
      Event: 'eventTypeIds',
      Activity: 'activityTypeIds'
    };

    this.filterGroups().forEach(group => {
      const selectedIds = group.subtypes
        .filter(subtype => subtype.checked && subtype.id != null)
        .map(subtype => subtype.id as number);

      selectedIds.forEach(id => params.append(paramByType[group.markerType], String(id)));
    });
  }

  private scheduleMarkerReload(delay = 250): void {
    if (this.markerFilterTimer) {
      clearTimeout(this.markerFilterTimer);
    }

    this.markerFilterTimer = setTimeout(() => {
      this.markerFilterTimer = null;
      this.reloadMarkersForActiveScope();
    }, delay);
  }

  private reloadMarkersForActiveScope(): void {
    const destinationId = this.selectedDestinationId();
    if (destinationId) {
      this.loadMarkers({ destinationId });
      return;
    }

    const userLocation = this.userLocation();
    if (userLocation) {
      this.loadMarkers({ lat: userLocation.lat, lng: userLocation.lng });
      return;
    }

    if (this.itemSearchQuery().trim()) {
      this.loadMarkersForCurrentView();
      return;
    }

    this.allItems.set([]);
  }

  private applyFiltersToItems(items: MapItem[]): MapItem[] {
    const hasDestination = !!this.selectedDestinationId();
    const mapReady = !!this.map;

    return items.filter(item => {
      if (!hasDestination && mapReady && !this.mapIsAnimating && !this.isItemVisibleOnMap(item)) {
        return false;
      }

      return true;
    });
  }

  private ratingFilterToMinRating(ratingFilter: RatingFilterOption): number | null {
    if (ratingFilter === 'good') return 3;
    if (ratingFilter === 'very-good') return 4;
    if (ratingFilter === 'excellent') return 5;
    return null;
  }

  private normalizePriceFilterInput(value: string | number | null): string {
    return String(value ?? '').replace(',', '.');
  }

  private parsePriceFilter(value: string): number | null {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  private get selectedMarkerTypes(): MarkerType[] {
    const groups = this.filterGroups();
    if (!this.hasActiveMapFilters(groups)) {
      return groups.map(group => group.markerType);
    }

    return groups
      .filter(group => group.checked || group.subtypes.some(subtype => subtype.checked))
      .map(group => group.markerType);
  }

  private hasActiveMapFilters(groups = this.filterGroups()): boolean {
    return groups.some(group => group.checked || group.subtypes.some(subtype => subtype.checked));
  }

  private isItemVisibleOnMap(item: MapItem): boolean {
    return this.map?.getBounds().contains(L.latLng(item.lat, item.lng)) ?? true;
  }

  private maxMarkersForCurrentZoom(): number {
    if (!this.map || this.selectedDestinationId()) return 250;
    const zoom = this.map.getZoom();
    if (zoom <= 5) return 20;
    if (zoom <= 8) return 50;
    if (zoom <= 11) return 100;
    return 250;
  }

  private ensureSubtypeFiltersFromItems(items: MapItem[]): void {
    this.filterGroups.update(groups =>
      groups.map(group => {
        const existing = new Set(group.subtypes.map(subtype => this.normalize(subtype.name)));
        const newSubtypes: MapSubtypeFilter[] = [];

        items
          .filter(item => item.markerType === group.markerType && item.subType)
          .forEach(item => {
            if (!existing.has(this.normalize(item.subType))) {
              newSubtypes.push({ name: item.subType, checked: false });
              existing.add(this.normalize(item.subType));
            }
          });

        return newSubtypes.length
          ? { ...group, subtypes: [...group.subtypes, ...newSubtypes] }
          : group;
      })
    );
  }

  private persistMapState(selectedMarker?: MapItem): MapStateSnapshot {
    const state = this.captureMapState(selectedMarker);
    try {
      sessionStorage.setItem(this.mapStateStorageKey, JSON.stringify(state));
    } catch {
      // Navigation state still carries the map state.
    }
    return state;
  }

  private captureMapState(selectedMarker: MapItem | null = this.selectedItem()): MapStateSnapshot {
    const center = this.map?.getCenter();
    const returnToDetails = this.returnToDetails();

    return {
      destinationQuery: this.destinationQuery(),
      itemSearchQuery: this.itemSearchQuery(),
      selectedDestinationId: this.selectedDestinationId(),
      ratingFilter: this.ratingFilter(),
      minPriceFilter: this.minPriceFilter(),
      maxPriceFilter: this.maxPriceFilter(),
      filterGroups: this.filterGroups().map(group => ({
        ...group,
        subtypes: group.subtypes.map(subtype => ({ ...subtype }))
      })),
      center: center ? { lat: center.lat, lng: center.lng } : null,
      zoom: this.map?.getZoom() ?? this.initialZoom,
      showFilterPanel: this.showFilterPanel(),
      selectedMarker: selectedMarker
        ? {
            markerType: selectedMarker.markerType,
            id: selectedMarker.id,
            lat: selectedMarker.lat,
            lng: selectedMarker.lng
          }
        : null,
      returnToDetails: returnToDetails ? { ...returnToDetails } : null
    };
  }

  private maybeShowLocationPrompt(): void {
    if (!('geolocation' in navigator)) {
      this.showLocationPrompt.set(false);
      return;
    }

    if (localStorage.getItem(this.locationPreferenceKey) === 'true') {
      this.showLocationPrompt.set(false);
      const shouldFocusUser = !this.pendingFocusState && !this.pendingRestoreState;
      this.startLocationTracking(shouldFocusUser);
      return;
    }

    const locationDisabled = localStorage.getItem(this.locationPreferenceKey) === 'false';
    this.showLocationPrompt.set(!locationDisabled);
  }

  private showTemporaryDestinationNotice(): void {
    if (this.destinationNoticeTimer) clearTimeout(this.destinationNoticeTimer);

    this.showDestinationNotice.set(true);
    this.destinationNoticeTimer = setTimeout(() => {
      this.showDestinationNotice.set(false);
      this.destinationNoticeTimer = null;
    }, 10000);
  }

  private startLocationTracking(zoomToUser: boolean): void {
    if (!navigator.geolocation) {
      this.isLocationTracking.set(false);
      this.toastr.error(this.translation.translate('map.locationUnavailable'));
      return;
    }

    if (!window.isSecureContext) {
      this.isLocationTracking.set(false);
      localStorage.setItem(this.locationPreferenceKey, 'false');
      localStorage.setItem(this.locationPromptSeenKey, 'true');
      this.toastr.error(this.translation.translate('map.locationSecureContext'));
      return;
    }

    if (this.userLocationWatchId != null) {
      if (zoomToUser && this.userLocation()) {
        this.recenterMap();
      }
      return;
    }

    this.isLocationTracking.set(true);
    let isFirstPosition = !this.userLocation();

    this.userLocationWatchId = navigator.geolocation.watchPosition(
      position => {
        this.zone.run(() => {
          const shouldZoom = zoomToUser && isFirstPosition;
          isFirstPosition = false;
          this.handleUserPosition(position, shouldZoom);
        });
      },
      error => {
        this.zone.run(() => {
          if (error.code === error.PERMISSION_DENIED) {
            localStorage.setItem(this.locationPreferenceKey, 'false');
            localStorage.setItem(this.locationPromptSeenKey, 'true');
            this.stopLocationTracking(false);
            this.showLocationDeniedNotice();
            return;
          }

          this.isLocationTracking.set(false);
          this.toastr.error(this.getLocationErrorMessage(error));
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000
      }
    );
  }

  private stopLocationTracking(clearNearbyItems = true): void {
    if (this.userLocationWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.userLocationWatchId);
      this.userLocationWatchId = null;
    }

    this.isLocationTracking.set(false);
    this.userLocation.set(null);

    if (this.userLocationMarker) {
      this.userLocationMarker.remove();
      this.userLocationMarker = null;
    }

    if (clearNearbyItems && !this.selectedDestinationId() && !this.destinationQuery().trim() && !this.itemSearchQuery().trim()) {
      this.allItems.set([]);
      this.selectedItem.set(null);
      this.showDetailsPanel.set(false);
    }
  }

  private getLocationErrorMessage(error: GeolocationPositionError): string {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return this.translation.translate('map.locationDenied');
      case error.POSITION_UNAVAILABLE:
        return this.translation.translate('map.locationUnavailableNow');
      case error.TIMEOUT:
        return this.translation.translate('map.locationTimeout');
      default:
        return this.translation.translate('map.locationError');
    }
  }

  private handleUserPosition(position: GeolocationPosition, zoomToUser: boolean): void {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const previousLocation = this.userLocation();
    const currentLocation = { lat, lng };

    this.userLocation.set(currentLocation);
    this.isLocationTracking.set(true);
    this.showUserLocationMarker(lat, lng);

    if (this.showRoutePanel() && !this.routeStart()) {
      this.primeRouteStartFromUserLocation(false);
    }

    if (zoomToUser && this.map) {
      this.focusInitialUserLocation(lat, lng);
    } else if (!this.selectedDestinationId() && !this.destinationQuery().trim()) {
      if (this.shouldReloadUserNearbyMarkers(previousLocation, currentLocation)) {
        this.loadMarkersAroundUserLocation();
      }
    } else if (!previousLocation && !this.pendingFocusState && !this.pendingRestoreState) {
      this.loadMarkersAroundUserLocation();
    }
  }

  private focusInitialUserLocation(lat: number, lng: number): void {
    this.mapIsAnimating = true;
    this.selectedDestinationId.set(null);
    this.destinationQuery.set('');
    this.itemSearchQuery.set('');
    this.map?.flyTo([lat, lng], 16, { duration: 0.8 });
    this.loadMarkers({ lat, lng });
  }

  private loadMarkersAroundUserLocation(): void {
    const userLocation = this.userLocation();
    if (!userLocation) return;

    this.selectedDestinationId.set(null);
    this.destinationQuery.set('');
    this.loadMarkers({
      lat: userLocation.lat,
      lng: userLocation.lng
    });
  }

  private shouldReloadUserNearbyMarkers(
    previousLocation: { lat: number; lng: number } | null,
    currentLocation: { lat: number; lng: number }
  ): boolean {
    if (!previousLocation) return true;
    return this.distanceInMeters(previousLocation, currentLocation) >= 150;
  }

  private distanceInMeters(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
  ): number {
    const earthRadius = 6371000;
    const dLat = this.toRadians(to.lat - from.lat);
    const dLng = this.toRadians(to.lng - from.lng);
    const lat1 = this.toRadians(from.lat);
    const lat2 = this.toRadians(to.lat);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private toRadians(value: number): number {
    return (value * Math.PI) / 180;
  }

  private showUserLocationMarker(lat: number, lng: number): void {
    if (!this.map) return;

    if (this.userLocationMarker) {
      this.userLocationMarker.setLatLng([lat, lng]);
      return;
    }

    this.userLocationMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'user-location-marker',
        html: '<span class="user-location-marker__dot"></span>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      }),
      zIndexOffset: 1000
    }).addTo(this.map);
  }

  private getPendingRestoreState(): MapStateSnapshot | null {
    const state = window.history.state as { restoreMapState?: boolean; mapState?: MapStateSnapshot } | null;
    return state?.restoreMapState && state.mapState ? state.mapState : null;
  }

  private applyStoredMapStateBasics(): void {
    const state = this.pendingRestoreState;
    if (!state) return;

    this.destinationQuery.set(state.destinationQuery ?? '');
    this.itemSearchQuery.set(state.itemSearchQuery ?? '');
    this.selectedDestinationId.set(state.selectedDestinationId ?? null);
    this.ratingFilter.set(state.ratingFilter ?? 'all');
    this.minPriceFilter.set(state.minPriceFilter ?? '');
    this.maxPriceFilter.set(state.maxPriceFilter ?? '');
    this.showFilterPanel.set(!!state.showFilterPanel);
    this.applyStoredFilterState();

    if (state.center && this.map) {
      const focus = state.selectedMarker ?? state.center;
      this.suppressMapReloadUntil = Date.now() + 1200;
      this.map.setView([focus.lat, focus.lng], state.selectedMarker ? 15 : state.zoom ?? this.initialZoom);
    }
  }

  private restoreMarkersFromStoredState(): void {
    const state = this.pendingRestoreState;
    if (!state) return;

    if (state.selectedDestinationId) {
      this.focusStoredDestination(state);
      this.loadMarkers({ destinationId: state.selectedDestinationId });
    } else if (state.center) {
      this.loadMarkers({ lat: state.center.lat, lng: state.center.lng });
    }
  }

  private focusStoredDestination(state: MapStateSnapshot): void {
    if (!this.map || state.selectedMarker || !state.selectedDestinationId) return;

    const destination = this.destinations().find(item => item.id === state.selectedDestinationId);
    if (destination?.latitude == null || destination.longitude == null) return;

    this.suppressMapReloadUntil = Date.now() + 1200;
    this.map.setView([destination.latitude, destination.longitude], this.destinationZoom, { animate: false });
  }

  private applyRestoredSelectedMarker(items: MapItem[]): void {
    const restoreState = this.pendingRestoreState;
    if (!restoreState?.selectedMarker) return;
    const selectedMarker = restoreState.selectedMarker;
    this.pendingRestoreState = { ...restoreState, selectedMarker: null };

    const item = items.find(current =>
      current.id === selectedMarker.id &&
      current.markerType === selectedMarker.markerType
    );

    if (item) {
      this.openDetails(item);
      return;
    }

    if (this.map) {
      this.suppressMapReloadUntil = Date.now() + 1200;
      this.map.setView([selectedMarker.lat, selectedMarker.lng], 15, { animate: false });
    }
  }

  private applyFocusedMarkerFromItems(items: MapItem[]): void {
    const focus = this.pendingFocusState;
    if (!focus) return;

    const item = items.find(current =>
      current.id === focus.id &&
      current.markerType === focus.markerType
    );

    if (!item) return;

    this.pendingFocusState = null;
    this.openDetails(item);
  }

  private applyStoredFilterState(): void {
    const state = this.pendingRestoreState;
    if (!state?.filterGroups?.length) return;

    this.filterGroups.update(groups =>
      groups.map(group => {
        const storedGroup = state.filterGroups.find(stored => stored.markerType === group.markerType);
        if (!storedGroup) return group;

        return {
          ...group,
          checked: storedGroup.checked,
          subtypes: group.subtypes.map(subtype => {
            const storedSubtype = storedGroup.subtypes.find(
              stored => this.normalize(stored.name) === this.normalize(subtype.name)
            );
            return { ...subtype, checked: storedSubtype?.checked ?? subtype.checked };
          })
        };
      })
    );
  }

  private mapMarkerToItem(marker: any): MapDataItem {
    const markerType = this.toMarkerType(marker.markerType);
    const subType = marker.subType ?? '';

    return {
      id: marker.id,
      name: marker.name ?? '',
      markerType,
      subType,
      category: this.markerToCategory(markerType, subType),
      lat: this.toNumberOrNull(marker.latitude) ?? 0,
      lng: this.toNumberOrNull(marker.longitude) ?? 0,
      address: marker.address ?? subType,
      description: marker.description ?? '',
      price: markerType === 'Object'
        ? null
        : Number(marker.price ?? 0),
      currency: marker.currency ?? 'RSD',
      reviewCount: Number(marker.reviewCount ?? 0),
      rating: Number(marker.averageRating ?? marker.rating ?? 0),
      image: firstAssetUrl(marker) ?? FALLBACK_IMAGE_URL,
      isFavorite: false,
      recentReviews: (marker.recentReviews ?? []).map((review: any) => ({
        id: Number(review.id),
        author: review.author ?? this.translation.translate('reviews.defaultAuthor'),
        rating: Number(review.rating ?? 0),
        comment: review.comment ?? '',
        createdAt: review.createdAt ?? ''
      }))
    };
  }

  private markerToCategory(markerType: MarkerType, subType: string): MapCategory {
    if (markerType === 'Event') return 'event';
    if (markerType === 'Activity') return 'activity';
    return this.normalize(subType) === 'restaurant' ? 'restaurant' : 'hotel';
  }

  private toMarkerType(value: string | null | undefined): MarkerType {
    if (value === 'Event') return 'Event';
    if (value === 'Activity') return 'Activity';
    return 'Object';
  }

  private normalizeMapReturnTarget(target: unknown): MapReturnTarget | null {
    if (!target || typeof target !== 'object') return null;

    const value = target as Partial<MapReturnTarget>;
    const id = Number(value.id);
    if (!Number.isFinite(id) || id <= 0) return null;

    return {
      markerType: typeof value.markerType === 'string'
        ? this.toMarkerType(value.markerType)
        : 'Object',
      id,
      title: typeof value.title === 'string' && value.title.trim() ? value.title : null
    };
  }

  private markerTypeToRouteType(markerType: MarkerType): 'object' | 'activity' | 'event' {
    if (markerType === 'Activity') return 'activity';
    if (markerType === 'Event') return 'event';
    return 'object';
  }

  private toNumberOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalize(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private markerSvg(category: MapCategory, selected = false): string {
    const selectedClass = selected ? ' custom-map-marker__inner--selected' : '';
    if (category === 'hotel') {
      return `<div class="simple-marker${selectedClass}">
        <svg viewBox="0 0 24 24">
          <rect x="5" y="7" width="4" height="2.5" rx="1" fill="#ffffff"/>
          <rect x="15" y="7" width="4" height="2.5" rx="1" fill="#ffffff"/>
          <rect x="4" y="10" width="16" height="5" rx="1.5" fill="none" stroke="#ffffff" stroke-width="1.8"/>
          <line x1="5" y1="15" x2="5" y2="18" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="19" y1="15" x2="19" y2="18" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
        </svg></div>`;
    }

    if (category === 'restaurant') {
      return `<div class="simple-marker simple-marker--navy${selectedClass}">
        <svg viewBox="0 0 24 24">
          <path d="M7 4v5.2M5.3 4v5.2M8.7 4v5.2M7 9.2v10.2" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round"/>
          <path d="M15.8 4.2c1.8 1.8 1.9 4.8 0 6.7v8.5" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round"/>
        </svg></div>`;
    }

    if (category === 'event') {
      return `<div class="simple-marker simple-marker--navy${selectedClass}">
        <svg viewBox="0 0 24 24">
          <rect x="4.5" y="6" width="15" height="13" rx="2.5" fill="none" stroke="#ffffff" stroke-width="1.9"/>
          <path d="M8 4.3v3.2M16 4.3v3.2M4.5 9.5h15" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round"/>
          <circle cx="9" cy="13" r="1" fill="#ffffff"/>
          <circle cx="12" cy="13" r="1" fill="#ffffff"/>
          <circle cx="15" cy="13" r="1" fill="#ffffff"/>
        </svg></div>`;
    }

    return `<div class="location-pin-marker${selectedClass}">
      <svg viewBox="0 0 24 24">
        <path d="M12 22s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z" fill="#2A9D8F"/>
        <circle cx="12" cy="11" r="2.5" fill="#ffffff"/>
      </svg></div>`;
  }

  private showLocationDeniedNotice(): void {
    if (this.locationDeniedNoticeShown) return;
    this.locationDeniedNoticeShown = true;
    this.toastr.error(this.translation.translate('map.locationDenied'));
  }

  private createCategoryIcon(category: MapCategory, selected = false): L.DivIcon {
    return L.divIcon({
      className: selected ? 'custom-map-marker custom-map-marker--selected' : 'custom-map-marker',
      html: this.markerSvg(category, selected),
      iconSize: selected ? [52, 52] : [38, 38],
      iconAnchor: selected ? [26, 26] : [19, 19],
      popupAnchor: [0, -12]
    });
  }

  private createRoutePointIcon(kind: RoutePointKind): L.DivIcon {
    const label = kind === 'start' ? 'A' : 'B';
    const className = kind === 'start'
      ? 'route-point-marker route-point-marker--start'
      : 'route-point-marker route-point-marker--end';

    return L.divIcon({
      className: 'route-point-marker-shell',
      html: `<span class="${className}">${label}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
  }
}
