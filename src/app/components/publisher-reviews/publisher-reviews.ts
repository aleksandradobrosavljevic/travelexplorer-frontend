import { Component, OnInit, signal, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, take } from 'rxjs';
import { PublisherHeaderComponent } from '../publisher-header/publisher-header';
import { PublisherReviewItem, PublisherReviewsService } from '../../services/publisher-reviews.service';
import { Router, ActivatedRoute } from '@angular/router';
import {
  PublisherContentService,
  PublisherContentType
} from '../../services/publisher-content.service';
import { Select } from 'primeng/select';
import { PublisherStateService } from '../../services/publisher-state.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';

interface ContentGroup {
  contentId: number;
  contentTitle: string;
  contentType: PublisherContentType;
  status?: string;
  destinationName?: string | null;
  reviews: PublisherReviewItem[];
  averageRating: number;
  reviewCount: number;
}

interface MonthReviewEntry {
  monthIndex: number;
  label: string;
  count: number;
  averageRating: number;
}

interface ReviewFocusRequest {
  contentId: number;
  openReviews: boolean;
}

@Component({
  selector: 'app-publisher-reviews',
  standalone: true,
  imports: [CommonModule, FormsModule, PublisherHeaderComponent, Select, TranslatePipe],
  templateUrl: './publisher-reviews.html',
  styleUrl: './publisher-reviews.css'
})
export class PublisherReviewsComponent implements OnInit {
  private readonly translation = inject(TranslationService);

  reviews = signal<PublisherReviewItem[]>([]);
  contentGroups = signal<ContentGroup[]>([]);
  publisherContentType = signal<PublisherContentType>('Object');
  isLoading = signal(true);
  isReviewsLoading = signal(false);
  selectedReviewGroup = signal<ContentGroup | null>(null);
  selectedAnalyticsContentId = signal<number | null>(null);
  private loadedReviewContentId = signal<number | null>(null);

  searchTerm = signal('');
  ratingFilter = signal(0);
  sortGroupsBy = signal('reviews-desc');
  sortReviewsBy = signal('date-desc');
  selectedYear = signal(new Date().getFullYear());
  contentPage = signal(1);
  contentTotalPages = signal(1);
  reviewPage = signal(1);

  private readonly contentPageSize = 8;
  private readonly reviewPageSize = 5;
  private readonly paramsReady = signal(false);
  readonly returnToContentId = signal<number | null>(null);
  private pendingReviewFocus: ReviewFocusRequest | null = null;
  private loadingReviewContentId: number | null = null;

  private readonly monthTranslationKeys = [
    'publisher.reviews.months.jan',
    'publisher.reviews.months.feb',
    'publisher.reviews.months.mar',
    'publisher.reviews.months.apr',
    'publisher.reviews.months.may',
    'publisher.reviews.months.jun',
    'publisher.reviews.months.jul',
    'publisher.reviews.months.aug',
    'publisher.reviews.months.sep',
    'publisher.reviews.months.oct',
    'publisher.reviews.months.nov',
    'publisher.reviews.months.dec'
  ];

  readonly monthLabels = computed(() => {
    this.translation.currentLanguage();
    return this.monthTranslationKeys.map(key => this.translation.translate(key));
  });

  sortGroupsOptions = computed(() => {
    this.translation.currentLanguage();
    return [
      { label: this.translation.translate('publisher.reviews.sortGroups.mostReviewed'), value: 'reviews-desc' },
      { label: this.translation.translate('publisher.reviews.sortGroups.leastReviewed'), value: 'reviews-asc' },
      { label: this.translation.translate('publisher.reviews.sortGroups.highestRating'), value: 'rating-desc' },
      { label: this.translation.translate('publisher.reviews.sortGroups.lowestRating'), value: 'rating-asc' },
      { label: this.translation.translate('publisher.reviews.sortGroups.nameAsc'), value: 'name-asc' },
    ];
  });

  sortReviewsOptions = computed(() => {
    this.translation.currentLanguage();
    return [
      { label: this.translation.translate('publisher.reviews.sortReviews.newest'), value: 'date-desc' },
      { label: this.translation.translate('publisher.reviews.sortReviews.oldest'), value: 'date-asc' },
      { label: this.translation.translate('publisher.reviews.sortReviews.highestRating'), value: 'rating-desc' },
      { label: this.translation.translate('publisher.reviews.sortReviews.lowestRating'), value: 'rating-asc' },
    ];
  });

