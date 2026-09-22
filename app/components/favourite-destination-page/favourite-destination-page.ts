import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest } from 'rxjs';
import { HeaderComponent } from '../../components/header/header';
import { UserProfileComponent } from '../../components/user-profile/user-profile';
import { FALLBACK_IMAGE_URL } from '../../core/config/api';
import { FavouritesService } from '../../core/services/favourites';
import { FavouriteItem } from '../../models/favourite-item';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import { PriceFormatService } from '../../core/services/price-format.service';
import { SelectModule } from 'primeng/select';

type FavouriteEntityFilter = 'All' | 'Object' | 'Activity' | 'Event';
type FavouriteSortOption = 'ratingDesc' | 'ratingAsc' | 'nameAsc' | 'nameDesc' | 'priceAsc' | 'priceDesc';

interface FavouriteDestinationGroup {
  key: string;
  destination: string;
  items: FavouriteItem[];
}

@Component({
  selector: 'app-favourite-destination-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HeaderComponent, UserProfileComponent, TranslatePipe, SelectModule],
  templateUrl: './favourite-destination-page.html',
  styleUrls: ['../favourites-page/favourites-page.css', './favourite-destination-page.css']
})
export class FavouriteDestinationPageComponent implements OnInit {
  isUserProfileOpen = false;
  readonly fallbackImageUrl = FALLBACK_IMAGE_URL;
  readonly destinationKey = signal<string | null>(null);
  readonly destinationItemSearch = signal('');
  readonly destinationTypeFilter = signal<FavouriteEntityFilter>('All');
  readonly destinationSort = signal<FavouriteSortOption>('ratingDesc');
  readonly itemPage = signal(1);
  readonly itemPageSize = signal(this.calculateItemPageSize());
  readonly pendingRemoveItem = signal<FavouriteItem | null>(null);
  readonly destinationTypeFilters: FavouriteEntityFilter[] = ['All', 'Object', 'Activity', 'Event'];
  readonly sortOptions: { labelKey: string; value: FavouriteSortOption }[] = [
    { labelKey: 'sort.ratingDesc', value: 'ratingDesc' },
    { labelKey: 'sort.ratingAsc', value: 'ratingAsc' },
    { labelKey: 'sort.nameAsc', value: 'nameAsc' },
    { labelKey: 'sort.nameDesc', value: 'nameDesc' },
    { labelKey: 'sort.priceAsc', value: 'priceAsc' },
    { labelKey: 'sort.priceDesc', value: 'priceDesc' }
  ];

