import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { HeaderComponent } from '../../components/header/header';
import { FALLBACK_IMAGE_URL, buildApiUrl, buildAssetUrl, buildAssetUrls } from '../../core/config/api';
import { FavouritesService } from '../../core/services/favourites';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import { PriceFormatService } from '../../core/services/price-format.service';
import { AuthState } from '../../core/services/auth-state.service';

interface CardItem {
  id: number;
  entityType: 'Object' | 'Activity' | 'Event';
  image: string;
  images: string[];
  title: string;
  location: string;
  rating: number;
  price: string;
  priceValue: number | null;
  priceCurrency: string | null;
  isFavorite: boolean;
  description: string;
  airbnbUrl: string | null;
  bookingUrl: string | null;
  websiteUrl: string | null;
  destinationId?: number | null;
  destinationName?: string | null;
  amenities: AmenityItem[];
}

interface AmenityItem {
  icon: 'wind' | 'cup' | 'car' | 'map';
  label: string;
}

interface ReviewItem {
  id: number;
  author: string;
  date: string;
  text: string;
  rating: number;
  avatar: string | null;
  initials: string;
  touristUserId: number | null;
  isReportedByCurrentUser: boolean;
}

interface ReviewApiItem {
  id: number;
  touristId: number;
  touristUserId?: number | null;
  touristFirstName?: string | null;
  touristLastName?: string | null;
  touristAvatarUrl?: string | null;
  rating?: number | null;
  comment?: string | null;
  isReportedByCurrentUser?: boolean | null;
  reportCount?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface DetailedItem extends CardItem {
  reviewCount: number;
  aboutText: string;
  amenities: AmenityItem[];
  topReview: ReviewItem | null;
}

type EntityType = 'Object' | 'Activity' | 'Event';

interface MapReturnTarget {
  markerType: EntityType;
  id: number;
  title?: string | null;
}

interface MapReturnState {
  destinationQuery?: string;
  itemSearchQuery?: string;
  selectedDestinationId?: number | null;
  returnToDetails?: MapReturnTarget | null;
  sortOption?: string;
  filterGroups?: unknown[];
  center?: { lat: number; lng: number } | null;
  zoom?: number;
  showFilterPanel?: boolean;
}

interface EntityLoadResult {
  item: any;
  entityType: EntityType;
}

@Component({
  selector: 'app-details-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HeaderComponent, TranslatePipe],
  templateUrl: './details-page.html',
  styleUrl: './details-page.css'
})
export class DetailsPageComponent implements OnInit, OnDestroy {
  private readonly mapStateStorageKey = 'travelExplorer.mapState';
  private readonly aboutPreviewLength = 180;
  private readonly imageAutoSlideMs = 4500;
  private favouriteStateVersion = 0;
  private currentUserId: number | null = null;
  private currentUserRole: string | null = null;
  private isCurrentUserLoading = false;
  private imageAutoSlideTimer: ReturnType<typeof window.setInterval> | null = null;
  private swipeStartX: number | null = null;

  readonly item = signal<DetailedItem | null>(null);
  readonly isLoading = signal(true);
  readonly isFavorite = signal(false);
  readonly isFavoriteUpdating = signal(false);
  readonly isAboutExpanded = signal(false);
  readonly shareMessage = signal<string | null>(null);
  readonly userReview = signal<ReviewApiItem | null>(null);
  readonly reviewRating = signal(0);
  readonly reviewHoverRating = signal(0);
  readonly reviewComment = signal('');
  readonly isReviewSaving = signal(false);
  readonly isReviewDeleting = signal(false);
  readonly isTopReviewReporting = signal(false);
  readonly reviewMessage = signal<string | null>(null);
  readonly reviewError = signal<string | null>(null);
  readonly activeImageIndex = signal(0);
  readonly reviewStars = [1, 2, 3, 4, 5];
  entityType: EntityType = 'Object';
  mapReturnState: MapReturnState | null = null;
  sectionReturnUrl: string | null = null;
  dashboardReturnUrl: string | null = null;
  favouritesReturnUrl: string | null = null;
  backLinkText = 'common.back';

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private router: Router,
    private favouritesService: FavouritesService,
    private translation: TranslationService,
    private priceFormat: PriceFormatService,
    private authState: AuthState
  ) {}