  yearOptions = computed(() => {
    const years = this.availableYears();
    return (years.length ? years : [this.selectedYear()]).map(year => ({
      label: String(year),
      value: year
    }));
  });

  groupedContent = computed(() => this.contentGroups());

  filteredContentGroups = computed(() => this.contentGroups());

  pagedContentGroups = computed(() => this.contentGroups());

  selectedAnalyticsGroup = computed(() => {
    const groups = this.groupedContent();
    if (!groups.length) return null;

    const selectedId = this.selectedAnalyticsContentId();
    const selectedGroup = selectedId !== null
      ? groups.find(group => group.contentId === selectedId)
      : null;

    if (selectedGroup) return selectedGroup;

    const selectedModalGroup = this.selectedReviewGroup();
    if (selectedId !== null && selectedModalGroup?.contentId === selectedId) {
      return selectedModalGroup;
    }

    return groups[0];
  });

  selectedAnalyticsReviews = computed(() => {
    const selectedGroup = this.selectedAnalyticsGroup();
    if (!selectedGroup || this.loadedReviewContentId() !== selectedGroup.contentId) return [];
    return this.reviews();
  });

  modalReviews = computed(() => {
    const group = this.selectedReviewGroup();
    if (!group) return [];

    if (this.loadedReviewContentId() !== group.contentId) return [];

    let reviews = [...this.reviews()];

    if (this.ratingFilter() > 0) {
      reviews = reviews.filter(review => review.rating === this.ratingFilter());
    }

    switch (this.sortReviewsBy()) {
      case 'date-desc':
        reviews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        break;
      case 'date-asc':
        reviews.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        break;
      case 'rating-desc':
        reviews.sort((a, b) => b.rating - a.rating || new Date(b.date).getTime() - new Date(a.date).getTime());
        break;
      case 'rating-asc':
        reviews.sort((a, b) => a.rating - b.rating || new Date(b.date).getTime() - new Date(a.date).getTime());
        break;
    }

    return reviews;
  });

  pagedModalReviews = computed(() => {
    const start = (this.reviewPage() - 1) * this.reviewPageSize;
    return this.modalReviews().slice(start, start + this.reviewPageSize);
  });

  reviewTotalPages = computed(() => Math.max(1, Math.ceil(this.modalReviews().length / this.reviewPageSize)));

  totalReviews = computed(() => this.selectedAnalyticsReviews().length);

  averageRating = computed(() => {
    const reviews = this.selectedAnalyticsReviews();
    if (!reviews.length) return 0;
    return reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
  });

  reviewedContentCount = computed(() => this.groupedContent().filter(group => group.reviewCount > 0).length);

  fiveStarPercentage = computed(() => {
    const total = this.totalReviews();
    if (!total) return 0;
    const fiveStarCount = this.selectedAnalyticsReviews().filter(review => review.rating === 5).length;
    return Math.round((fiveStarCount / total) * 100);
  });

  availableYears = computed(() => {
    const years = new Set<number>();
    for (const review of this.selectedAnalyticsReviews()) {
      const year = new Date(review.date).getFullYear();
      if (!Number.isNaN(year)) years.add(year);
    }
    return Array.from(years).sort((a, b) => b - a);
  });

  monthlyReviewData = computed<MonthReviewEntry[]>(() => {
    const selectedYear = this.selectedYear();
    return this.monthLabels().map((label, monthIndex) => {
      const reviews = this.selectedAnalyticsReviews().filter(review => {
        const date = new Date(review.date);
        return date.getFullYear() === selectedYear && date.getMonth() === monthIndex;
      });
      const averageRating = reviews.length
        ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
        : 0;
      return { monthIndex, label, count: reviews.length, averageRating };
    });
  });

  chartMaxCount = computed(() => Math.max(1, ...this.monthlyReviewData().map(item => item.count)));

  busiestMonth = computed(() => {
    const entries = this.monthlyReviewData().filter(item => item.count > 0);
    if (!entries.length) return null;
    return [...entries].sort((a, b) => b.count - a.count || b.averageRating - a.averageRating)[0];
  });

  bestRatedMonth = computed(() => {
    const entries = this.monthlyReviewData().filter(item => item.count > 0);
    if (!entries.length) return null;
    return [...entries].sort((a, b) => b.averageRating - a.averageRating || b.count - a.count)[0];
  });

