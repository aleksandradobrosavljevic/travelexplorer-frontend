import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { catchError, combineLatest, delay, forkJoin, of, timeout } from 'rxjs';
import { HeaderComponent } from '../../components/header/header';
import { PreviewCardComponent, PreviewCardSelection } from '../../components/preview-card/preview-card';
import { FALLBACK_IMAGE_URL, buildApiUrl, firstAssetUrl } from '../../core/config/api';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import { PriceFormatService } from '../../core/services/price-format.service';
import { AuthState } from '../../core/services/auth-state.service';
import { SelectModule } from 'primeng/select';

type EntityType = 'Object' | 'Activity' | 'Event';
type EventTimeFilter = 'all' | 'today' | 'week' | 'month';
type SortOption = 'ratingDesc' | 'ratingAsc' | 'nameAsc' | 'nameDesc' | 'priceAsc' | 'priceDesc' | 'dateNewest' | 'dateOldest';

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

interface TypeOption {
  id: number;
  name: string;
}

@Component({
  selector: 'app-section-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HeaderComponent, PreviewCardComponent, TranslatePipe, SelectModule],
  templateUrl: './section-page.html',
  styleUrl: './section-page.css'
})
export class SectionPageComponent implements OnInit, OnDestroy {
  sectionType = '';
  pageTitle = '';
  currentSearchValue = '';
  currentPreference: 'nature' | 'adventure' | 'default' = 'default';
  countryFilter = '';
  destinationNameFilter = '';
  destinationIdFilter: number | null = null;
  homeSearchValue = '';
  eventTimeFilter: EventTimeFilter = 'all';
  currentSortOption: SortOption = 'ratingDesc';
  typeFilterId: number | null = null;
  typeOptions: TypeOption[] = [];
  isLoading = true;

  items: CardItem[] = [];
  filteredItems: CardItem[] = [];
  favouriteKeys = new Set<string>();
  currentPage = 1;
  pageSize = this.calculatePageSize();
  totalItems = 0;

  readonly eventTimeOptions: { labelKey: string; value: EventTimeFilter }[] = [
    { labelKey: 'section.allEvents', value: 'all' },
    { labelKey: 'section.today', value: 'today' },
    { labelKey: 'section.thisWeek', value: 'week' },
    { labelKey: 'section.thisMonth', value: 'month' }
  ];

  readonly sortOptions: { labelKey: string; value: SortOption }[] = [
    { labelKey: 'sort.ratingDesc', value: 'ratingDesc' },
    { labelKey: 'sort.ratingAsc', value: 'ratingAsc' },
    { labelKey: 'sort.nameAsc', value: 'nameAsc' },
    { labelKey: 'sort.nameDesc', value: 'nameDesc' },
    { labelKey: 'sort.priceAsc', value: 'priceAsc' },
    { labelKey: 'sort.priceDesc', value: 'priceDesc' },
    { labelKey: 'sort.dateNewest', value: 'dateNewest' },
    { labelKey: 'sort.dateOldest', value: 'dateOldest' }
  ];

