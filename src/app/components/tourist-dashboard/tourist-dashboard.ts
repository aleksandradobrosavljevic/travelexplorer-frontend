import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { catchError, debounceTime, forkJoin, of, Subject, timeout } from 'rxjs';
import { HeaderComponent } from '../../components/header/header';
import { SectionHeaderComponent } from '../../components/section-header/section-header';
import { PreviewCardComponent, PreviewCardSelection } from '../../components/preview-card/preview-card';
import { FALLBACK_IMAGE_URL, buildApiUrl, firstAssetUrl } from '../../core/config/api';
import { PublisherContentService } from '../../services/publisher-content.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PriceFormatService } from '../../core/services/price-format.service';
import { AuthState } from '../../core/services/auth-state.service';
import { SelectModule } from 'primeng/select';
import { ChatbotComponent } from '../chatbot/chatbot';

type EntityType = 'Object' | 'Activity' | 'Event';
type SortOption = 'ratingDesc' | 'ratingAsc' | 'nameAsc' | 'nameDesc' | 'dateNewest' | 'dateOldest';

export interface CardItem {
  id: number;
  entityType: EntityType;
  image: string;
  title: string;
  location: string;
  rating: number;
  price: string;
  priceValue?: number | null;
  priceCurrency?: string | null;
  sortDate?: string | null;
  isFavorite: boolean;
  description: string;
}

interface DestinationOption {
  id: number;
  name: string;
  country: string;
}

interface RowDragState {
  element: HTMLElement;
  pointerId: number;
  startX: number;
  scrollLeft: number;
  moved: boolean;
}

@Component({
  selector: 'app-tourist-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HeaderComponent,
    SectionHeaderComponent,
    PreviewCardComponent,
    TranslatePipe,
    SelectModule,
    ChatbotComponent
  ],
  templateUrl: './tourist-dashboard.html',
  styleUrl: './tourist-dashboard.css'
})
export class TouristDashboardComponent implements OnInit {
  currentSearchValue = '';
  countryQuery = '';
  destinationQuery = '';
  selectedDestinationId: number | null = null;
  currentSortOption: SortOption = 'ratingDesc';
  favouriteKeys = new Set<string>();
  isLoading = true;

  featuredDestinations: CardItem[] = [];
  nearbyPlaces: CardItem[] = [];
  recommendedForYou: CardItem[] = [];
  destinationEvents: CardItem[] = [];
  destinations: DestinationOption[] = [];
  countryOptions: string[] = [];
  destinationOptions: DestinationOption[] = [];
  private sourceObjects: any[] = [];
  private sourceActivities: any[] = [];
  private sourceEvents: any[] = [];
  private rowDragState: RowDragState | null = null;
  private suppressCardSelectionUntil = 0;
  private contentRequestToken = 0;

  filteredFeaturedDestinations: CardItem[] = [];
  filteredNearbyPlaces: CardItem[] = [];
  filteredRecommendedForYou: CardItem[] = [];
  filteredDestinationEvents: CardItem[] = [];
  selectedItem: CardItem | null = null;

  readonly sortOptions: { labelKey: string; value: SortOption }[] = [
    { labelKey: 'sort.ratingDesc', value: 'ratingDesc' },
    { labelKey: 'sort.ratingAsc', value: 'ratingAsc' },
    { labelKey: 'sort.nameAsc', value: 'nameAsc' },
    { labelKey: 'sort.nameDesc', value: 'nameDesc' },
    { labelKey: 'sort.dateNewest', value: 'dateNewest' },
    { labelKey: 'sort.dateOldest', value: 'dateOldest' }
  ];

