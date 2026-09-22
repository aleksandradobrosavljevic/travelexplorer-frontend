import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HeaderComponent } from '../../components/header/header';
import { UserProfileComponent } from '../../components/user-profile/user-profile';
import { FavouritesService } from '../../core/services/favourites';
import { FavouriteItem } from '../../models/favourite-item';
import { FALLBACK_IMAGE_URL } from '../../core/config/api';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import { PriceFormatService } from '../../core/services/price-format.service';
import { SelectModule } from 'primeng/select';

interface FavouriteDestinationGroup {
  key: string;
  destination: string;
  items: FavouriteItem[];
  previewItems: FavouriteItem[];
  hiddenCount: number;
}

type FavouriteSortOption = 'ratingDesc' | 'ratingAsc' | 'nameAsc' | 'nameDesc' | 'priceAsc' | 'priceDesc' | 'dateNewest' | 'dateOldest';

@Component({
  selector: 'app-favourites-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HeaderComponent, UserProfileComponent, TranslatePipe, SelectModule],
  templateUrl: './favourites-page.html',
  styleUrl: './favourites-page.css'
})
export class FavouritesPageComponent implements OnInit {
  isUserProfileOpen = false;
  readonly fallbackImageUrl = FALLBACK_IMAGE_URL;
  readonly pendingRemoveItem = signal<FavouriteItem | null>(null);
  readonly destinationSearch = signal('');
  readonly favouritesSort = signal<FavouriteSortOption>('ratingDesc');
  readonly destinationPage = signal(1);
  readonly destinationPageSize = 3;
  readonly sortOptions: { labelKey: string; value: FavouriteSortOption }[] = [
    { labelKey: 'sort.ratingDesc', value: 'ratingDesc' },
    { labelKey: 'sort.ratingAsc', value: 'ratingAsc' },
    { labelKey: 'sort.nameAsc', value: 'nameAsc' },
    { labelKey: 'sort.nameDesc', value: 'nameDesc' },
    { labelKey: 'sort.priceAsc', value: 'priceAsc' },
    { labelKey: 'sort.priceDesc', value: 'priceDesc' },
    { labelKey: 'sort.dateNewest', value: 'dateNewest' },
    { labelKey: 'sort.dateOldest', value: 'dateOldest' }
  ];

