import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { ReviewModerationItem } from '../../shared/admin-destination.models';
import { AdminDestinationReviewsService } from './reviews.service';
import { SelectModule } from 'primeng/select';
import { Paginator, PaginatorState } from 'primeng/paginator';

type RatingFilter = 'all' | '1' | '2' | '3' | '4' | '5';
type SortFilter = 'ratingDesc' | 'ratingAsc';
type ReviewTargetType = ReviewModerationItem['targetType'];

@Component({
  selector: 'app-admin-destination-reviews',
  standalone: true,
  imports: [CommonModule, FormsModule, SelectModule, Paginator],
  templateUrl: './reviews.html',
  styleUrl: './reviews.css'
})
export class AdminDestinationReviewsComponent implements OnInit {
  private readonly reviewsSignal = signal<ReviewModerationItem[]>([]);
  private readonly isLoadingSignal = signal(false);
  private readonly searchTermSignal = signal('');
  private readonly ratingFilterSignal = signal<RatingFilter>('all');
  private readonly sortFilterSignal = signal<SortFilter>('ratingDesc');
  private readonly targetTypeFiltersSignal = signal<Record<ReviewTargetType, boolean>>({
    Object: true,
    Activity: true,
    Event: true
  });
  private readonly moderationReasonsSignal = signal<Record<number, string>>({});
  private readonly busyReviewIdsSignal = signal<Record<number, boolean>>({});

  readonly ratingOptions: { label: string; value: RatingFilter }[] = [
    { label: 'All ratings', value: 'all' },
    { label: '1 star', value: '1' },
    { label: '2 stars', value: '2' },
    { label: '3 stars', value: '3' },
    { label: '4 stars', value: '4' },
    { label: '5 stars', value: '5' }
  ];

  readonly sortOptions: { label: string; value: SortFilter }[] = [
    { label: 'Rating: high to low', value: 'ratingDesc' },
    { label: 'Rating: low to high', value: 'ratingAsc' }
  ];

  readonly targetTypeOptions: { label: string; value: ReviewTargetType }[] = [
    { label: 'Objects', value: 'Object' },
    { label: 'Activities', value: 'Activity' },
    { label: 'Events', value: 'Event' }
  ];

  readonly pageSizeOptions = [5, 10, 20];
  readonly first = signal(0);
  readonly pageSize = signal(10);