  private readonly favouriteRequestsInFlight = new Set<string>();
  private readonly searchSubject = new Subject<string>();
  private readonly destinationPageSize = 50;
  private readonly previewPageSize = 12;

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private publisher_service: PublisherContentService,
    private route: ActivatedRoute,
    private router: Router,
    private priceFormat: PriceFormatService,
    private authState: AuthState
  ) {}

  ngOnInit(): void {
    this.restoreFiltersFromRoute();
    this.loadData();
    this.searchSubject.pipe(debounceTime(400)).subscribe(value => {
      this.performSearch(value);
    });
  }

  loadData(): void {
    const requestToken = ++this.contentRequestToken;
    this.isLoading = true;

    forkJoin({
      destinations: this.getListResponse('destinations', { page: 1, pageSize: this.destinationPageSize }),
      objects: this.getListResponse('tourist-objects', this.getContentRequestParams('objects')),
      activities: this.getListResponse('activities', this.getContentRequestParams('activities')),
      events: this.getListResponse('events', this.getContentRequestParams('events'))
    }).subscribe({
      next: ({ destinations, objects, activities, events }) => {
        if (requestToken !== this.contentRequestToken) return;

        this.destinations = this.normalizeList(destinations)
          .map(item => this.mapDestinationOption(item))
          .filter((item): item is DestinationOption => !!item);
        this.syncDestinationFieldsFromSelectedId();
        this.updateDestinationFilterOptions();
        this.updateContentLists(objects, activities, events);
        this.loadFavouriteSummary();
      },
      error: () => {
        if (requestToken !== this.contentRequestToken) return;

        this.isLoading = false;
        this.applyFilter();
        this.refreshView();
      }
    });
  }

  getObjectTypes(): void {
    this.publisher_service.getObjectTypes().subscribe({
      next: () => {}
    });
  }

  private loadDestinationContent(): void {
    const requestToken = ++this.contentRequestToken;
    this.isLoading = true;

    forkJoin({
      objects: this.getListResponse('tourist-objects', this.getContentRequestParams('objects')),
      activities: this.getListResponse('activities', this.getContentRequestParams('activities')),
      events: this.getListResponse('events', this.getContentRequestParams('events'))
    }).subscribe({
      next: ({ objects, activities, events }) => {
        if (requestToken !== this.contentRequestToken) return;
        this.updateContentLists(objects, activities, events);
      },
      error: () => {
        if (requestToken !== this.contentRequestToken) return;
        this.updateContentLists([], [], []);
      }
    });
  }

  onSearchChanged(searchValue: string): void {
    this.currentSearchValue = searchValue;
    this.searchSubject.next(searchValue);
  }

  private performSearch(searchValue: string): void {
    this.currentSearchValue = searchValue;
    this.loadDestinationContent();
  }

  applyFilter(): void {
    this.filteredFeaturedDestinations = [...this.featuredDestinations];
    this.filteredNearbyPlaces = [...this.nearbyPlaces];
    this.filteredRecommendedForYou = [...this.recommendedForYou];
    this.filteredDestinationEvents = [...this.destinationEvents];
  }

  onSortChanged(value: SortOption): void {
    this.currentSortOption = value;
    this.loadDestinationContent();
  }

  onFavoriteToggled(selection: PreviewCardSelection): void {
    const item = this.findItem(selection);
    if (!item) return;

    if (!this.authState.isLoggedIn()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }

    if (!this.canCallProtectedApi()) return;

    const key = this.toFavouriteKey(item.entityType, item.id);
    if (this.favouriteRequestsInFlight.has(key)) return;

    const previousState = item.isFavorite;
    const nextState = !previousState;
    this.favouriteRequestsInFlight.add(key);
    this.updateFavoriteState(item.entityType, item.id, nextState);

    this.applyFilter();

    this.http.post<{ isSaved: boolean }>(
      buildApiUrl(`favourites/toggle/${item.entityType}/${item.id}`),
      {},
      this.authOptions()
    ).subscribe({
      next: response => {
        this.updateFavoriteState(item.entityType, item.id, response?.isSaved ?? false);
        this.applyFilter();
      },
      error: () => {
        this.updateFavoriteState(item.entityType, item.id, previousState);
        this.applyFilter();
        this.favouriteRequestsInFlight.delete(key);
      },
      complete: () => {
        this.favouriteRequestsInFlight.delete(key);
      }
    });
  }

  onCardSelected(selection: PreviewCardSelection): void {
    if (Date.now() < this.suppressCardSelectionUntil) {
      return;
    }

    this.router.navigate(['/details', selection.entityType.toLowerCase(), selection.id], {
      state: {
        dashboardReturnUrl: this.buildDashboardReturnUrl()
      }
    });
  }

  startRowDrag(event: PointerEvent): void {
    if (event.button !== 0 || event.pointerType === 'touch') {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea')) {
      return;
    }

    const element = event.currentTarget as HTMLElement | null;
    if (!element) return;

    this.rowDragState = {
      element,
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: element.scrollLeft,
      moved: false
    };

    element.classList.add('is-dragging');
  }

  moveRowDrag(event: PointerEvent): void {
    const state = this.rowDragState;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - state.startX;
    if (Math.abs(deltaX) > 4) {
      state.moved = true;
      this.suppressCardSelectionUntil = Date.now() + 200;
      event.preventDefault();
    }

    if (state.moved) {
      state.element.scrollLeft = state.scrollLeft - deltaX;
    }
  }

  endRowDrag(event: PointerEvent): void {
    const state = this.rowDragState;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    if (state.moved) {
      this.suppressCardSelectionUntil = Date.now() + 200;
    }

    state.element.classList.remove('is-dragging');
    this.rowDragState = null;
  }

  displayCardPrice(item: CardItem): string {
    if (item.entityType === 'Object') {
      return '';
    }

    if (item.priceValue == null) {
      return this.priceFormat.formatPrice(0, item.priceCurrency);
    }

    return this.priceFormat.formatPrice(item.priceValue, item.priceCurrency);
  }

  closePreviewPanel(): void {
    this.selectedItem = null;
  }

  onCountrySelectChanged(value: string): void {
    this.countryQuery = value;
    this.destinationQuery = '';
    this.selectedDestinationId = null;
    this.updateDestinationFilterOptions();
    this.loadDestinationContent();
  }

  onDestinationSelectChanged(value: number | string | null): void {
    const destinationId = this.toOptionalNumber(value);
    const destination = destinationId
      ? this.destinations.find(item => item.id === destinationId)
      : null;

    this.selectedDestinationId = destination?.id ?? null;
    this.destinationQuery = destination?.name ?? '';

    if (destination) {
      this.countryQuery = destination.country;
    }

    this.updateDestinationFilterOptions();
    this.loadDestinationContent();
  }

  clearDestinationFilters(): void {
    this.countryQuery = '';
    this.destinationQuery = '';
    this.selectedDestinationId = null;
    this.updateDestinationFilterOptions();
    this.loadDestinationContent();
  }

  getSectionQueryParams(section: 'objects' | 'activities' | 'events'): Record<string, string | number> {
    const params: Record<string, string | number> = {};

    if (this.countryQuery.trim()) {
      params['country'] = this.countryQuery.trim();
    }

    if (this.selectedDestinationId) {
      params['destinationId'] = this.selectedDestinationId;
      if (this.destinationQuery.trim()) params['destination'] = this.destinationQuery.trim();
    } else if (this.destinationQuery.trim()) {
      params['destination'] = this.destinationQuery.trim();
    }

    if (this.currentSearchValue.trim()) {
      params['search'] = this.currentSearchValue.trim();
      params['homeSearch'] = this.currentSearchValue.trim();
    }

    if (this.currentSortOption !== 'ratingDesc') {
      params['sort'] = this.currentSortOption;
    }

    return params;
  }

  get hasNoResults(): boolean {
    if (this.isLoading) return false;
    return (
      this.filteredFeaturedDestinations.length === 0 &&
      this.filteredNearbyPlaces.length === 0 &&
      this.filteredRecommendedForYou.length === 0 &&
      this.filteredDestinationEvents.length === 0
    );
  }

  trackByCard = (index: number, item: CardItem): string => `${item.entityType}:${item.id}`;

  private updateContentLists(objects: unknown, activities: unknown, events: unknown): void {
    this.sourceObjects = this.normalizeList(objects);
    this.sourceActivities = this.normalizeList(activities);
    this.sourceEvents = this.normalizeList(events);
    this.featuredDestinations = this.sourceObjects.map(item => this.mapObjectToCardItem(item));
    this.nearbyPlaces = this.sourceActivities.map(item => this.mapActivityToCardItem(item));
    this.destinationEvents = this.sourceEvents.map(item => this.mapEventToCardItem(item));
    this.recommendedForYou = this.selectRecommendedItems(
      this.sourceObjects,
      this.sourceActivities,
      this.sourceEvents
    );
    this.isLoading = false;
    this.applyFilter();
    this.refreshView();
  }

  private getContentRequestParams(_section: 'objects' | 'activities' | 'events'): Record<string, string | number> {
    const params: Record<string, string | number> = {
      page: 1,
      pageSize: this.previewPageSize,
      sort: this.currentSortOption
    };

    const search = this.currentSearchValue.trim();
    if (search) {
      params['search'] = search;
    }

    if (this.selectedDestinationId) {
      params['destinationId'] = this.selectedDestinationId;
    } else if (this.countryQuery.trim()) {
      params['country'] = this.toCountryName(this.countryQuery);
    }

    return params;
  }

  private mapObjectToCardItem(item: any): CardItem {
    return {
      id: item.id,
      entityType: 'Object',
      image: firstAssetUrl(item) ?? FALLBACK_IMAGE_URL,
      title: item.name ?? '',
      location: item.address ?? item.destinationName ?? item.destination?.name ?? '',
      rating: this.normalizeRating(item.averageRating),
      price: '',
      priceValue: null,
      priceCurrency: null,
      sortDate: item.createdAt ?? item.updatedAt ?? null,
      isFavorite: this.isFavourite('Object', item.id),
      description: item.description ?? ''
    };
  }

  private mapActivityToCardItem(item: any): CardItem {
    return {
      id: item.id,
      entityType: 'Activity',
      image: firstAssetUrl(item) ?? FALLBACK_IMAGE_URL,
      title: item.name ?? '',
      location: item.destinationName ?? item.objectName ?? '',
      rating: this.normalizeRating(item.averageRating),
      price: '',
      priceValue: this.toOptionalPrice(item.price),
      priceCurrency: item.currency ?? 'RSD',
      sortDate: item.createdAt ?? item.updatedAt ?? null,
      isFavorite: this.isFavourite('Activity', item.id),
      description: item.description ?? ''
    };
  }

  private mapEventToCardItem(item: any): CardItem {
    return {
      id: item.id,
      entityType: 'Event',
      image: firstAssetUrl(item) ?? FALLBACK_IMAGE_URL,
      title: item.name ?? '',
      location: item.destinationName ?? item.objectName ?? '',
      rating: this.normalizeRating(item.averageRating),
      price: '',
      priceValue: this.toOptionalPrice(item.price),
      priceCurrency: item.currency ?? 'RSD',
      sortDate: item.startDatetime ?? item.startDateTime ?? item.startDate ?? item.createdAt ?? null,
      isFavorite: this.isFavourite('Event', item.id),
      description: item.description ?? ''
    };
  }

  private restoreFiltersFromRoute(): void {
    const queryParams = this.route.snapshot.queryParamMap;
    this.countryQuery = queryParams.get('country') ?? '';
    this.destinationQuery = queryParams.get('destination') ?? '';
    this.selectedDestinationId = this.toOptionalNumber(queryParams.get('destinationId'));
    this.currentSearchValue = queryParams.get('search') ?? queryParams.get('homeSearch') ?? '';
    this.currentSortOption = this.toSortOption(queryParams.get('sort'));
  }

  private buildDashboardReturnUrl(): string {
    return this.router.serializeUrl(
      this.router.createUrlTree(['/'], {
        queryParams: this.buildDashboardReturnQueryParams()
      })
    );
  }

  private buildDashboardReturnQueryParams(): Params {
    const params: Params = {};

    if (this.countryQuery.trim()) {
      params['country'] = this.countryQuery.trim();
    }

    if (this.selectedDestinationId) {
      params['destinationId'] = this.selectedDestinationId;
    }

    if (this.destinationQuery.trim()) {
      params['destination'] = this.destinationQuery.trim();
    }

    if (this.currentSearchValue.trim()) {
      params['search'] = this.currentSearchValue.trim();
    }

    if (this.currentSortOption !== 'ratingDesc') {
      params['sort'] = this.currentSortOption;
    }

    return params;
  }

  private syncDestinationFieldsFromSelectedId(): void {
    if (!this.selectedDestinationId) return;

    const destination = this.destinations.find(item => item.id === this.selectedDestinationId);
    if (!destination) return;

    if (!this.destinationQuery.trim()) {
      this.destinationQuery = destination.name;
    }

    if (!this.countryQuery.trim()) {
      this.countryQuery = destination.country;
    }
  }

  private updateDestinationFilterOptions(): void {
    const countries = new Set(
      this.destinations
        .map(destination => destination.country)
        .filter(country => this.isVisibleCountry(country))
    );
    const country = this.normalize(this.countryQuery);

    this.countryOptions = [...countries].sort();
    this.destinationOptions = this.destinations
      .filter(destination => this.isVisibleDestination(destination))
      .filter(destination => !country || this.normalize(destination.country).includes(country))
      .slice(0, 20);
  }

  private mapDestinationOption(item: any): DestinationOption | null {
    const id = Number(item?.id);
    const name = item?.name ?? '';
    if (!Number.isFinite(id) || !name) return null;

    return {
      id,
      name,
      country: this.toCountryName(item.country)
    };
  }

  private isVisibleCountry(country: string | null | undefined): country is string {
    const normalizedCountry = this.normalize(country);
    return !!normalizedCountry && normalizedCountry !== 'me';
  }

  private toCountryName(value: unknown): string {
    const raw = (value ?? '').toString().trim();
    const normalized = this.normalize(raw);
    const names: Record<string, string> = {
      rs: 'Serbia',
      srb: 'Serbia',
      serbia: 'Serbia',
      srbija: 'Serbia',
      me: 'Montenegro',
      mne: 'Montenegro',
      montenegro: 'Montenegro',
      'crna gora': 'Montenegro'
    };

    return names[normalized] ?? raw;
  }

  private isVisibleDestination(destination: DestinationOption): boolean {
    return this.isVisibleCountry(destination.country) && this.normalize(destination.name) !== 'me';
  }

  private selectRecommendedItems(objects: any[], activities: any[], events: any[]): CardItem[] {
    return [
      ...objects.slice(0, 2).map(item => this.mapObjectToCardItem(item)),
      ...activities.slice(0, 2).map(item => this.mapActivityToCardItem(item)),
      ...events.slice(0, 2).map(item => this.mapEventToCardItem(item))
    ];
  }

  private loadFavouriteSummary(): void {
    if (!this.canCallProtectedApi()) return;

    this.http.get<any>(buildApiUrl('favourites/summary?previewCount=0'), this.authOptions())
      .pipe(catchError(() => of({})))
      .subscribe(summary => {
      this.favouriteKeys = this.buildFavouriteKeySet(summary);
      this.syncFavoriteStatesFromSummary();
      this.applyFilter();
      this.refreshView();
    });
  }

  private getListResponse(path: string, params: Record<string, any> = {}) {
    return this.http.get<unknown>(buildApiUrl(path), { params }).pipe(
      timeout(8000),
      catchError(() => of([]))
    );
  }

  private buildFavouriteKeySet(summary: any): Set<string> {
    const keys = new Set<string>();

    for (const id of summary?.savedObjectIds ?? []) {
      if (id) keys.add(this.toFavouriteKey('Object', id));
    }

    for (const id of summary?.savedActivityIds ?? []) {
      if (id) keys.add(this.toFavouriteKey('Activity', id));
    }

    for (const id of summary?.savedEventIds ?? []) {
      if (id) keys.add(this.toFavouriteKey('Event', id));
    }

    for (const item of summary?.objects ?? []) {
      if (item?.objectId) keys.add(this.toFavouriteKey('Object', item.objectId));
    }

    for (const item of summary?.activities ?? []) {
      if (item?.activityId) keys.add(this.toFavouriteKey('Activity', item.activityId));
    }

    for (const item of summary?.events ?? []) {
      if (item?.eventId) keys.add(this.toFavouriteKey('Event', item.eventId));
    }

    return keys;
  }

  private isFavourite(entityType: EntityType, id: number): boolean {
    return this.favouriteKeys.has(this.toFavouriteKey(entityType, id));
  }

  private toFavouriteKey(entityType: EntityType, id: number): string {
    return `${entityType}:${id}`;
  }

  private findItem(selection: PreviewCardSelection): CardItem | null {
    const allItems = [
      ...this.featuredDestinations,
      ...this.nearbyPlaces,
      ...this.recommendedForYou,
      ...this.destinationEvents
    ];

    return allItems.find(item => item.id === selection.id && item.entityType === selection.entityType) ?? null;
  }

  private updateFavoriteState(entityType: EntityType, id: number, isSaved: boolean): void {
    const key = this.toFavouriteKey(entityType, id);
    if (isSaved) {
      this.favouriteKeys.add(key);
    } else {
      this.favouriteKeys.delete(key);
    }

    const updateList = (items: CardItem[]) =>
      items.map(item =>
        item.id === id && item.entityType === entityType
          ? { ...item, isFavorite: isSaved }
          : item
      );

    this.featuredDestinations = updateList(this.featuredDestinations);
    this.nearbyPlaces = updateList(this.nearbyPlaces);
    this.recommendedForYou = updateList(this.recommendedForYou);
    this.destinationEvents = updateList(this.destinationEvents);
  }

  private refreshView(): void {
    setTimeout(() => this.cdr.detectChanges());
  }

  private syncFavoriteStatesFromSummary(): void {
    const updateList = (items: CardItem[]) =>
      items.map(item => ({
        ...item,
        isFavorite: this.isFavourite(item.entityType, item.id)
      }));

    this.featuredDestinations = updateList(this.featuredDestinations);
    this.nearbyPlaces = updateList(this.nearbyPlaces);
    this.recommendedForYou = updateList(this.recommendedForYou);
    this.destinationEvents = updateList(this.destinationEvents);
  }

  private normalizeRating(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    return Number(value.toFixed(2));
  }

  private normalize(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private toOptionalNumber(value: string | number | null): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private toOptionalPrice(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toSortOption(value: string | null): SortOption {
    return value === 'ratingAsc' ||
      value === 'nameAsc' ||
      value === 'nameDesc' ||
      value === 'dateNewest' ||
      value === 'dateOldest'
      ? value
      : 'ratingDesc';
  }

  private normalizeList(response: unknown): any[] {
    if (Array.isArray(response)) return response;

    if (response && typeof response === 'object') {
      const maybePaged = response as { items?: unknown; data?: unknown; results?: unknown };
      if (Array.isArray(maybePaged.items)) return maybePaged.items;
      if (Array.isArray(maybePaged.data)) return maybePaged.data;
      if (Array.isArray(maybePaged.results)) return maybePaged.results;
    }

    return [];
  }

  private canCallProtectedApi(): boolean {
    return this.authState.isLoggedIn()
      && (this.authState.getUserRole() ?? '').toLowerCase() === 'tourist';
  }

  private authOptions() {
    const token = this.authState.getAccessToken();

    return token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : {};
  }
  get countrySelectOptions() {
    return [
      { label: 'common.all', value: '', translate: true },
      ...this.countryOptions.map(c => ({ label: c, value: c, translate: false }))
    ];
  }

  get destinationSelectOptions() {
    return [
      { label: 'common.all', value: null, translate: true },
      ...this.destinationOptions.map(d => ({ label: d.name, value: d.id, translate: false }))
    ];
  }
}
