import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HeaderComponent } from '../header/header';
import { buildApiUrl, buildAssetUrl } from '../../core/config/api';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import { SelectModule } from 'primeng/select';

type EntityType = 'Object' | 'Activity' | 'Event';
type ReviewSortOption = 'dateNewest' | 'dateOldest' | 'ratingDesc' | 'ratingAsc';

interface ReviewApiItem {
  id: number;
  touristUserId?: number | null;
  touristFirstName?: string | null;
  touristLastName?: string | null;
  touristAvatarUrl?: string | null;
  rating?: number | null;
  comment?: string | null;
  reportCount?: number | null;
  isReportedByCurrentUser?: boolean | null;
  createdAt?: string | null;
}

interface ReviewCard {
  id: number;
  author: string;
  date: string;
  createdAtMs: number;
  rating: number;
  comment: string;
  initials: string;
  avatarUrl: string | null;
  touristUserId: number | null;
  reportCount: number;
  isReportedByCurrentUser: boolean;
}

@Component({
  selector: 'app-reviews-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HeaderComponent, TranslatePipe, SelectModule],
  templateUrl: './reviews-page.html',
  styleUrl: './reviews-page.css'
})
export class ReviewsPageComponent implements OnInit {
  readonly entityType = signal<EntityType>('Object');
  readonly entityId = signal(0);
  readonly itemTitle = signal('Reviews');
  readonly itemLocation = signal('');
  readonly averageRating = signal(0);
  readonly totalReviews = signal(0);
  readonly reviews = signal<ReviewCard[]>([]);
  readonly currentUserId = signal<number | null>(null);
  readonly currentUserRole = signal<string | null>(null);
  readonly currentUserHasHiddenReview = signal(false);
  readonly editingReview = signal<ReviewCard | null>(null);
  readonly reviewRating = signal(0);
  readonly reviewComment = signal('');
  readonly reviewHoverRating = signal(0);
  readonly reviewMessage = signal<string | null>(null);
  readonly reviewError = signal<string | null>(null);
  readonly isReviewSaving = signal(false);
  readonly isReviewDeleting = signal(false);
  readonly reportingReviewIds = signal<Record<number, boolean>>({});
  readonly reviewStars = [1, 2, 3, 4, 5];
  readonly ratingFilterOptions = [
    { number: null, labelKey: 'reviews.allRatings', value: null },
    { number: 1, labelKey: 'reviews.stars', value: 1 },
    { number: 2, labelKey: 'reviews.stars', value: 2 },
    { number: 3, labelKey: 'reviews.stars', value: 3 },
    { number: 4, labelKey: 'reviews.stars', value: 4 },
    { number: 5, labelKey: 'reviews.stars', value: 5 },
  ];
  readonly selectedRatingFilter = signal<number | null>(null);
  readonly reviewSort = signal<ReviewSortOption>('dateNewest');
  readonly reviewPage = signal(1);
  readonly reviewTotalPages = signal(1);
  readonly reviewResultTotal = signal(0);
  readonly reviewPageSize = 8;
  readonly reviewSortOptions: { labelKey: string; value: ReviewSortOption }[] = [
    { labelKey: 'sort.dateNewest', value: 'dateNewest' },
    { labelKey: 'sort.dateOldest', value: 'dateOldest' },
    { labelKey: 'sort.ratingDesc', value: 'ratingDesc' },
    { labelKey: 'sort.ratingAsc', value: 'ratingAsc' }
  ];
  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly filteredReviews = computed(() => this.reviews());
  readonly visibleReviews = computed(() => this.reviews());
  readonly canShowMoreReviews = computed(() => this.reviewPage() < this.reviewTotalPages());

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private translation: TranslationService
  ) {}

  ngOnInit(): void {
    this.loadCurrentUser();

    this.route.paramMap.subscribe((params) => {
      document.body.scrollTo({ top: 0, behavior: 'instant' });
      const id = Number(params.get('id'));
      const entityType = this.normalizeEntityType(params.get('entityType'));

      if (!Number.isFinite(id) || id <= 0) {
        this.router.navigate(['/tourist-dashboard']);
        return;
      }

      this.entityType.set(entityType);
      this.entityId.set(id);
      this.errorMessage.set(null);
      this.isLoading.set(true);
      this.resetReviewListControls();
      this.loadItemSummary(entityType, id);
      this.loadReviews(entityType, id);
    });
  }

  get ownReview(): ReviewCard | null {
    const userId = this.currentUserId();
    return userId == null
      ? null
      : this.reviews().find(review => review.touristUserId === userId) ?? null;
  }

  isStarFilled(rating: number, star: number): boolean {
    return star <= Math.round(rating);
  }

  isReviewStarActive(star: number): boolean {
    return star <= (this.reviewHoverRating() || this.reviewRating());
  }

  reviewsLabel(count: number): string {
    return this.translation.translate(count === 1 ? 'reviews.one' : 'reviews.many');
  }

  starRatingLabel(star: number): string {
    return this.translation.translate('reviews.starRating', { count: star });
  }

  outOfStarsLabel(rating: number): string {
    return this.translation.translate('reviews.outOfStars', { rating });
  }

  setRatingFilter(value: number | null): void {
    this.selectedRatingFilter.set(value);
    this.loadReviews(this.entityType(), this.entityId(), true);
  }

  setReviewSort(value: ReviewSortOption): void {
    this.reviewSort.set(value);
    this.loadReviews(this.entityType(), this.entityId(), true);
  }

  showMoreReviews(): void {
    if (!this.canShowMoreReviews()) return;
    this.loadReviews(this.entityType(), this.entityId(), false);
  }

  setReviewRating(rating: number): void {
    this.reviewRating.set(rating);
    this.reviewError.set(null);
  }

  setReviewHoverRating(rating: number): void {
    this.reviewHoverRating.set(rating);
  }

  startEditingReview(review: ReviewCard): void {
    if (this.currentUserHasHiddenReview()) {
      return;
    }

    this.editingReview.set(review);
    this.reviewRating.set(review.rating);
    this.reviewComment.set(review.comment === this.translation.translate('reviews.noWrittenComment') ? '' : review.comment);
    this.reviewMessage.set(null);
    this.reviewError.set(null);
  }

  cancelEditingReview(): void {
    this.editingReview.set(null);
    this.resetReviewForm();
  }

  submitReview(): void {
    if (this.isReviewSaving()) return;

    if (this.currentUserId() == null) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
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

    const payload = {
      targetId: this.entityId(),
      targetType: this.getReviewTargetTypeValue(this.entityType()),
      rating,
      comment
    };

    const editing = this.editingReview();
    const request = editing
      ? this.http.put<ReviewApiItem>(buildApiUrl(`review/${editing.id}`), payload)
      : this.http.post<ReviewApiItem>(buildApiUrl('review'), payload);

    this.isReviewSaving.set(true);
    this.reviewMessage.set(null);
    this.reviewError.set(null);

    request.subscribe({
      next: () => {
        this.isReviewSaving.set(false);
        this.reviewMessage.set(this.translation.translate(editing ? 'reviews.updated' : 'reviews.posted'));
        this.resetReviewForm(false);
        this.editingReview.set(null);
        this.loadReviews(this.entityType(), this.entityId());
      },
      error: (error) => {
        this.isReviewSaving.set(false);
        this.reviewError.set(error?.error?.message ?? error?.error ?? this.translation.translate('reviews.saveFailed'));
      }
    });
  }

  deleteReview(): void {
    const editing = this.editingReview();
    if (!editing || this.isReviewDeleting()) return;

    this.isReviewDeleting.set(true);
    this.reviewMessage.set(null);
    this.reviewError.set(null);

    this.http.delete(buildApiUrl(`review/${editing.id}`)).subscribe({
      next: () => {
        this.isReviewDeleting.set(false);
        this.reviewMessage.set(this.translation.translate('reviews.deleted'));
        this.editingReview.set(null);
        this.resetReviewForm(false);
        this.loadReviews(this.entityType(), this.entityId());
      },
      error: (error) => {
        this.isReviewDeleting.set(false);
        this.reviewError.set(error?.error?.message ?? error?.error ?? this.translation.translate('reviews.deleteFailed'));
      }
    });
  }

  signInToReview(): void {
    this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
  }

  canReportReview(review: ReviewCard): boolean {
    return this.currentUserId() != null
      && this.currentUserRole() === 'Tourist'
      && review.touristUserId !== this.currentUserId()
      && !review.isReportedByCurrentUser;
  }

  isReviewReported(review: ReviewCard): boolean {
    return review.touristUserId !== this.currentUserId() && review.isReportedByCurrentUser;
  }

  isReportingReview(reviewId: number): boolean {
    return !!this.reportingReviewIds()[reviewId];
  }

  reportReview(review: ReviewCard): void {
    if (this.currentUserId() == null) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }

    if (!this.canReportReview(review) || this.isReportingReview(review.id)) {
      return;
    }

    this.reportingReviewIds.update((current) => ({ ...current, [review.id]: true }));
    this.reviewMessage.set(null);
    this.reviewError.set(null);

    this.http.post<ReviewApiItem>(buildApiUrl(`review/${review.id}/report`), {}).subscribe({
      next: (updatedReview) => {
        this.reportingReviewIds.update((current) => ({ ...current, [review.id]: false }));
        this.patchReview(this.mapReview(updatedReview));
        this.reviewMessage.set(this.translation.translate('reviews.reported'));
      },
      error: (error) => {
        this.reportingReviewIds.update((current) => ({ ...current, [review.id]: false }));
        this.reviewError.set(error?.error?.message ?? error?.error ?? this.translation.translate('reviews.reportFailed'));
      }
    });
  }

  private loadItemSummary(entityType: EntityType, id: number): void {
    this.http.get<any>(buildApiUrl(this.getEntityEndpoint(entityType, id))).subscribe({
      next: (item) => {
        this.itemTitle.set(item?.name ?? this.translation.translate('reviews.title'));
        this.itemLocation.set(this.getLocation(item, entityType));
        this.averageRating.set(this.normalizeRating(item?.averageRating));
        this.totalReviews.set(typeof item?.reviewCount === 'number' ? item.reviewCount : this.totalReviews());
      },
      error: () => {
        this.itemTitle.set(this.translation.translate('reviews.title'));
      }
    });
  }

  private loadReviews(entityType: EntityType, id: number, reset = true): void {
    if (reset) {
      this.isLoading.set(true);
      this.errorMessage.set(null);
      this.reviewPage.set(1);
    }

    const page = reset ? 1 : this.reviewPage() + 1;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(this.reviewPageSize),
      sort: this.reviewSort()
    });
    const rating = this.selectedRatingFilter();
    if (rating != null) {
      params.set('minRating', String(rating));
      params.set('maxRating', String(rating));
    }

    this.http.get<any>(buildApiUrl(`review/target/${entityType}/${id}?${params.toString()}`)).subscribe({
      next: (response) => {
        const reviewItems = Array.isArray(response?.reviews) ? response.reviews : [];
        const mappedReviews = reviewItems.map((review: ReviewApiItem) => this.mapReview(review));
        this.reviews.set(reset ? mappedReviews : [...this.reviews(), ...mappedReviews]);
        this.currentUserHasHiddenReview.set(!!response?.currentUserHasHiddenReview);
        this.reviewResultTotal.set(typeof response?.totalReviews === 'number' ? response.totalReviews : mappedReviews.length);
        this.reviewPage.set(typeof response?.page === 'number' ? response.page : page);
        this.reviewTotalPages.set(Math.max(1, typeof response?.totalPages === 'number' ? response.totalPages : 1));

        if (rating == null) {
          this.totalReviews.set(typeof response?.totalReviews === 'number' ? response.totalReviews : reviewItems.length);
          this.averageRating.set(this.normalizeRating(response?.averageRating));
        }

        this.isLoading.set(false);
      },
      error: () => {
        if (reset) {
          this.reviews.set([]);
        }
        this.currentUserHasHiddenReview.set(false);
        this.errorMessage.set(this.translation.translate('reviews.loadFailed'));
        this.isLoading.set(false);
      }
    });
  }

  private mapReview(review: ReviewApiItem): ReviewCard {
    const firstName = review.touristFirstName?.trim() || this.translation.translate('reviews.defaultAuthor');
    const lastName = review.touristLastName?.trim() || '';
    const author = `${firstName} ${lastName}`.trim();

    return {
      id: review.id,
      author,
      date: this.formatDate(review.createdAt),
      createdAtMs: this.toDateTime(review.createdAt),
      rating: typeof review.rating === 'number' ? review.rating : 0,
      comment: review.comment?.trim() || this.translation.translate('reviews.noWrittenComment'),
      initials: this.getInitials(firstName, lastName),
      avatarUrl: buildAssetUrl(review.touristAvatarUrl) ?? null,
      touristUserId: typeof review.touristUserId === 'number' ? review.touristUserId : null,
      reportCount: typeof review.reportCount === 'number' ? review.reportCount : 0,
      isReportedByCurrentUser: !!review.isReportedByCurrentUser
    };
  }

  private patchReview(updatedReview: ReviewCard): void {
    this.reviews.update((reviews) =>
      reviews.map((review) => review.id === updatedReview.id ? updatedReview : review)
    );
  }

  private resetReviewListControls(): void {
    this.selectedRatingFilter.set(null);
    this.reviewSort.set('dateNewest');
    this.reviewPage.set(1);
    this.reviewTotalPages.set(1);
    this.reviewResultTotal.set(0);
  }

  private loadCurrentUser(): void {
    this.http.get<any>(buildApiUrl('users/me')).subscribe({
      next: (profile) => {
        const id = Number(profile?.id);
        this.currentUserId.set(Number.isFinite(id) ? id : null);
        this.currentUserRole.set(typeof profile?.role === 'string' ? profile.role : null);
      },
      error: () => {
        this.currentUserId.set(null);
        this.currentUserRole.set(null);
      }
    });
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

  private normalizeEntityType(value: string | null): EntityType {
    const normalized = value?.toLowerCase();

    if (normalized === 'activity') {
      return 'Activity';
    }

    if (normalized === 'event') {
      return 'Event';
    }

    return 'Object';
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

  private getLocation(item: any, entityType: EntityType): string {
    if (!item) {
      return '';
    }

    if (entityType === 'Object') {
      return item.address ?? item.objectTypeName ?? '';
    }

    if (entityType === 'Activity') {
      return item.destinationName ?? item.objectName ?? '';
    }

    return item.objectName ?? item.eventTypeName ?? '';
  }

  private normalizeRating(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }

    return Number(value.toFixed(2));
  }

  private formatDate(value?: string | null): string {
    if (!value) {
      return '';
    }

    return new Date(value).toLocaleDateString(this.translation.currentLanguage() === 'sr' ? 'sr-RS' : 'en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  private toDateTime(value?: string | null): number {
    if (!value) {
      return 0;
    }

    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  private getInitials(firstName: string, lastName: string): string {
    return `${firstName.charAt(0)}${lastName.charAt(0) || ''}`.toUpperCase();
  }
}