  private readonly favouriteRequestsInFlight = new Set<string>();
  private loadRequestId = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly searchDelayMs = 350;
  private readonly recommendedSourcePageSize = 6;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private translation: TranslationService,
    private priceFormat: PriceFormatService,
    private authState: AuthState
  ) {}

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(([params, queryParams]) => {
      document.body.scrollTo({ top: 0, behavior: 'instant' });

      this.sectionType = params.get('type') || '';
      const preferenceParam = params.get('preference');
      this.currentPreference =
        preferenceParam === 'nature' || preferenceParam === 'adventure' || preferenceParam === 'default'
          ? preferenceParam
          : 'default';

      this.countryFilter = queryParams.get('country') ?? '';
      this.destinationNameFilter = queryParams.get('destination') ?? '';
      this.destinationIdFilter = this.toOptionalNumber(queryParams.get('destinationId'));
      this.eventTimeFilter = this.toEventTimeFilter(queryParams.get('eventTime'));
      this.currentSortOption = this.toSortOption(queryParams.get('sort'));
      if (this.isObjectSection() && (this.currentSortOption === 'priceAsc' || this.currentSortOption === 'priceDesc')) {
        this.currentSortOption = 'ratingDesc';
      }
      this.typeFilterId = this.toOptionalNumber(queryParams.get('typeId'));
      this.currentSearchValue = queryParams.get('search') ?? '';
      this.homeSearchValue = queryParams.get('homeSearch') ?? this.currentSearchValue;
      this.currentPage = this.toOptionalNumber(queryParams.get('page')) ?? 1;

      this.setPageTitle();
      this.loadTypeOptions();
      this.loadSectionContent();
    });
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  get supportsSectionFilters(): boolean {
    return this.isObjectSection() || this.isActivitySection() || this.isEventsSection();
  }

  get typeFilterLabel(): string {
    if (this.isObjectSection()) return this.translation.translate('section.objectType');
    if (this.isActivitySection()) return this.translation.translate('section.activityType');
    if (this.isEventsSection()) return this.translation.translate('section.eventType');
    return this.translation.translate('section.type');
  }

  get availableSortOptions(): { labelKey: string; value: SortOption }[] {
    if (!this.isObjectSection()) {
      return this.sortOptions;
    }

    return this.sortOptions.filter(option => option.value !== 'priceAsc' && option.value !== 'priceDesc');
  }

  getPageTitle(): string {
    if (this.sectionType === 'recommended') return this.translation.translate('dashboard.recommended');
    if (this.isObjectSection()) return this.translation.translate('dashboard.objects');
    if (this.isActivitySection()) return this.translation.translate('dashboard.activities');
    if (this.isEventsSection()) return this.translation.translate('dashboard.events');
    return this.translation.translate('section.notFound');
  }

  loadSectionContent(): void {
    const requestId = ++this.loadRequestId;
    this.isLoading = true;
    this.items = [];
    this.filteredItems = [];

    setTimeout(() => {
      if (requestId === this.loadRequestId) {
        this.loadSectionItems(requestId);
      }
    });
  }

  onSearchChanged(searchValue: string): void {
    this.currentSearchValue = searchValue;
    this.currentPage = 1;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.loadSectionContent();
    }, this.searchDelayMs);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    const nextPageSize = this.calculatePageSize();
    if (nextPageSize === this.pageSize) return;

    this.pageSize = nextPageSize;
    this.currentPage = this.clampPage(this.currentPage, this.totalPages);
    this.loadSectionContent();
    this.cdr.detectChanges();
  }

  onTypeFilterChanged(value: string | number | null): void {
    this.typeFilterId = this.toOptionalNumber(value);
    this.currentPage = 1;
    this.loadSectionContent();
  }

  onEventTimeFilterChanged(value: EventTimeFilter): void {
    this.eventTimeFilter = this.toEventTimeFilter(value);
    this.currentPage = 1;
    this.loadSectionContent();
  }

  onSortChanged(value: SortOption): void {
    this.currentSortOption = this.toSortOption(value);
    this.currentPage = 1;
    this.loadSectionContent();
  }

  applyFilter(): void {
    this.filteredItems = [...this.items];
  }

  onFavoriteToggled(selection: PreviewCardSelection): void {
    const item = this.items.find((currentItem) =>
      currentItem.id === selection.id && currentItem.entityType === selection.entityType
    );
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
      next: (response) => {
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
    this.router.navigate(
      ['/details', selection.entityType.toLowerCase(), selection.id],
      {
        state: {
          fromSection: true,
          sectionReturnUrl: this.buildSectionReturnUrl()
        }
      }
    );
  }

  get hasNoResults(): boolean {
    return !this.isLoading && this.filteredItems.length === 0;
  }

  get pagedItems(): CardItem[] {
    return this.filteredItems;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
  }

  changePage(direction: number): void {
    this.currentPage = this.clampPage(this.currentPage + direction, this.totalPages);
    this.loadSectionContent();
    setTimeout(() => {
      document
        .querySelector<HTMLElement>('.section-page .card-grid')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  trackByCard = (index: number, item: CardItem): string => `${item.entityType}:${item.id}`;

  displayCardPrice(item: CardItem): string {
    if (item.entityType === 'Object') {
      return '';
    }

    if (item.priceValue == null) {
      return this.priceFormat.formatPrice(0, item.priceCurrency);
    }

    return this.priceFormat.formatPrice(item.priceValue, item.priceCurrency);
  }

  private loadSectionItems(requestId: number): void {
    if (this.sectionType === 'recommended') {
      forkJoin({
        objects: this.getListResponse('tourist-objects', this.getRequestParams('objects')),
        activities: this.getListResponse('activities', this.getRequestParams('activities')),
        events: this.getListResponse('events', this.getRequestParams('events'))
      }).subscribe({
        next: ({ objects, activities, events }) => {
          const scopedObjects = this.applySourceScopeFilter(this.normalizeList(objects));
          const scopedActivities = this.applySourceScopeFilter(this.normalizeList(activities));
          const scopedEvents = this.filterEventsByTime(this.applySourceScopeFilter(this.normalizeList(events)));

          this.finishLoadingItems(
            this.selectRecommendedItems(scopedObjects, scopedActivities, scopedEvents),
            requestId,
            6
          );
        },
        error: () => this.finishLoadingItems([], requestId)
      });
      return;
    }

    if (this.isObjectSection()) {
      this.getListResponse('tourist-objects', this.getRequestParams('objects')).subscribe({
        next: (res) => {
          const items = this.applySourceScopeFilter(this.normalizeList(res))
            .map((item) => this.mapObjectToCardItem(item));
          this.finishLoadingItems(items, requestId, this.getTotalCount(res, items.length));
        },
        error: () => this.finishLoadingItems([], requestId)
      });
      return;
    }

    if (this.isActivitySection()) {
      this.getListResponse('activities', this.getRequestParams('activities')).subscribe({
        next: (res) => {
          const items = this.applySourceScopeFilter(this.normalizeList(res))
            .map((item) => this.mapActivityToCardItem(item));
          this.finishLoadingItems(items, requestId, this.getTotalCount(res, items.length));
        },
        error: () => this.finishLoadingItems([], requestId)
      });
      return;
    }

    if (this.isEventsSection()) {
      this.getListResponse('events', this.getRequestParams('events')).subscribe({
        next: (res) => {
          const items = this.filterEventsByTime(this.applySourceScopeFilter(this.normalizeList(res)))
            .map((item) => this.mapEventToCardItem(item));
          this.finishLoadingItems(items, requestId, this.getTotalCount(res, items.length));
        },
        error: () => this.finishLoadingItems([], requestId)
      });
      return;
    }

    if (requestId !== this.loadRequestId) return;

    this.pageTitle = this.translation.translate('section.notFound');
    this.items = [];
    this.filteredItems = [];
    this.totalItems = 0;
    this.isLoading = false;
  }

  private finishLoadingItems(items: CardItem[], requestId: number, totalCount = items.length): void {
    if (requestId !== this.loadRequestId) return;

    this.items = items;
    this.totalItems = totalCount;
    this.isLoading = false;
    this.applyFilter();
    this.loadFavouriteSummary();
    this.cdr.detectChanges();
  }

  private calculatePageSize(): number {
    if (typeof window === 'undefined') {
      return 12;
    }

    return window.innerWidth >= 1100 ? 12 : 8;
  }

  private loadTypeOptions(): void {
    const section = this.getCanonicalSection();
    this.typeOptions = [];
    if (!section) return;
    const endpoint = this.getTypeReferenceEndpoint(section);

    this.getListResponse(endpoint).subscribe(response => {
      this.typeOptions = this.normalizeList(response)
        .map(item => ({
          id: this.toOptionalNumber(item?.id) ?? 0,
          name: (item?.name ?? '').toString()
        }))
        .filter(option => option.id > 0 && !!option.name)
        .sort((left, right) => left.name.localeCompare(right.name));
    });
  }

  private getRequestParams(
    section: 'objects' | 'activities' | 'events',
    includeTypeFilter = true
  ): Record<string, string | number> {
    const params: Record<string, string | number> = {
      page: this.sectionType === 'recommended' ? 1 : this.currentPage,
      pageSize: this.sectionType === 'recommended' ? this.recommendedSourcePageSize : this.pageSize,
      sort: this.getRequestSort(section)
    };

    const search = this.currentSearchValue.trim();
    if (search) {
      params['search'] = search;
    }

    if (this.destinationIdFilter) {
      params['destinationId'] = this.destinationIdFilter;
    } else if (this.destinationNameFilter.trim()) {
      params['destinationName'] = this.destinationNameFilter.trim();
    }

    const country = this.toCountryName(this.countryFilter);
    if (country.trim()) {
      params['country'] = country.trim();
    }

    if (includeTypeFilter && this.typeFilterId) {
      if (section === 'objects') params['objectTypeId'] = this.typeFilterId;
      if (section === 'activities') params['activityTypeId'] = this.typeFilterId;
      if (section === 'events') params['eventTypeId'] = this.typeFilterId;
    }

    if (section === 'events') {
      Object.assign(params, this.getEventDateParams());
    }

    return params;
  }

  private getListResponse(path: string, params: Record<string, any> = {}) {
    return this.http.get<unknown>(buildApiUrl(path), { params }).pipe(
      timeout(8000),
      catchError(() => of([])),
      delay(0)
    );
  }

  private applySourceScopeFilter(items: any[]): any[] {
    const country = this.normalize(this.countryFilter);
    const destinationName = this.normalize(this.destinationNameFilter);

    return items.filter(item => {
      if (country && !this.itemMatchesCountry(item, country)) return false;
      if (!this.destinationIdFilter && destinationName && !this.itemMatchesDestination(item, destinationName)) return false;
      return true;
    });
  }

  private itemMatchesCountry(item: any, normalizedCountry: string): boolean {
    const country = (
      item?.destinationCountry ??
      item?.country ??
      item?.destination?.country ??
      ''
    ).toString();

    return this.normalize(this.toCountryName(country)).includes(normalizedCountry);
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

  private itemMatchesDestination(item: any, normalizedDestination: string): boolean {
    const destination = (
      item?.destinationName ??
      item?.destination?.name ??
      item?.object?.destination?.name ??
      ''
    ).toString();

    return this.normalize(destination).includes(normalizedDestination);
  }

  private getEventDateParams(): Record<string, string> {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    if (this.eventTimeFilter === 'all') return {};

    const end = new Date(start);
    if (this.eventTimeFilter === 'today') {
      end.setDate(start.getDate() + 1);
    } else if (this.eventTimeFilter === 'week') {
      end.setDate(start.getDate() + 7);
    } else {
      end.setMonth(start.getMonth() + 1);
    }

    return {
      fromDate: start.toISOString(),
      toDate: end.toISOString()
    };
  }

  private filterEventsByTime(events: any[]): any[] {
    if (this.eventTimeFilter === 'all') return events;

    const params = this.getEventDateParams();
    const from = params['fromDate'] ? new Date(params['fromDate']).getTime() : 0;
    const to = params['toDate'] ? new Date(params['toDate']).getTime() : Number.MAX_SAFE_INTEGER;

    return events.filter(event => {
      const time = new Date(
        event.startDatetime ??
        event.startDateTime ??
        event.startDate ??
        event.date ??
        event.createdAt ??
        0
      ).getTime();
      return Number.isFinite(time) && time >= from && time <= to;
    });
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

  private getTotalCount(response: unknown, fallback: number): number {
    if (response && typeof response === 'object') {
      const record = response as { totalCount?: unknown; total?: unknown };
      const totalCount = Number(record.totalCount ?? record.total);
      if (Number.isFinite(totalCount) && totalCount >= 0) {
        return totalCount;
      }
    }

    return fallback;
  }

  private setPageTitle(): void {
    if (this.sectionType === 'recommended') {
      this.pageTitle = this.translation.translate('dashboard.recommended');
      return;
    }

    if (this.isObjectSection()) {
      this.pageTitle = this.translation.translate('dashboard.objects');
      return;
    }

    if (this.isActivitySection()) {
      this.pageTitle = this.translation.translate('dashboard.activities');
      return;
    }

    if (this.isEventsSection()) {
      this.pageTitle = this.translation.translate('dashboard.events');
      return;
    }

    this.pageTitle = this.translation.translate('section.notFound');
  }

  private mapObjectToCardItem(item: any): CardItem {
    return {
      id: item.id,
      entityType: 'Object',
      image: firstAssetUrl(item) ?? FALLBACK_IMAGE_URL,
      title: item.name ?? '',
      location: item.address ?? item.destinationName ?? item.objectTypeName ?? '',
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

  private selectRecommendedItems(objects: any[], activities: any[], events: any[]): CardItem[] {
    return [
      ...objects.slice(0, 2).map((item) => this.mapObjectToCardItem(item)),
      ...activities.slice(0, 2).map((item) => this.mapActivityToCardItem(item)),
      ...events.slice(0, 2).map((item) => this.mapEventToCardItem(item))
    ];
  }

  private loadFavouriteSummary(): void {
    if (!this.canCallProtectedApi()) return;

    this.http.get<any>(buildApiUrl('favourites/summary?previewCount=0'), this.authOptions())
      .pipe(catchError(() => of({})))
      .subscribe((summary) => {
      this.favouriteKeys = this.buildFavouriteKeySet(summary);
      this.items = this.items.map((item) => ({
        ...item,
        isFavorite: this.isFavourite(item.entityType, item.id)
      }));
      this.applyFilter();
      this.cdr.detectChanges();
    });
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

  private updateFavoriteState(entityType: EntityType, id: number, isFavorite: boolean): void {
    const key = this.toFavouriteKey(entityType, id);

    if (isFavorite) {
      this.favouriteKeys.add(key);
    } else {
      this.favouriteKeys.delete(key);
    }

    this.items = this.items.map((currentItem) =>
      currentItem.id === id && currentItem.entityType === entityType
        ? { ...currentItem, isFavorite }
        : currentItem
    );
  }

  private normalizeRating(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    return Number(value.toFixed(2));
  }

  private clampCurrentPage(): void {
    this.currentPage = this.clampPage(this.currentPage, this.totalPages);
  }

  private clampPage(page: number, totalPages: number): number {
    return Math.min(Math.max(1, page), totalPages);
  }

  private normalize(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private toOptionalNumber(value: string | number | null): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private toEventTimeFilter(value: string | null): EventTimeFilter {
    return value === 'today' || value === 'week' || value === 'month' ? value : 'all';
  }

  private toSortOption(value: string | null): SortOption {
    return value === 'ratingAsc' ||
      value === 'nameAsc' ||
      value === 'nameDesc' ||
      value === 'priceAsc' ||
      value === 'priceDesc' ||
      value === 'dateNewest' ||
      value === 'dateOldest'
      ? value
      : 'ratingDesc';
  }

  private getRequestSort(section: 'objects' | 'activities' | 'events'): SortOption {
    if (section === 'objects' && (this.currentSortOption === 'priceAsc' || this.currentSortOption === 'priceDesc')) {
      return 'ratingDesc';
    }

    return this.currentSortOption;
  }

  private toOptionalPrice(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private buildSectionReturnUrl(): string {
    return this.router.serializeUrl(
      this.router.createUrlTree(['/section', this.sectionType], {
        queryParams: this.buildSectionReturnQueryParams()
      })
    );
  }

  private buildSectionReturnQueryParams(): Params {
    const params: Params = {};

    if (this.countryFilter.trim()) params['country'] = this.countryFilter.trim();
    if (this.destinationIdFilter) params['destinationId'] = this.destinationIdFilter;
    if (!this.destinationIdFilter && this.destinationNameFilter.trim()) {
      params['destination'] = this.destinationNameFilter.trim();
    }
    if (this.currentSearchValue.trim()) params['search'] = this.currentSearchValue.trim();
    if (this.homeSearchValue.trim()) params['homeSearch'] = this.homeSearchValue.trim();
    if (this.currentSortOption !== 'ratingDesc') params['sort'] = this.currentSortOption;
    if (this.typeFilterId) params['typeId'] = this.typeFilterId;
    if (this.currentPage > 1) params['page'] = this.currentPage;
    if (this.isEventsSection() && this.eventTimeFilter !== 'all') {
      params['eventTime'] = this.eventTimeFilter;
    }

    return params;
  }

  private buildTypeOptions(items: any[], section: 'objects' | 'activities' | 'events'): TypeOption[] {
    const options = new Map<number, TypeOption>();

    items.forEach(item => {
      const id = this.getItemTypeId(item, section);
      const name = this.getItemTypeName(item, section);
      if (id == null || !name) return;
      options.set(id, { id, name });
    });

    return [...options.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  private getItemTypeId(item: any, section: 'objects' | 'activities' | 'events'): number | null {
    const rawId = section === 'objects'
      ? item?.objectTypeId
      : section === 'activities'
        ? item?.activityTypeId
        : item?.eventTypeId;
    return this.toOptionalNumber(rawId);
  }

  private getItemTypeName(item: any, section: 'objects' | 'activities' | 'events'): string {
    const rawName = section === 'objects'
      ? item?.objectTypeName
      : section === 'activities'
        ? item?.activityTypeName
        : item?.eventTypeName;
    return (rawName ?? '').toString();
  }

  private getCanonicalSection(): 'objects' | 'activities' | 'events' | null {
    if (this.isObjectSection()) return 'objects';
    if (this.isActivitySection()) return 'activities';
    if (this.isEventsSection()) return 'events';
    return null;
  }

  private getSectionEndpoint(section: 'objects' | 'activities' | 'events'): string {
    if (section === 'objects') return 'tourist-objects';
    if (section === 'activities') return 'activities';
    return 'events';
  }

  private getTypeReferenceEndpoint(section: 'objects' | 'activities' | 'events'): string {
    if (section === 'objects') return 'reference-data/object-types';
    if (section === 'activities') return 'reference-data/activity-types';
    return 'reference-data/event-types';
  }

  buildDashboardReturnQueryParams(): Params {
    const params: Params = {};

    if (this.countryFilter.trim()) params['country'] = this.countryFilter.trim();
    if (this.destinationIdFilter) params['destinationId'] = this.destinationIdFilter;
    if (this.destinationNameFilter.trim()) params['destination'] = this.destinationNameFilter.trim();
    if (this.homeSearchValue.trim()) params['search'] = this.homeSearchValue.trim();

    return params;
  }

  private isObjectSection(): boolean {
    return this.sectionType === 'objects' || this.sectionType === 'popular';
  }

  private isActivitySection(): boolean {
    return this.sectionType === 'activities' || this.sectionType === 'nearby';
  }

  private isEventsSection(): boolean {
    return this.sectionType === 'events';
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
  get typeSelectOptions() {
    return [
      { label: 'section.allTypes', value: null, translate: true },
      ...this.typeOptions.map(t => ({ label: t.name, value: t.id, translate: false }))
    ];
  }
}