  ngOnInit(): void {
    this.configureBackNavigation();
    this.loadCurrentUser();

    this.route.paramMap.subscribe((params) => {
      document.body.scrollTo({ top: 0, behavior: 'instant' });
      const id = Number(params.get('id'));
      const rawEntityType = params.get('entityType');

      this.isLoading.set(true);
      this.item.set(null);
      this.isAboutExpanded.set(false);
      this.shareMessage.set(null);
      this.activeImageIndex.set(0);
      this.stopImageAutoSlide();
      this.resetReviewForm();
      this.userReview.set(null);

      if (!Number.isFinite(id) || id <= 0) {
        this.isLoading.set(false);
        return;
      }

      this.entityType =
        rawEntityType?.toLowerCase() === 'activity'
          ? 'Activity'
          : rawEntityType?.toLowerCase() === 'event'
            ? 'Event'
            : 'Object';

      this.loadEntityWithFallback(id, this.entityType).subscribe({
        next: (result) => {
          if (!result) {
            this.item.set(null);
            this.isLoading.set(false);
            return;
          }

          this.entityType = result.entityType;
          const baseItem: CardItem = this.mapToBaseItem(result.item, result.entityType);
          this.isFavorite.set(baseItem.isFavorite);
          this.item.set(this.buildDetailedItem(baseItem, 0, null));
          this.startImageAutoSlide();
          this.isLoading.set(false);
          this.loadFavouriteState(baseItem);
          this.loadReviewsForItem(baseItem);
        },
        error: () => {
          this.item.set(null);
          this.isLoading.set(false);
        }
      });
    });
  }

  goBack(event: Event): void {
    event.preventDefault();

    if (this.mapReturnState) {
      this.router.navigate(['/map'], {
        state: {
          restoreMapState: true,
          mapState: this.mapReturnState
        }
      });
      return;
    }

    if (this.sectionReturnUrl) {
      this.router.navigateByUrl(this.sectionReturnUrl);
      return;
    }

    if (this.favouritesReturnUrl) {
      this.router.navigateByUrl(this.favouritesReturnUrl);
      return;
    }

    if (this.dashboardReturnUrl) {
      this.router.navigateByUrl(this.dashboardReturnUrl);
      return;
    }

    this.router.navigate(['/']);
  }

  activeImage(item: DetailedItem): string {
    return item.images[this.activeImageIndex()] ?? item.image;
  }

  nextImage(event?: Event): void {
    event?.stopPropagation();
    this.moveImage(1, !!event);
  }

  previousImage(event?: Event): void {
    event?.stopPropagation();
    this.moveImage(-1, !!event);
  }

  selectImage(index: number, event?: Event): void {
    event?.stopPropagation();
    const currentItem = this.item();
    if (!currentItem || index < 0 || index >= currentItem.images.length) {
      return;
    }

    this.activeImageIndex.set(index);
    this.restartImageAutoSlide();
  }

  onGalleryPointerDown(event: PointerEvent): void {
    this.swipeStartX = event.clientX;
  }

  onGalleryPointerUp(event: PointerEvent): void {
    if (this.swipeStartX == null) {
      return;
    }

    const delta = event.clientX - this.swipeStartX;
    this.swipeStartX = null;

    if (Math.abs(delta) < 40) {
      return;
    }

    delta < 0 ? this.nextImage(event) : this.previousImage(event);
  }

  onGalleryPointerCancel(): void {
    this.swipeStartX = null;
  }