  readonly filteredReviewsSignal = computed(() => {
    const query = this.searchTermSignal().trim().toLowerCase();
    const ratingFilter = this.ratingFilterSignal();
    const sortFilter = this.sortFilterSignal();
    const targetTypeFilters = this.targetTypeFiltersSignal();

    const filtered = this.reviewsSignal().filter((item) => {
      const touristName = `${item.touristFirstName ?? ''} ${item.touristLastName ?? ''}`.toLowerCase();
      const targetName = (item.targetName ?? '').toLowerCase();
      const targetType = (item.targetType ?? '').toLowerCase();
      const comment = (item.comment ?? '').toLowerCase();

      const matchesQuery =
        !query ||
        touristName.includes(query) ||
        targetName.includes(query) ||
        targetType.includes(query) ||
        comment.includes(query);

      const matchesRating =
        ratingFilter === 'all' ||
        item.rating === Number(ratingFilter);

      const matchesTargetType = targetTypeFilters[item.targetType] ?? true;

      return matchesQuery && matchesRating && matchesTargetType;
    });

    return [...filtered].sort((a, b) => {
      const ratingDelta = sortFilter === 'ratingAsc'
        ? a.rating - b.rating
        : b.rating - a.rating;

      if (ratingDelta !== 0) return ratingDelta;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  });

  readonly paginatedReviewsSignal = computed(() => {
    const start = this.first();
    const size = this.pageSize();
    return this.filteredReviewsSignal().slice(start, start + size);
  });

  readonly totalCountSignal = computed(() => this.reviewsSignal().length);
  readonly resultCountSignal = computed(() => this.filteredReviewsSignal().length);

  constructor(
    private reviewsService: AdminDestinationReviewsService,
    private route: ActivatedRoute,
    private toastr: ToastrService
  ) {}

  ngOnInit(): void {
    const resolvedReviews = this.route.snapshot.data['reviews'] ?? [];
    this.reviews = resolvedReviews;
  }

  get reviews(): ReviewModerationItem[] { return this.reviewsSignal(); }
  set reviews(value: ReviewModerationItem[]) { this.reviewsSignal.set([...(value ?? [])]); }

  get filteredReviews(): ReviewModerationItem[] { return this.filteredReviewsSignal(); }
  get paginatedReviews(): ReviewModerationItem[] { return this.paginatedReviewsSignal(); }

  get isLoading(): boolean { return this.isLoadingSignal(); }
  set isLoading(value: boolean) { this.isLoadingSignal.set(value); }

  get searchTerm(): string { return this.searchTermSignal(); }
  set searchTerm(value: string) { this.searchTermSignal.set(value ?? ''); this.first.set(0); }

  get ratingFilter(): RatingFilter { return this.ratingFilterSignal(); }
  set ratingFilter(value: RatingFilter) { this.ratingFilterSignal.set(this.normalizeRatingFilter(value)); this.first.set(0); }

  get sortFilter(): SortFilter { return this.sortFilterSignal(); }
  set sortFilter(value: SortFilter) { this.sortFilterSignal.set(this.normalizeSortFilter(value)); this.first.set(0); }

  get totalCount(): number { return this.totalCountSignal(); }
  get resultCount(): number { return this.resultCountSignal(); }

  onPageChange(event: PaginatorState): void {
    this.first.set(event.first ?? 0);
    this.pageSize.set(event.rows ?? 10);
  }

  loadReviews(): void {
    this.isLoading = true;
    this.reviewsService.getReviewsForAdminDestination().subscribe({
      next: (reviews) => { this.reviews = reviews; this.isLoading = false; },
      error: (error) => {
        this.isLoading = false;
        if (error?.status === 401) {
          this.toastr.error('You are not authorized. Log in again as destination admin.');
          return;
        }
        this.toastr.error('Reviews could not be loaded for moderation.');
      }
    });
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.ratingFilter = 'all';
    this.sortFilter = 'ratingDesc';
    this.targetTypeFiltersSignal.set({ Object: true, Activity: true, Event: true });
    this.first.set(0);
  }

  targetTypeEnabled(type: ReviewTargetType): boolean { return this.targetTypeFiltersSignal()[type] ?? true; }

  setTargetTypeEnabled(type: ReviewTargetType, value: boolean): void {
    this.targetTypeFiltersSignal.update((current) => ({ ...current, [type]: value }));
    this.first.set(0);
  }

  moderationReason(reviewId: number): string { return this.moderationReasonsSignal()[reviewId] ?? ''; }

  setModerationReason(reviewId: number, value: string): void {
    this.moderationReasonsSignal.update((current) => ({ ...current, [reviewId]: value ?? '' }));
  }

  isReviewBusy(reviewId: number): boolean { return !!this.busyReviewIdsSignal()[reviewId]; }

  toggleVisibility(item: ReviewModerationItem): void {
    if (this.isReviewBusy(item.id)) return;
    const reason = this.moderationReason(item.id).trim();
    if (!reason) { this.toastr.error('Reason is required before hiding a reported review.'); return; }
    this.setReviewBusy(item.id, true);
    this.reviewsService.toggleVisibility(item.id, reason).subscribe({
      next: () => {
        this.setReviewBusy(item.id, false);
        this.removeReview(item.id);
        this.clearModerationReason(item.id);
        this.toastr.success(`Review #${item.id} has been hidden.`);
      },
      error: (error) => {
        this.setReviewBusy(item.id, false);
        if (error?.status === 401 || error?.status === 403) { this.toastr.error('You are not authorized. Log in again as destination admin.'); return; }
        this.toastr.error(error?.error?.message ?? error?.error ?? 'The review could not be hidden.');
      }
    });
  }

  ignoreReports(item: ReviewModerationItem): void {
    if (this.isReviewBusy(item.id)) return;
    this.setReviewBusy(item.id, true);
    this.reviewsService.ignoreReports(item.id).subscribe({
      next: () => {
        this.setReviewBusy(item.id, false);
        this.removeReview(item.id);
        this.clearModerationReason(item.id);
        this.toastr.success(`Reports for review #${item.id} have been ignored.`);
      },
      error: (error) => {
        this.setReviewBusy(item.id, false);
        if (error?.status === 401 || error?.status === 403) { this.toastr.error('You are not authorized. Log in again as destination admin.'); return; }
        this.toastr.error('The reports could not be ignored.');
      }
    });
  }

  trackByReviewId(index: number, item: ReviewModerationItem): number { return item.id; }

  buildStars(rating: number): string {
    const safeRating = Math.max(0, Math.min(5, Number(rating) || 0));
    return `${safeRating}/5`;
  }

  private removeReview(reviewId: number): void {
    this.reviewsSignal.update((reviews) => reviews.filter((review) => review.id !== reviewId));
  }

  private clearModerationReason(reviewId: number): void {
    this.moderationReasonsSignal.update((current) => { const next = { ...current }; delete next[reviewId]; return next; });
  }

  private setReviewBusy(reviewId: number, isBusy: boolean): void {
    this.busyReviewIdsSignal.update((current) => ({ ...current, [reviewId]: isBusy }));
  }

  private normalizeRatingFilter(value: string): RatingFilter {
    if (value === '1' || value === '2' || value === '3' || value === '4' || value === '5') return value;
    return 'all';
  }

  private normalizeSortFilter(value: string): SortFilter {
    if (value === 'ratingAsc') return value;
    return 'ratingDesc';
  }
}