  readonly favourites = computed(() => this.favouritesService.favourites());
  readonly isLoading = computed(() => this.favouritesService.isLoading());
  readonly errorMessage = computed(() => this.favouritesService.errorMessage());
  readonly allDestinationGroups = computed<FavouriteDestinationGroup[]>(() => {
    const groups = new Map<string, { destination: string; items: FavouriteItem[] }>();

    for (const item of this.favourites()) {
      const key = this.getDestinationGroupKey(item);
      const destination = this.getDestinationGroupName(item);
      const group = groups.get(key);

      if (group) {
        group.items.push(item);
      } else {
        groups.set(key, { destination, items: [item] });
      }
    }

    return [...groups.entries()]
      .map(([key, group]) => ({ key, destination: group.destination, items: group.items }))
      .sort((left, right) => left.destination.localeCompare(right.destination));
  });
  readonly selectedDestinationGroup = computed(() => {
    const key = this.destinationKey();
    if (!key) return null;
    return this.allDestinationGroups().find(group => group.key === key) ?? null;
  });
  readonly filteredDestinationItems = computed(() => {
    const group = this.selectedDestinationGroup();
    if (!group) return [];

    const typeFilter = this.destinationTypeFilter();
    const query = this.normalize(this.destinationItemSearch());

    return this.sortFavouriteItems(group.items.filter(item => {
      if (typeFilter !== 'All' && this.normalize(item.entityType) !== this.normalize(typeFilter)) {
        return false;
      }

      if (!query) return true;

      return this.normalize(item.title).includes(query);
    }));
  });
  readonly destinationItemsTotalPages = computed(() => Math.max(1, Math.ceil(this.filteredDestinationItems().length / this.itemPageSize())));
  readonly currentItemPage = computed(() => this.clampPage(this.itemPage(), this.destinationItemsTotalPages()));
  readonly pagedDestinationItems = computed(() => {
    const page = this.currentItemPage();
    const start = (page - 1) * this.itemPageSize();

    return this.filteredDestinationItems().slice(start, start + this.itemPageSize());
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private favouritesService: FavouritesService,
    private translation: TranslationService,
    private priceFormat: PriceFormatService
  ) {}

  ngOnInit(): void {
    document.body.scrollTo({ top: 0, behavior: 'instant' });
    combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(([params, queryParams]) => {
      this.destinationKey.set(params.get('destinationKey'));
      this.destinationItemSearch.set(queryParams.get('search') ?? '');
      this.destinationTypeFilter.set(this.toEntityFilter(queryParams.get('type')));
      this.destinationSort.set(this.toSortOption(queryParams.get('sort')));
      this.itemPage.set(this.toOptionalNumber(queryParams.get('page')) ?? 1);
    });

    if (!this.favourites().length && !this.isLoading()) {
      this.loadFavourites();
    }
  }

  loadFavourites(): void {
    this.favouritesService.loadFavourites();
  }

  openUserProfile(): void {
    this.isUserProfileOpen = true;
  }

  closeUserProfile(): void {
    this.isUserProfileOpen = false;
  }

  updateDestinationItemSearch(value: string): void {
    this.destinationItemSearch.set(value);
    this.itemPage.set(1);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    const nextPageSize = this.calculateItemPageSize();
    if (nextPageSize === this.itemPageSize()) return;

    this.itemPageSize.set(nextPageSize);
    this.itemPage.set(this.currentItemPage());
  }

  setDestinationTypeFilter(value: FavouriteEntityFilter): void {
    this.destinationTypeFilter.set(value);
    this.itemPage.set(1);
  }

  updateDestinationSort(value: FavouriteSortOption): void {
    this.destinationSort.set(value);
    this.itemPage.set(1);
  }

  changeItemPage(direction: number): void {
    this.itemPage.set(this.clampPage(this.itemPage() + direction, this.destinationItemsTotalPages()));
    document
      .querySelector<HTMLElement>('.destination-detail-page-panel .saved-trips-grid')
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  filterLabel(filter: FavouriteEntityFilter): string {
    if (filter === 'All') return this.translation.translate('common.all');
    if (filter === 'Object') return this.translation.translate('entity.objects');
    if (filter === 'Activity') return this.translation.translate('entity.activities');
    return this.translation.translate('entity.events');
  }

  removeFavourite(id: number): void {
    this.favouritesService.removeFavourite(id);
  }

  requestRemoveFavourite(item: FavouriteItem, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.pendingRemoveItem.set(item);
  }

  cancelRemoveFavourite(): void {
    this.pendingRemoveItem.set(null);
  }

  confirmRemoveFavourite(): void {
    const item = this.pendingRemoveItem();
    if (!item) return;

    this.removeFavourite(item.id);
    this.pendingRemoveItem.set(null);
  }

  openDetails(item: FavouriteItem, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    this.router.navigate([
      '/details',
      (item.entityType ?? 'Object').toLowerCase(),
      item.entityId ?? item.id
    ], {
      state: {
        favouritesReturnUrl: this.buildCurrentReturnUrl()
      }
    });
  }

  formatPrice(item: FavouriteItem): string {
    if (item.price === null) {
      return this.isObjectItem(item) ? '' : this.translation.translate('common.free');
    }

    return this.priceFormat.formatPrice(item.price, item.currency ?? 'RSD');
  }

  getPriceUnit(item: FavouriteItem): string {
    if (item.price === null || this.isObjectItem(item)) {
      return '';
    }

    switch ((item.entityType ?? '').toLowerCase()) {
      case 'activity':
        return this.translation.translate('price.person');
      case 'event':
        return this.translation.translate('price.ticket');
      default:
        return this.translation.translate('price.night');
    }
  }

  formatReviews(item: FavouriteItem): string {
    return item.reviewCount === null ? '' : `(${item.reviewCount})`;
  }

  hasDisplayPrice(item: FavouriteItem): boolean {
    return !!this.formatPrice(item);
  }

  trackByFavouriteId(index: number, item: FavouriteItem): number {
    return item.id;
  }

  trackByFilter(index: number, filter: FavouriteEntityFilter): string {
    return filter;
  }

  onImageError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (!image || image.src === this.fallbackImageUrl) {
      return;
    }

    image.src = this.fallbackImageUrl;
  }

  private buildCurrentReturnUrl(): string {
    const key = this.destinationKey();
    if (!key) return '/favourites';

    const queryParams: Record<string, string | number> = {
      ...this.route.snapshot.queryParams
    };

    if (this.destinationItemSearch().trim()) {
      queryParams['search'] = this.destinationItemSearch().trim();
    } else {
      delete queryParams['search'];
    }

    if (this.destinationTypeFilter() !== 'All') {
      queryParams['type'] = this.destinationTypeFilter();
    } else {
      delete queryParams['type'];
    }

    if (this.destinationSort() !== 'ratingDesc') {
      queryParams['sort'] = this.destinationSort();
    } else {
      delete queryParams['sort'];
    }

    if (this.currentItemPage() > 1) {
      queryParams['page'] = this.currentItemPage();
    } else {
      delete queryParams['page'];
    }

    return this.router.serializeUrl(
      this.router.createUrlTree(['/favourites/destination', key], {
        queryParams
      })
    );
  }

  private sortFavouriteItems(items: FavouriteItem[]): FavouriteItem[] {
    return [...items].sort((left, right) => {
      switch (this.destinationSort()) {
        case 'ratingAsc':
          return this.itemRating(left) - this.itemRating(right);
        case 'nameAsc':
          return left.title.localeCompare(right.title);
        case 'nameDesc':
          return right.title.localeCompare(left.title);
        case 'priceAsc':
          return this.itemPrice(left) - this.itemPrice(right);
        case 'priceDesc':
          return this.itemPrice(right) - this.itemPrice(left);
        default:
          return this.itemRating(right) - this.itemRating(left);
      }
    });
  }

  private itemRating(item: FavouriteItem): number {
    return typeof item.averageRating === 'number' ? item.averageRating : 0;
  }

  private itemPrice(item: FavouriteItem): number {
    return this.priceFormat.convertToDisplayCurrency(item.price, item.currency ?? 'RSD');
  }

  private isObjectItem(item: FavouriteItem): boolean {
    return (item.entityType ?? '').toLowerCase() === 'object';
  }

  private getDestinationGroupName(item: FavouriteItem): string {
    if (item.destinationName?.trim()) {
      return item.destinationCountry
        ? `${item.destinationName} (${item.destinationCountry})`
        : item.destinationName;
    }

    return item.location?.trim() || this.translation.translate('favourites.otherDestinations');
  }

  private getDestinationGroupKey(item: FavouriteItem): string {
    if (item.destinationId) {
      return `destination-${item.destinationId}`;
    }

    const slug = this.normalize(this.getDestinationGroupName(item))
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return slug ? `destination-${slug}` : 'destination-other';
  }

  private normalize(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private toEntityFilter(value: string | null): FavouriteEntityFilter {
    return value === 'Object' || value === 'Activity' || value === 'Event' ? value : 'All';
  }

  private toSortOption(value: string | null): FavouriteSortOption {
    return value === 'ratingAsc' ||
      value === 'nameAsc' ||
      value === 'nameDesc' ||
      value === 'priceAsc' ||
      value === 'priceDesc'
      ? value
      : 'ratingDesc';
  }

  private toOptionalNumber(value: string | number | null): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private clampPage(page: number, totalPages: number): number {
    return Math.min(Math.max(1, page), totalPages);
  }

  private calculateItemPageSize(): number {
    if (typeof window === 'undefined') {
      return 12;
    }

    return window.innerWidth >= 1100 ? 12 : 8;
  }
}