  readonly favourites = computed(() => this.favouritesService.favourites());
  readonly isLoading = computed(() => this.favouritesService.isLoading());
  readonly errorMessage = computed(() => this.favouritesService.errorMessage());
  readonly savedCount = computed(() => this.favourites().length);
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
      .map(([key, group]) => {
        const sortedItems = this.sortFavouriteItems(group.items);

        return {
          key,
          destination: group.destination,
          items: sortedItems,
          previewItems: sortedItems.slice(0, 3),
          hiddenCount: Math.max(group.items.length - 3, 0)
        };
      })
      .sort((left, right) => this.compareDestinationGroups(left, right));
  });
  readonly groupedFavourites = computed(() => {
    const query = this.normalize(this.destinationSearch());

    return this.allDestinationGroups()
      .filter(group => !query || this.normalize(group.destination).includes(query));
  });
  readonly destinationTotalPages = computed(() => Math.max(1, Math.ceil(this.groupedFavourites().length / this.destinationPageSize)));
  readonly currentDestinationPage = computed(() => this.clampPage(this.destinationPage(), this.destinationTotalPages()));
  readonly pagedDestinationGroups = computed(() => {
    const groups = this.groupedFavourites();
    const page = this.currentDestinationPage();
    const start = (page - 1) * this.destinationPageSize;

    return groups.slice(start, start + this.destinationPageSize);
  });
  readonly subtitle = computed(() => {
    const count = this.savedCount();

    if (count === 0) {
      return this.translation.translate('favourites.noSavedPlaces');
    }

    if (count === 1) {
      return this.translation.translate('favourites.onePlace');
    }

    return this.translation.translate('favourites.manyPlaces', { count });
  });

  constructor(
    private favouritesService: FavouritesService,
    private route: ActivatedRoute,
    private router: Router,
    private translation: TranslationService,
    private priceFormat: PriceFormatService,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    const queryParams = this.route.snapshot.queryParamMap;
    this.destinationSearch.set(queryParams.get('search') ?? '');
    this.favouritesSort.set(this.toSortOption(queryParams.get('sort')));
    this.destinationPage.set(this.toOptionalNumber(queryParams.get('page')) ?? 1);
    this.favouritesService.loadFavourites();
  }

  openUserProfile(): void {
    this.isUserProfileOpen = true;
  }

  closeUserProfile(): void {
    this.isUserProfileOpen = false;
  }

  updateDestinationSearch(value: string): void {
    this.destinationSearch.set(value);
    this.destinationPage.set(1);
    this.resetGroupScrollPositions();
  }

  updateSort(value: FavouriteSortOption | string): void {
    this.favouritesSort.set(this.toSortOption(String(value)));
    this.destinationPage.set(1);
    this.resetGroupScrollPositions();
    (document.activeElement as HTMLElement)?.blur();
  }

  changeDestinationPage(direction: number): void {
    this.destinationPage.set(this.clampPage(this.destinationPage() + direction, this.destinationTotalPages()));
    this.resetGroupScrollPositions();
  }

  openDestinationGroup(group: FavouriteDestinationGroup, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    this.router.navigate(['/favourites/destination', group.key], {
      queryParams: { destination: group.destination }
    });
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
    if (!item) {
      return;
    }

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
        favouritesReturnUrl: this.buildFavouritesReturnUrl()
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
    if (item.reviewCount === null) {
      return '';
    }

    return `(${item.reviewCount})`;
  }

  trackByFavouriteId(index: number, item: FavouriteItem): number {
    return item.id;
  }

  hasDisplayPrice(item: FavouriteItem): boolean {
    return !!this.formatPrice(item);
  }

  trackByDestination(index: number, group: FavouriteDestinationGroup): string {
    return group.key;
  }

  onImageError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (!image || image.src === this.fallbackImageUrl) {
      return;
    }

    image.src = this.fallbackImageUrl;
  }

  private getDestinationGroupName(item: FavouriteItem): string {
    if (item.destinationName?.trim()) {
      return item.destinationCountry
        ? `${item.destinationName} (${item.destinationCountry})`
        : item.destinationName;
    }

    return item.location?.trim() || this.translation.translate('favourites.otherDestinations');
  }

  private sortFavouriteItems(items: FavouriteItem[]): FavouriteItem[] {
    return [...items].sort((left, right) => {
      let result = 0;

      switch (this.favouritesSort()) {
        case 'ratingAsc':
          result = this.itemRating(left) - this.itemRating(right);
          break;
        case 'nameAsc':
          result = left.title.localeCompare(right.title);
          break;
        case 'nameDesc':
          result = right.title.localeCompare(left.title);
          break;
        case 'priceAsc':
          result = this.itemPrice(left) - this.itemPrice(right);
          break;
        case 'priceDesc':
          result = this.itemPrice(right) - this.itemPrice(left);
          break;
        case 'dateNewest':
          result = this.itemTime(right) - this.itemTime(left);
          return result || right.id - left.id;
        case 'dateOldest':
          result = this.itemTime(left) - this.itemTime(right);
          return result || left.id - right.id;
        default:
          result = this.itemRating(right) - this.itemRating(left);
          break;
      }

      return result || this.fallbackItemSort(left, right);
    });
  }

  private compareDestinationGroups(left: FavouriteDestinationGroup, right: FavouriteDestinationGroup): number {
    const leftItem = left.items[0];
    const rightItem = right.items[0];

    if (!leftItem || !rightItem) {
      return this.fallbackGroupSort(left, right);
    }

    let result = 0;

    switch (this.favouritesSort()) {
      case 'ratingAsc':
        result = this.itemRating(leftItem) - this.itemRating(rightItem);
        break;
      case 'ratingDesc':
        result = this.itemRating(rightItem) - this.itemRating(leftItem);
        break;
      case 'nameAsc':
        result = leftItem.title.localeCompare(rightItem.title);
        break;
      case 'nameDesc':
        result = rightItem.title.localeCompare(leftItem.title);
        break;
      case 'priceAsc':
        result = this.itemPrice(leftItem) - this.itemPrice(rightItem);
        break;
      case 'priceDesc':
        result = this.itemPrice(rightItem) - this.itemPrice(leftItem);
        break;
      case 'dateNewest':
        result = this.itemTime(rightItem) - this.itemTime(leftItem);
        return result || rightItem.id - leftItem.id || this.fallbackGroupSort(left, right);
      case 'dateOldest':
        result = this.itemTime(leftItem) - this.itemTime(rightItem);
        return result || leftItem.id - rightItem.id || this.fallbackGroupSort(left, right);
    }

    return result || this.fallbackGroupSort(left, right);
  }

  private itemRating(item: FavouriteItem): number {
    return typeof item.averageRating === 'number' ? item.averageRating : 0;
  }

  private itemPrice(item: FavouriteItem): number {
    return this.priceFormat.convertToDisplayCurrency(item.price, item.currency ?? 'RSD');
  }

  private itemTime(item: FavouriteItem): number {
    const time = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    return Number.isFinite(time) && time > 0 ? time : item.id;
  }

  private fallbackItemSort(left: FavouriteItem, right: FavouriteItem): number {
    return left.title.localeCompare(right.title) || left.id - right.id;
  }

  private fallbackGroupSort(left: FavouriteDestinationGroup, right: FavouriteDestinationGroup): number {
    return left.destination.localeCompare(right.destination) || left.key.localeCompare(right.key);
  }

  private resetGroupScrollPositions(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.host.nativeElement
          .querySelectorAll<HTMLElement>('.saved-trips-grid')
          .forEach(grid => {
            grid.scrollTo({ left: 0, behavior: 'auto' });
          });
      });
    });
  }

  private isObjectItem(item: FavouriteItem): boolean {
    return (item.entityType ?? '').toLowerCase() === 'object';
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

  private buildFavouritesReturnUrl(): string {
    const queryParams: Record<string, string | number> = {};

    if (this.destinationSearch().trim()) {
      queryParams['search'] = this.destinationSearch().trim();
    }

    if (this.favouritesSort() !== 'ratingDesc') {
      queryParams['sort'] = this.favouritesSort();
    }

    if (this.currentDestinationPage() > 1) {
      queryParams['page'] = this.currentDestinationPage();
    }

    return this.router.serializeUrl(
      this.router.createUrlTree(['/favourites'], { queryParams })
    );
  }

  private toSortOption(value: string | null): FavouriteSortOption {
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

  private toOptionalNumber(value: string | number | null): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private clampPage(page: number, totalPages: number): number {
    return Math.min(Math.max(1, page), totalPages);
  }
}