  toggleFavorite(): void {
    const currentItem = this.item();
    if (!currentItem || this.isFavoriteUpdating()) {
      return;
    }

    if (!this.authState.isLoggedIn()) {
      this.redirectToLogin();
      return;
    }

    if (!this.canAttemptFavouriteWrite()) return;

    const previousState = this.isFavorite();
    this.favouriteStateVersion += 1;
    this.isFavoriteUpdating.set(true);
    this.setFavoriteState(!previousState);

    this.favouritesService.toggleFavourite(currentItem.entityType, currentItem.id).subscribe({
      next: (res: any) => {
        this.isFavoriteUpdating.set(false);
        this.setFavoriteState(!!res.isSaved);
        this.favouritesService.loadFavourites();
      },
      error: (error) => {
        this.isFavoriteUpdating.set(false);
        this.setFavoriteState(previousState);

        if (error?.status === 401 || error?.status === 403) {
          this.redirectToLogin();
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.stopImageAutoSlide();
  }

  showOnMap(): void {
    const currentItem = this.item();
    if (!currentItem) return;

    const returnToDetails: MapReturnTarget = {
      markerType: currentItem.entityType,
      id: currentItem.id,
      title: currentItem.title
    };

    this.router.navigate(['/map'], {
      state: {
        focusMapItem: {
          markerType: currentItem.entityType,
          id: currentItem.id,
          destinationId: currentItem.destinationId ?? null,
          destinationName: currentItem.destinationName ?? null,
          returnToDetails
        }
      }
    });
  }

  async shareItem(): Promise<void> {
    const currentItem = this.item();
    if (!currentItem) {
      return;
    }

    const shareData = {
      title: currentItem.title,
      text: currentItem.description || currentItem.aboutText,
      url: window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        this.shareMessage.set(this.translation.translate('details.shared'));
        this.clearShareMessage();
        return;
      }

      await navigator.clipboard.writeText(window.location.href);
      this.shareMessage.set(this.translation.translate('details.linkCopied'));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      try {
        await navigator.clipboard.writeText(window.location.href);
        this.shareMessage.set(this.translation.translate('details.linkCopied'));
      } catch {
        this.shareMessage.set(this.translation.translate('details.shareFailed'));
      }
    }

    this.clearShareMessage();
  }

  toggleAboutText(): void {
    this.isAboutExpanded.update((value) => !value);
  }

  isAboutTextLong(item: DetailedItem): boolean {
    return item.aboutText.length > this.aboutPreviewLength;
  }

  getDisplayedAboutText(item: DetailedItem): string {
    if (this.isAboutExpanded() || !this.isAboutTextLong(item)) {
      return item.aboutText;
    }

    return `${item.aboutText.slice(0, this.aboutPreviewLength).trim()}...`;
  }

  setReviewRating(rating: number): void {
    this.reviewRating.set(rating);
    this.reviewError.set(null);
  }

  setReviewHoverRating(rating: number): void {
    this.reviewHoverRating.set(rating);
  }

  isReviewStarActive(star: number): boolean {
    return star <= (this.reviewHoverRating() || this.reviewRating());
  }

  submitReview(): void {
    const currentItem = this.item();
    if (!currentItem || this.isReviewSaving()) {
      return;
    }

    const rating = this.reviewRating();
    const comment = this.reviewComment().trim();

    if (rating < 1 || rating > 5) {
      this.reviewError.set(this.translation.translate('reviews.chooseRating'));
      return;
    }

    if (!comment) {
      this.reviewError.set(this.translation.translate('reviews.writeBeforeSubmitting'));
      return;
    }

    if (comment.length > 500) {
      this.reviewError.set(this.translation.translate('reviews.maxLength'));
      return;
    }

    this.isReviewSaving.set(true);
    this.reviewError.set(null);
    this.reviewMessage.set(null);

    const payload = {
      targetId: currentItem.id,
      targetType: this.getReviewTargetTypeValue(currentItem.entityType),
      rating,
      comment
    };

    const existingReview = this.userReview();
    const request = existingReview
      ? this.http.put<ReviewApiItem>(buildApiUrl(`review/${existingReview.id}`), payload)
      : this.http.post<ReviewApiItem>(buildApiUrl('review'), payload);

    request.subscribe({
      next: () => {
        this.isReviewSaving.set(false);
        this.reviewMessage.set(this.translation.translate(existingReview ? 'reviews.updated' : 'reviews.posted'));
        this.loadReviewsForItem(currentItem);
      },
      error: (error) => {
        this.isReviewSaving.set(false);
        this.reviewError.set(error?.error?.message ?? error?.error ?? this.translation.translate('reviews.saveFailed'));
      }
    });
  }

  deleteReview(): void {
    const currentItem = this.item();
    const existingReview = this.userReview();

    if (!currentItem || !existingReview || this.isReviewDeleting()) {
      return;
    }

    this.isReviewDeleting.set(true);
    this.reviewError.set(null);
    this.reviewMessage.set(null);

    this.http.delete(buildApiUrl(`review/${existingReview.id}`)).subscribe({
      next: () => {
        this.isReviewDeleting.set(false);
        this.userReview.set(null);
        this.resetReviewForm();
        this.reviewMessage.set(this.translation.translate('reviews.deleted'));
        this.loadReviewsForItem(currentItem);
      },
      error: (error) => {
        this.isReviewDeleting.set(false);
        this.reviewError.set(error?.error?.message ?? error?.error ?? this.translation.translate('reviews.deleteFailed'));
      }
    });
  }

  canReportReview(review: ReviewItem): boolean {
    return this.currentUserId != null
      && this.currentUserRole === 'Tourist'
      && review.touristUserId !== this.currentUserId
      && !review.isReportedByCurrentUser;
  }

  isReviewReported(review: ReviewItem): boolean {
    return review.touristUserId !== this.currentUserId && review.isReportedByCurrentUser;
  }

  reportTopReview(review: ReviewItem): void {
    if (this.currentUserId == null) {
      this.redirectToLogin();
      return;
    }

    if (!this.canReportReview(review) || this.isTopReviewReporting()) {
      return;
    }

    this.isTopReviewReporting.set(true);
    this.reviewMessage.set(null);
    this.reviewError.set(null);

    this.http.post<ReviewApiItem>(buildApiUrl(`review/${review.id}/report`), {}).subscribe({
      next: (updatedReview) => {
        this.isTopReviewReporting.set(false);
        const currentItem = this.item();
        if (currentItem?.topReview?.id === review.id) {
          this.item.set({
            ...currentItem,
            topReview: this.mapReviewToDisplay(updatedReview)
          });
        }
        this.reviewMessage.set(this.translation.translate('reviews.reported'));
      },
      error: (error) => {
        this.isTopReviewReporting.set(false);
        this.reviewError.set(error?.error?.message ?? error?.error ?? this.translation.translate('reviews.reportFailed'));
      }
    });
  }

  private clearShareMessage(): void {
    window.setTimeout(() => this.shareMessage.set(null), 2200);
  }

  private configureBackNavigation(): void {
    const state = window.history.state as {
      fromMap?: boolean;
      mapState?: MapReturnState;
      fromSection?: boolean;
      sectionReturnUrl?: string;
      dashboardReturnUrl?: string;
      favouritesReturnUrl?: string;
    } | null;
    const sectionReturnUrl = this.normalizeSectionReturnUrl(state?.sectionReturnUrl);
    if (sectionReturnUrl) {
      this.mapReturnState = null;
      this.sectionReturnUrl = sectionReturnUrl;
      this.dashboardReturnUrl = null;
      this.favouritesReturnUrl = null;
      this.backLinkText = 'details.backToResults';
      return;
    }

    const explicitMapState = state?.mapState;

    if (explicitMapState) {
      this.mapReturnState = explicitMapState;
      this.sectionReturnUrl = null;
      this.dashboardReturnUrl = null;
      this.favouritesReturnUrl = null;
      this.backLinkText = 'common.back';
      return;
    }

    const favouritesReturnUrl = this.normalizeFavouritesReturnUrl(state?.favouritesReturnUrl);
    if (favouritesReturnUrl) {
      this.mapReturnState = null;
      this.sectionReturnUrl = null;
      this.dashboardReturnUrl = null;
      this.favouritesReturnUrl = favouritesReturnUrl;
      this.backLinkText = 'favourites.backToFavourites';
      return;
    }

    const dashboardReturnUrl = this.normalizeDashboardReturnUrl(state?.dashboardReturnUrl);
    if (dashboardReturnUrl) {
      this.mapReturnState = null;
      this.sectionReturnUrl = null;
      this.dashboardReturnUrl = dashboardReturnUrl;
      this.favouritesReturnUrl = null;
      this.backLinkText = 'common.backToDashboard';
      return;
    }

    const storedMapState = this.readStoredMapState();

    if (storedMapState) {
      this.mapReturnState = storedMapState;
      this.sectionReturnUrl = null;
      this.dashboardReturnUrl = null;
      this.favouritesReturnUrl = null;
      this.backLinkText = 'common.back';
      return;
    }

    this.mapReturnState = null;
    this.sectionReturnUrl = null;
    this.dashboardReturnUrl = null;
    this.favouritesReturnUrl = null;
    this.backLinkText = 'common.back';
  }

  private normalizeSectionReturnUrl(value: string | null | undefined): string | null {
    if (!value || !value.startsWith('/section/')) return null;
    return value;
  }

  private normalizeDashboardReturnUrl(value: string | null | undefined): string | null {
    if (!value || !(value === '/' || value.startsWith('/?') || value.startsWith('/tourist-dashboard'))) return null;
    return value;
  }

  private normalizeFavouritesReturnUrl(value: string | null | undefined): string | null {
    if (!value || !value.startsWith('/favourites')) return null;
    return value;
  }

  private readStoredMapState(): MapReturnState | null {
    try {
      const raw = sessionStorage.getItem(this.mapStateStorageKey);
      return raw ? JSON.parse(raw) as MapReturnState : null;
    } catch {
      return null;
    }
  }

  private loadCurrentUser(): void {
    if (this.currentUserId != null || this.isCurrentUserLoading) {
      return;
    }

    if (!this.authState.isLoggedIn()) {
      this.currentUserId = null;
      this.currentUserRole = null;
      return;
    }

    this.isCurrentUserLoading = true;

    this.http.get<any>(buildApiUrl('users/me')).subscribe({
      next: (profile) => {
        const parsedId = Number(profile?.id);
        this.currentUserId = Number.isFinite(parsedId) ? parsedId : null;
        this.currentUserRole = typeof profile?.role === 'string' ? profile.role : null;
        this.isCurrentUserLoading = false;

        const currentItem = this.item();
        if (currentItem) {
          this.loadReviewsForItem(currentItem);
        }
      },
      error: () => {
        this.currentUserId = null;
        this.currentUserRole = null;
        this.isCurrentUserLoading = false;
      }
    });
  }

  private loadReviewsForItem(item: CardItem): void {
    this.http.get<any>(buildApiUrl(`review/target/${item.entityType}/${item.id}?page=1&pageSize=50&sort=dateNewest`)).subscribe({
      next: (reviewResponse) => {
        const reviews = Array.isArray(reviewResponse?.reviews)
          ? reviewResponse.reviews as ReviewApiItem[]
          : [];
        const topReview = reviews[0] ? this.mapReviewToDisplay(reviews[0]) : null;
        const reviewCount = typeof reviewResponse?.totalReviews === 'number'
          ? reviewResponse.totalReviews
          : reviews.length;
        const averageRating = this.normalizeRating(reviewResponse?.averageRating);
        const currentItem = this.item();
        const baseItem = {
          ...(currentItem ?? item),
          rating: averageRating,
          isFavorite: this.isFavorite()
        };

        this.item.set(this.buildDetailedItem(baseItem, reviewCount, topReview));
        this.syncUserReview(reviews);
      },
      error: () => {
        const currentItem = this.item();
        this.item.set(this.buildDetailedItem({ ...(currentItem ?? item), isFavorite: this.isFavorite() }, 0, null));
        this.userReview.set(null);
      }
    });
  }

  private syncUserReview(reviews: ReviewApiItem[]): void {
    const ownReview = this.currentUserId == null
      ? null
      : reviews.find((review) => review.touristUserId === this.currentUserId) ?? null;

    this.userReview.set(ownReview);

    if (ownReview) {
      this.reviewRating.set(typeof ownReview.rating === 'number' ? ownReview.rating : 0);
      this.reviewComment.set(ownReview.comment ?? '');
    } else if (!this.isReviewSaving() && !this.isReviewDeleting()) {
      this.resetReviewForm(false);
    }
  }

  private mapReviewToDisplay(review: ReviewApiItem): ReviewItem {
    const firstName = review.touristFirstName?.trim() || this.translation.translate('reviews.defaultAuthor');
    const lastName = review.touristLastName?.trim() || '';
    const author = `${firstName} ${lastName}`.trim();

    return {
      id: review.id,
      author,
      date: this.formatReviewDate(review.createdAt),
      text: review.comment ?? '',
      rating: typeof review.rating === 'number' ? review.rating : 0,
      avatar: buildAssetUrl(review.touristAvatarUrl) ?? null,
      initials: this.getInitials(firstName, lastName),
      touristUserId: typeof review.touristUserId === 'number' ? review.touristUserId : null,
      isReportedByCurrentUser: !!review.isReportedByCurrentUser
    };
  }

  private resetReviewForm(clearMessages = true): void {
    this.reviewRating.set(0);
    this.reviewHoverRating.set(0);
    this.reviewComment.set('');

    if (clearMessages) {
      this.reviewMessage.set(null);
      this.reviewError.set(null);
    }
  }

  private getReviewTargetTypeValue(entityType: EntityType): number {
    if (entityType === 'Activity') {
      return 1;
    }

    if (entityType === 'Event') {
      return 2;
    }

    return 0;
  }

  private formatReviewDate(value?: string | null): string {
    if (!value) {
      return '';
    }

    return new Date(value).toLocaleDateString(this.translation.currentLanguage() === 'sr' ? 'sr-RS' : 'en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  private getInitials(firstName: string, lastName: string): string {
    return `${firstName.charAt(0)}${lastName.charAt(0) || ''}`.toUpperCase();
  }

  private loadFavouriteState(item: CardItem): void {
    if (!this.canReadFavouriteState()) {
      this.setFavoriteState(false);
      return;
    }

    const stateVersion = ++this.favouriteStateVersion;

    this.favouritesService.isFavourite(item.entityType, item.id).subscribe((isSaved) => {
      if (
        stateVersion !== this.favouriteStateVersion ||
        this.isFavoriteUpdating() ||
        !this.item() ||
        this.item()!.id !== item.id ||
        this.item()!.entityType !== item.entityType
      ) {
        return;
      }

      this.setFavoriteState(isSaved);
    });
  }

  private setFavoriteState(isSaved: boolean): void {
    this.isFavorite.set(isSaved);

    const currentItem = this.item();
    if (currentItem) {
      this.item.set({
        ...currentItem,
        isFavorite: isSaved
      });
    }
  }

  private loadEntityWithFallback(id: number, preferredType: EntityType): Observable<EntityLoadResult | null> {
    const orderedTypes: EntityType[] = [
      preferredType,
      ...(['Object', 'Activity', 'Event'] as EntityType[]).filter((type) => type !== preferredType)
    ];

    return this.tryLoadEntity(id, orderedTypes).pipe(
      switchMap((result) => result ? of(result) : this.tryLoadMarkerLocation(id, orderedTypes))
    );
  }

  private tryLoadEntity(id: number, entityTypes: EntityType[]): Observable<EntityLoadResult | null> {
    const [entityType, ...remainingTypes] = entityTypes;

    if (!entityType) {
      return of(null);
    }

    return this.tryLoadSingleEntity(id, entityType).pipe(
      switchMap((result) => result ? of(result) : remainingTypes.length ? this.tryLoadEntity(id, remainingTypes) : of(null))
    );
  }

  private tryLoadSingleEntity(id: number, entityType: EntityType): Observable<EntityLoadResult | null> {
    return this.http.get<any>(buildApiUrl(this.getEntityEndpoint(entityType, id))).pipe(
      map((item) => ({ item, entityType })),
      catchError(() => of(null))
    );
  }

  private getEntityEndpoint(entityType: EntityType, id: number): string {
    if (entityType === 'Activity') {
      return `activities/${id}`;
    }

    if (entityType === 'Event') {
      return `events/${id}`;
    }

    return `tourist-objects/${id}`;
  }

  private tryLoadMarkerLocation(id: number, entityTypes: EntityType[]): Observable<EntityLoadResult | null> {
    const [entityType, ...remainingTypes] = entityTypes;

    if (!entityType) {
      return of(null);
    }

    return this.http.get<any>(buildApiUrl(`map/marker-location?markerType=${entityType}&id=${id}`)).pipe(
      map((item) => ({ item, entityType })),
      catchError(() => remainingTypes.length ? this.tryLoadMarkerLocation(id, remainingTypes) : of(null))
    );
  }

  private mapToBaseItem(item: any, entityType: EntityType): CardItem {
    const images = this.extractImageUrls(item);
    const location =
      entityType === 'Object'
        ? (item.address ?? item.subType ?? '')
        : entityType === 'Activity'
          ? (item.destinationName ?? item.objectName ?? item.address ?? item.subType ?? '')
          : (item.objectName ?? item.address ?? item.subType ?? '');

    return {
      id: item.id,
      entityType,
      image: images[0] ?? FALLBACK_IMAGE_URL,
      images,
      title: item.name ?? '',
      location,
      rating: this.normalizeRating(item.averageRating),
      price: entityType === 'Object'
        ? ''
        : item.price != null
          ? `${item.currency ?? 'RSD'} ${item.price}`
          : 'Free',
      priceValue: entityType === 'Object' ? null : this.toOptionalPrice(item.price),
      priceCurrency: entityType === 'Object' ? null : item.currency ?? 'RSD',
      isFavorite: false,
      description: item.description ?? '',
      airbnbUrl: this.normalizeExternalUrl(entityType === 'Object' || entityType === 'Activity' ? item.airbnbUrl : null),
      bookingUrl: this.normalizeExternalUrl(entityType === 'Object' || entityType === 'Activity' ? item.bookingUrl : null),
      websiteUrl: this.normalizeExternalUrl(entityType === 'Object' ? item.website : null),
      amenities: this.extractAmenities(item),
      destinationId: this.toOptionalNumber(
        item.destinationId ??
        item.destination?.id ??
        item.object?.destinationId ??
        item.object?.destination?.id
      ),
      destinationName: (
        item.destinationName ??
        item.destination?.name ??
        item.object?.destinationName ??
        item.object?.destination?.name ??
        null
      )
    };
  }

  private extractImageUrls(item: any): string[] {
    const imageUrls = buildAssetUrls(item);
    return imageUrls.length ? imageUrls : [FALLBACK_IMAGE_URL];
  }

  private buildDetailedItem(baseItem: CardItem, reviewCount: number, topReview: ReviewItem | null): DetailedItem {
    return {
      ...baseItem,
      reviewCount,
      aboutText: baseItem.description ||
        this.translation.translate('details.fallbackAboutText', { title: baseItem.title }),
      amenities: baseItem.amenities,
      topReview
    };
  }

  private moveImage(direction: 1 | -1, manual: boolean): void {
    const currentItem = this.item();
    if (!currentItem || currentItem.images.length <= 1) {
      return;
    }

    const length = currentItem.images.length;
    const nextIndex = (this.activeImageIndex() + direction + length) % length;
    this.activeImageIndex.set(nextIndex);

    if (manual) {
      this.restartImageAutoSlide();
    }
  }

  private startImageAutoSlide(): void {
    this.stopImageAutoSlide();
    const currentItem = this.item();
    if (!currentItem || currentItem.images.length <= 1) {
      return;
    }

    this.imageAutoSlideTimer = window.setInterval(() => this.moveImage(1, false), this.imageAutoSlideMs);
  }

  private restartImageAutoSlide(): void {
    this.startImageAutoSlide();
  }

  private stopImageAutoSlide(): void {
    if (this.imageAutoSlideTimer != null) {
      window.clearInterval(this.imageAutoSlideTimer);
      this.imageAutoSlideTimer = null;
    }
  }

  displayPrice(item: DetailedItem): string {
    if (item.entityType === 'Object') {
      return '';
    }

    if (item.priceValue == null) {
      return this.priceFormat.formatPrice(0, item.priceCurrency);
    }

    return this.priceFormat.formatPrice(item.priceValue, item.priceCurrency);
  }

  displayCategoryTag(tag: string): string {
    const normalized = this.normalize(tag);
    const keyByTag: Record<string, string> = {
      event: 'entity.event',
      live: 'details.tagLive',
      popular: 'details.tagPopular',
      activity: 'entity.activity',
      adventure: 'details.tagAdventure',
      nature: 'details.tagNature',
      cabin: 'details.tagCabin',
      local: 'details.tagLocal',
      food: 'details.tagFood'
    };

    return keyByTag[normalized] ? this.translation.translate(keyByTag[normalized]) : tag;
  }

  private extractAmenities(item: any): AmenityItem[] {
    const rawSources = [
      item?.amenities,
      item?.features,
      item?.facilities,
      item?.offers,
      item?.included,
      item?.object?.amenities,
      item?.object?.features,
      item?.object?.facilities
    ];

    const labels = rawSources
      .flatMap(source => this.toAmenityLabels(source))
      .map(label => label.trim())
      .filter(Boolean);

    const uniqueLabels = [...new Map(labels.map(label => [this.normalize(label), label])).values()];

    return uniqueLabels.map(label => ({
      icon: this.getAmenityIcon(label),
      label
    }));
  }

  private toAmenityLabels(source: unknown): string[] {
    if (!source) return [];

    if (Array.isArray(source)) {
      return source.flatMap(item => this.toAmenityLabels(item));
    }

    if (typeof source === 'string') {
      return source
        .split(/[,;\n]/)
        .map(value => value.trim())
        .filter(Boolean);
    }

    if (typeof source === 'object') {
      const record = source as Record<string, unknown>;
      const label = record['label'] ?? record['name'] ?? record['title'] ?? record['description'];
      return typeof label === 'string' ? [label] : [];
    }

    return [];
  }

  private getAmenityIcon(label: string): AmenityItem['icon'] {
    const normalized = this.normalize(label);

    if (normalized.includes('air') || normalized.includes('ac') || normalized.includes('heat') || normalized.includes('klim')) {
      return 'wind';
    }

    if (normalized.includes('breakfast') || normalized.includes('food') || normalized.includes('meal') || normalized.includes('doruc')) {
      return 'cup';
    }

    if (normalized.includes('parking') || normalized.includes('garage')) {
      return 'car';
    }

    return 'map';
  }

  private getCategoryTags(item: CardItem): string[] {
    const title = item.title.toLowerCase();
    const price = item.price.toLowerCase();

    if (item.entityType === 'Event') {
      return ['Event', 'Live', 'Popular'];
    }

    if (item.entityType === 'Activity') {
      return ['Activity', 'Adventure', 'Popular'];
    }

    if (title.includes('cabin') || title.includes('retreat') || title.includes('stay') || price.includes('/ night')) {
      return ['Nature', 'Cabin', 'Popular'];
    }

    if (title.includes('restaurant') || price.includes('/ meal')) {
      return ['Local', 'Food', 'Popular'];
    }

    return ['Nature', 'Adventure', 'Popular'];
  }

  private normalizeRating(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }

    return Number(value.toFixed(2));
  }

  private normalize(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private toOptionalNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private toOptionalPrice(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private canReadFavouriteState(): boolean {
    return this.canUseFavourites();
  }

  private canAttemptFavouriteWrite(): boolean {
    return this.canUseFavourites();
  }

  private canUseFavourites(): boolean {
    return this.authState.isLoggedIn()
      && (this.authState.getUserRole() ?? '').toLowerCase() === 'tourist';
  }

  private redirectToLogin(): void {
    this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
  }

  private normalizeExternalUrl(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    try {
      const url = new URL(normalized);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
    } catch {
      return null;
    }
  }
}