  worstRatedMonth = computed(() => {
    const entries = this.monthlyReviewData().filter(item => item.count > 0);
    if (!entries.length) return null;
    return [...entries].sort((a, b) => a.averageRating - b.averageRating || b.count - a.count)[0];
  });

  topRatedContent = computed(() => {
    const reviewedGroups = this.groupedContent().filter(group => group.reviewCount > 0);
    if (!reviewedGroups.length) return null;
    return [...reviewedGroups].sort((a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount)[0];
  });

  topRatedContentAverageText = computed(() => this.topRatedContent()?.averageRating.toFixed(1) ?? '0.0');

  mostReviewedContent = computed(() => {
    const reviewedGroups = this.groupedContent().filter(group => group.reviewCount > 0);
    if (!reviewedGroups.length) return null;
    return [...reviewedGroups].sort((a, b) => b.reviewCount - a.reviewCount || b.averageRating - a.averageRating)[0];
  });

  ratingDistribution = computed(() => {
    const total = this.totalReviews();
    return [5, 4, 3, 2, 1].map(rating => {
      const count = this.selectedAnalyticsReviews().filter(review => review.rating === rating).length;
      return {
        rating,
        count,
        percentage: total ? Math.round((count / total) * 100) : 0
      };
    });
  });

  bestRatedMonthAverageText = computed(() => this.bestRatedMonth()?.averageRating.toFixed(1) ?? '0.0');
  worstRatedMonthAverageText = computed(() => this.worstRatedMonth()?.averageRating.toFixed(1) ?? '0.0');

  constructor(
    private publisherReviewsService: PublisherReviewsService,
    private publisherContentService: PublisherContentService,
    private route: ActivatedRoute,
    private router: Router,
    private stateService: PublisherStateService
  ) {
    effect(() => {
      const persistentParams = this.buildPersistentReviewParams();
      const queryParams = this.buildReviewQueryParams(persistentParams);
      if (!this.paramsReady()) return;

      this.stateService.reviewsParams.set(persistentParams);
      this.router.navigate([], { queryParams, replaceUrl: true });
    });
  }

  ngOnInit(): void {
    this.pendingReviewFocus = this.getRequestedReviewFocus();
    this.returnToContentId.set(this.getReturnToContentId());

    const saved = this.stateService.reviewsParams();
    const params = Object.keys(saved).length ? saved : {
      search: this.route.snapshot.queryParamMap.get('search') ?? '',
      sortGroups: this.route.snapshot.queryParamMap.get('sortGroups') ?? 'reviews-desc',
      sortReviews: this.route.snapshot.queryParamMap.get('sortReviews') ?? 'date-desc',
      year: this.route.snapshot.queryParamMap.get('year') ?? ''
    };

    this.searchTerm.set(params['search'] ?? '');
    this.sortGroupsBy.set(params['sortGroups'] ?? 'reviews-desc');
    this.sortReviewsBy.set(params['sortReviews'] ?? 'date-desc');

    const year = Number(params['year']);
    if (!Number.isNaN(year) && year > 0) {
      this.selectedYear.set(year);
    }

    this.paramsReady.set(true);
    this.loadReviewsDashboard();
  }

  private loadReviewsDashboard(): void {
    this.loadReviewSummaries(true);
  }

  private loadReviewSummaries(resetSelection = false): void {
    this.isLoading.set(true);
    const focusedContentId = resetSelection ? this.pendingReviewFocus?.contentId ?? null : null;

    forkJoin({
      contentType: this.publisherContentService.getCurrentPublisherContentType().pipe(take(1)),
      summary: this.publisherReviewsService.getReviewSummaries(
        focusedContentId ? 1 : this.contentPage(),
        this.contentPageSize,
        {
          search: focusedContentId ? '' : this.searchTerm(),
          sort: this.sortGroupsBy(),
          contentId: focusedContentId
        }
      )
    }).subscribe({
      next: ({ contentType, summary }) => {
        this.publisherContentType.set(contentType);
        const groups = summary.items.map(item => ({
          contentId: item.contentId,
          contentTitle: item.contentTitle,
          contentType: item.contentType,
          status: item.status ?? undefined,
          destinationName: item.destinationName ?? null,
          reviews: [],
          averageRating: item.averageRating,
          reviewCount: item.reviewCount
        }));

        this.contentGroups.set(groups);
        this.contentTotalPages.set(focusedContentId ? 1 : Math.max(1, summary.totalPages));
        if (focusedContentId) {
          this.contentPage.set(1);
        }

        if (!groups.length) {
          this.selectedAnalyticsContentId.set(null);
          this.selectedReviewGroup.set(null);
          this.reviews.set([]);
          this.loadedReviewContentId.set(null);
          this.loadingReviewContentId = null;
          this.isReviewsLoading.set(false);
          this.isLoading.set(false);
          return;
        }

        const requestedId = resetSelection
          ? this.pendingReviewFocus?.contentId ?? this.selectedAnalyticsContentId()
          : this.selectedAnalyticsContentId();
        const selectedGroup = requestedId !== null
          ? groups.find(group => group.contentId === requestedId)
          : null;

        this.selectAnalyticsGroup(selectedGroup ?? groups[0]);
        this.applyRequestedReviewFocus();
        this.isLoading.set(false);
      },
      error: () => {
        this.reviews.set([]);
        this.contentGroups.set([]);
        this.contentTotalPages.set(1);
        this.selectedAnalyticsContentId.set(null);
        this.selectedReviewGroup.set(null);
        this.loadedReviewContentId.set(null);
        this.loadingReviewContentId = null;
        this.isReviewsLoading.set(false);
        this.isLoading.set(false);
      }
    });
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
    this.contentPage.set(1);
    this.loadReviewSummaries(true);
  }

  onSortGroupsChange(value: string): void {
    this.sortGroupsBy.set(value);
    this.contentPage.set(1);
    this.loadReviewSummaries(true);
  }

  onSortReviewsChange(value: string): void {
    this.sortReviewsBy.set(value);
    this.reviewPage.set(1);
  }

  onYearChange(value: number): void {
    this.selectedYear.set(value);
  }

  selectAnalyticsGroup(group: ContentGroup): void {
    this.selectedAnalyticsContentId.set(group.contentId);
    this.loadReviewsForGroup(group);
    this.ensureSelectedYearForAnalytics();
  }

  isAnalyticsGroupSelected(group: ContentGroup): boolean {
    return this.selectedAnalyticsGroup()?.contentId === group.contentId;
  }

  openReviews(group: ContentGroup): void {
    this.selectAnalyticsGroup(group);
    this.selectedReviewGroup.set(group);
    this.ratingFilter.set(0);
    this.reviewPage.set(1);
  }

  closeReviews(): void {
    this.selectedReviewGroup.set(null);
    this.ratingFilter.set(0);
    this.reviewPage.set(1);
  }

  setRatingFilter(rating: number): void {
    this.ratingFilter.set(this.ratingFilter() === rating ? 0 : rating);
    this.reviewPage.set(1);
  }

  goToContentPage(page: number): void {
    if (page < 1 || page > this.contentTotalPages()) return;
    this.contentPage.set(page);
    this.loadReviewSummaries(true);
  }

  goToReviewPage(page: number): void {
    if (page < 1 || page > this.reviewTotalPages()) return;
    this.reviewPage.set(page);
  }

  goBackToContentDetails(): void {
    const contentId = this.returnToContentId();
    if (!contentId) return;
    this.router.navigate(['/publisher-content-details', contentId]);
  }

  getStars(rating: number): { filled: number; empty: number } {
    const rounded = Math.round(rating);
    return { filled: rounded, empty: 5 - rounded };
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('sr-RS', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  monthBarHeight(entry: MonthReviewEntry): string {
    if (entry.count === 0) return '4px';
    const percent = Math.max(10, Math.round((entry.count / this.chartMaxCount()) * 100));
    return `${percent}%`;
  }

  contentTypeLabel(plural = false): string {
    const keyByType: Record<PublisherContentType, string> = {
      Object: plural ? 'publisher.reviews.contentTypes.objects' : 'publisher.reviews.contentTypes.object',
      Activity: plural ? 'publisher.reviews.contentTypes.activities' : 'publisher.reviews.contentTypes.activity',
      Event: plural ? 'publisher.reviews.contentTypes.events' : 'publisher.reviews.contentTypes.event'
    };

    return this.translation.translate(keyByType[this.publisherContentType()]);
  }

  ratingCount(rating: number): number {
    const group = this.selectedReviewGroup();
    if (!group || this.loadedReviewContentId() !== group.contentId) return 0;
    return this.reviews().filter(review => review.rating === rating).length;
  }

  private loadReviewsForGroup(group: ContentGroup): void {
    if (this.loadedReviewContentId() === group.contentId || this.loadingReviewContentId === group.contentId) return;

    this.isReviewsLoading.set(true);
    this.loadingReviewContentId = group.contentId;
    this.reviews.set([]);
    this.loadedReviewContentId.set(null);

    this.publisherReviewsService.getReviewsForContent(group.contentType, group.contentId).pipe(take(1)).subscribe({
      next: (reviews) => {
        if (this.loadingReviewContentId === group.contentId) {
          this.loadingReviewContentId = null;
        }

        if (this.selectedAnalyticsContentId() !== group.contentId && this.selectedReviewGroup()?.contentId !== group.contentId) {
          return;
        }

        this.reviews.set(reviews);
        this.loadedReviewContentId.set(group.contentId);
        this.ensureSelectedYearForAnalytics();
        this.isReviewsLoading.set(false);
      },
      error: () => {
        if (this.loadingReviewContentId === group.contentId) {
          this.loadingReviewContentId = null;
        }

        if (this.selectedAnalyticsContentId() !== group.contentId && this.selectedReviewGroup()?.contentId !== group.contentId) {
          return;
        }

        this.reviews.set([]);
        this.loadedReviewContentId.set(group.contentId);
        this.isReviewsLoading.set(false);
      }
    });
  }

  private ensureSelectedYearForAnalytics(): void {
    const years = this.availableYears();
    if (years.length && !years.includes(this.selectedYear())) {
      this.selectedYear.set(years[0]);
    }
  }

  private buildPersistentReviewParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (this.searchTerm()) params['search'] = this.searchTerm();
    if (this.sortGroupsBy() !== 'reviews-desc') params['sortGroups'] = this.sortGroupsBy();
    if (this.sortReviewsBy() !== 'date-desc') params['sortReviews'] = this.sortReviewsBy();
    if (this.selectedYear() !== new Date().getFullYear()) params['year'] = String(this.selectedYear());
    return params;
  }

  private buildReviewQueryParams(persistentParams: Record<string, string>): Record<string, string> {
    const params = { ...persistentParams };
    const focus = this.pendingReviewFocus ?? this.stateService.reviewsFocus();

    if (focus) {
      params['contentId'] = String(focus.contentId);
      if (focus.openReviews) params['openReviews'] = 'true';
    }

    const returnToContentId = this.returnToContentId();
    if (returnToContentId) {
      params['contentId'] = String(returnToContentId);
      params['returnToContent'] = 'true';
    }

    return params;
  }

  private getReturnToContentId(): number | null {
    if (this.route.snapshot.queryParamMap.get('returnToContent') !== 'true') return null;

    const contentId = Number(this.route.snapshot.queryParamMap.get('contentId'));
    return Number.isFinite(contentId) && contentId > 0 ? contentId : null;
  }

  private getRequestedReviewFocus(): ReviewFocusRequest | null {
    const stateFocus = this.stateService.reviewsFocus();
    if (stateFocus) return stateFocus;

    const routeContentId = Number(this.route.snapshot.queryParamMap.get('contentId'));
    if (!Number.isFinite(routeContentId) || routeContentId <= 0) return null;

    return {
      contentId: routeContentId,
      openReviews: this.route.snapshot.queryParamMap.get('openReviews') === 'true'
    };
  }

  private applyRequestedReviewFocus(): void {
    const focus = this.pendingReviewFocus;
    if (!focus) return;

    const group = this.groupedContent().find(item => item.contentId === focus.contentId);
    this.pendingReviewFocus = null;
    this.stateService.reviewsFocus.set(null);

    if (!group) return;

    this.selectAnalyticsGroup(group);

    let filteredGroups = this.filteredContentGroups();
    let filteredIndex = filteredGroups.findIndex(item => item.contentId === group.contentId);

    if (filteredIndex === -1 && this.searchTerm().trim()) {
      this.searchTerm.set('');
      filteredGroups = this.filteredContentGroups();
      filteredIndex = filteredGroups.findIndex(item => item.contentId === group.contentId);
    }

    if (filteredIndex >= 0) {
      this.contentPage.set(Math.floor(filteredIndex / this.contentPageSize) + 1);
    }

    if (focus.openReviews) {
      this.openReviews(group);
    }
  }
}
