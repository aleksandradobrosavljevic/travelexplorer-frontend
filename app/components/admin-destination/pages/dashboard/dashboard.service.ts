import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, map, Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import {
  AdminDestinationAnalytics,
  AdminDestinationAnalyticsTableRow,
  AdminDestinationPagedSection,
  AdminDestinationSummaryCard,
  AdminDestinationTopItem
} from '../../shared/admin-destination.models';

interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface SystemHealthResponse {
  verifiedPublishers: number;
  unverifiedPublishers: number;
  totalPublishers: number;
  verifiedPercentage: number;
}

interface AdminActivityResponse {
  actionBreakdown: { action: string; count: number }[];
  byDestination: {
    destinationId: number;
    destinationName: string;
    action: string;
    count: number;
  }[];
}

interface ContentStatusBreakdown {
  destinationId: number;
  destinationName: string;
  pendingObjects: number;
  approvedObjects: number;
  rejectedObjects: number;
  pendingActivities: number;
  approvedActivities: number;
  rejectedActivities: number;
  pendingEvents: number;
  approvedEvents: number;
  rejectedEvents: number;
}

interface MostSavedItem {
  name: string;
  type: string;
  saveCount: number;
}

interface ApprovalFunnel {
  pending: number;
  approved: number;
  rejected: number;
  avgApprovalHours: number;
}

interface DestinationReviewStats {
  destinationId: number;
  destinationName: string;
  country: string;
  reviewCount: number;
  avgRating: number;
}

interface PublisherStatsItem {
  publisherId: number;
  organizationName: string;
  totalContent: number;
  rejectedContent: number;
  pendingRequests: number;
}

@Injectable({ providedIn: 'root' })
export class AdminDestinationDashboardService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  private readonly TOP_N_LIMIT = 10;
  private readonly SINGLE_PAGE_SIZE = 1;
  private readonly YEARS_BACK = 6;
  private readonly APPROVAL_WARNING_HOURS = 48;
  private readonly GOOD_RATING_THRESHOLD = 4;

  getDashboardAnalytics(year?: number | null): Observable<AdminDestinationAnalytics> {
    const yearQuery = year ? `&year=${year}` : '';
    const directYearQuery = year ? `?year=${year}` : '';

    return forkJoin({
      systemHealth: this.safeGet<SystemHealthResponse>(
        `${this.apiUrl}/analytics/audit/system-health${directYearQuery}`,
        { verifiedPublishers: 0, unverifiedPublishers: 0, totalPublishers: 0, verifiedPercentage: 0 }
      ),
      adminActivity: this.safeGet<AdminActivityResponse>(
        `${this.apiUrl}/analytics/audit/admin-activity${directYearQuery}`,
        { actionBreakdown: [], byDestination: [] }
      ),
      statusBreakdown: this.safeGet<PagedResult<ContentStatusBreakdown>>(
        `${this.apiUrl}/analytics/content/status-breakdown?page=1&pageSize=${this.SINGLE_PAGE_SIZE}${yearQuery}`,
        this.emptyPagedResult<ContentStatusBreakdown>()
      ),
      mostSaved: this.safeGet<PagedResult<MostSavedItem>>(
        `${this.apiUrl}/analytics/content/most-saved?page=1&pageSize=${this.TOP_N_LIMIT}${yearQuery}`,
        this.emptyPagedResult<MostSavedItem>()
      ),
      approvalFunnel: this.safeGet<ApprovalFunnel>(
        `${this.apiUrl}/analytics/content/approval-funnel${directYearQuery}`,
        { pending: 0, approved: 0, rejected: 0, avgApprovalHours: 0 }
      ),
      destinationReviews: this.safeGet<PagedResult<DestinationReviewStats>>(
        `${this.apiUrl}/analytics/content/destination-reviews?page=1&pageSize=${this.SINGLE_PAGE_SIZE}${yearQuery}`,
        this.emptyPagedResult<DestinationReviewStats>()
      ),
      publisherStats: this.safeGet<PagedResult<PublisherStatsItem>>(
        `${this.apiUrl}/analytics/content/publisher-stats?page=1&pageSize=${this.TOP_N_LIMIT}${yearQuery}`,
        this.emptyPagedResult<PublisherStatsItem>()
      )
    }).pipe(
      map((response) => this.mapDashboardResponse(response, year ?? null))
    );
  }

  private mapPublisherStatsItem(item: PublisherStatsItem): AdminDestinationAnalyticsTableRow {
    return {
      label: item.organizationName,
      value: item.totalContent,
      hint: `${item.rejectedContent} rejected content / ${item.pendingRequests} pending requests`,
      tone: item.pendingRequests > 0 ? 'warning' : 'default'
    };
  }

  private safeGet<T>(url: string, _fallback: T): Observable<T> {
    return this.http.get<T>(url);
  }

  private emptyPagedResult<T>(): PagedResult<T> {
    return { items: [], totalCount: 0, page: 1, pageSize: 0, totalPages: 0 };
  }

  private buildAvailableYears(selectedYear: number | null): number[] {
    const currentYear = new Date().getFullYear();
    const years = new Set<number>();
    for (let y = currentYear; y >= currentYear - this.YEARS_BACK; y--) {
      years.add(y);
    }
    if (selectedYear) years.add(selectedYear);
    return Array.from(years).sort((a, b) => b - a);
  }

  private percent(value: number, total: number): string {
    if (!total) return '0';
    return ((value / total) * 100).toFixed(1);
  }

  private mapDashboardResponse(response: {
    systemHealth: SystemHealthResponse;
    adminActivity: AdminActivityResponse;
    statusBreakdown: PagedResult<ContentStatusBreakdown>;
    mostSaved: PagedResult<MostSavedItem>;
    approvalFunnel: ApprovalFunnel;
    destinationReviews: PagedResult<DestinationReviewStats>;
    publisherStats: PagedResult<PublisherStatsItem>;
  }, selectedYear: number | null): AdminDestinationAnalytics {
    const status = response.statusBreakdown.items[0];
    const reviews = response.destinationReviews.items[0];
    const destinationAction = response.adminActivity.byDestination[0];

    const destinationName =
      status?.destinationName ??
      reviews?.destinationName ??
      destinationAction?.destinationName ??
      'Current destination';

    const pendingObjects = status?.pendingObjects ?? 0;
    const approvedObjects = status?.approvedObjects ?? 0;
    const rejectedObjects = status?.rejectedObjects ?? 0;
    const pendingActivities = status?.pendingActivities ?? 0;
    const approvedActivities = status?.approvedActivities ?? 0;
    const rejectedActivities = status?.rejectedActivities ?? 0;
    const pendingEvents = status?.pendingEvents ?? 0;
    const approvedEvents = status?.approvedEvents ?? 0;
    const rejectedEvents = status?.rejectedEvents ?? 0;

    const pendingContent = pendingObjects + pendingActivities + pendingEvents;
    const approvedContent = approvedObjects + approvedActivities + approvedEvents;
    const rejectedContent = rejectedObjects + rejectedActivities + rejectedEvents;
    const totalContent = pendingContent + approvedContent + rejectedContent;

    const availableYears = this.buildAvailableYears(selectedYear);

    const hasDataForSelectedYear = !selectedYear || [
      totalContent,
      response.approvalFunnel.pending,
      response.approvalFunnel.approved,
      response.approvalFunnel.rejected,
      reviews?.reviewCount ?? 0,
      response.mostSaved.items.length,
      response.publisherStats.items.length,
      response.adminActivity.byDestination.length
    ].some((value) => Number(value) > 0);

    if (selectedYear && !hasDataForSelectedYear) {
      return this.buildEmptyYearAnalytics(destinationName, selectedYear, availableYears);
    }

    const avgRating = reviews?.avgRating ?? 0;
    const avgApprovalHours = response.approvalFunnel.avgApprovalHours;
    const totalPendingWork = pendingContent + response.approvalFunnel.pending;

    const summaryCards: AdminDestinationSummaryCard[] = [
      {
        label: 'Pending work',
        value: totalPendingWork.toString(),
        hint: 'Pending content plus publisher requests',
        tone: totalPendingWork > 0 ? 'warning' : 'good'
      },
      {
        label: 'Approved content',
        value: approvedContent.toString(),
        hint: `${this.percent(approvedContent, totalContent)}% of moderated content`,
        tone: 'good'
      },
      {
        label: 'Reviews',
        value: (reviews?.reviewCount ?? 0).toString(),
        hint: `Average rating: ${avgRating.toFixed(1)}`,
        tone: avgRating >= this.GOOD_RATING_THRESHOLD ? 'good' : 'default'
      },
      {
        label: 'Publishers',
        value: response.systemHealth.totalPublishers.toString(),
        hint: `${response.systemHealth.verifiedPublishers} verified / ${response.systemHealth.unverifiedPublishers} unverified`,
        tone: response.systemHealth.unverifiedPublishers > 0 ? 'warning' : 'good'
      },
      {
        label: 'Saved items',
        value: response.mostSaved.items.reduce((sum, item) => sum + item.saveCount, 0).toString(),
        hint: 'Total saves in top listed items',
        tone: 'default'
      },
      {
        label: 'Approval time',
        value: `${avgApprovalHours.toFixed(1)}h`,
        hint: 'Average request approval time',
        tone: avgApprovalHours > this.APPROVAL_WARNING_HOURS ? 'warning' : 'default'
      }
    ];

    const contentStatusRows: AdminDestinationAnalyticsTableRow[] = [
      { label: 'Pending', value: pendingContent, hint: 'Objects + activities + events', tone: pendingContent > 0 ? 'warning' : 'good' },
      { label: 'Approved', value: approvedContent, hint: 'Objects + activities + events', tone: 'good' },
      { label: 'Rejected', value: rejectedContent, hint: 'Objects + activities + events', tone: rejectedContent > 0 ? 'danger' : 'default' },
      { label: 'Total', value: totalContent, hint: 'All moderated content', tone: 'default' }
    ];

    const contentTypeRows: AdminDestinationAnalyticsTableRow[] = [
      { label: 'Objects', value: pendingObjects + approvedObjects + rejectedObjects, hint: `${pendingObjects} pending / ${approvedObjects} approved / ${rejectedObjects} rejected` },
      { label: 'Activities', value: pendingActivities + approvedActivities + rejectedActivities, hint: `${pendingActivities} pending / ${approvedActivities} approved / ${rejectedActivities} rejected` },
      { label: 'Events', value: pendingEvents + approvedEvents + rejectedEvents, hint: `${pendingEvents} pending / ${approvedEvents} approved / ${rejectedEvents} rejected` }
    ];

    const approvalRows: AdminDestinationAnalyticsTableRow[] = [
      { label: 'Pending requests', value: response.approvalFunnel.pending, tone: response.approvalFunnel.pending > 0 ? 'warning' : 'good' },
      { label: 'Approved requests', value: response.approvalFunnel.approved, tone: 'good' },
      { label: 'Rejected requests', value: response.approvalFunnel.rejected, tone: response.approvalFunnel.rejected > 0 ? 'danger' : 'default' },
      { label: 'Average approval hours', value: avgApprovalHours.toFixed(1), tone: avgApprovalHours > this.APPROVAL_WARNING_HOURS ? 'warning' : 'default' }
    ];

    const reviewRows: AdminDestinationAnalyticsTableRow[] = [
      { label: 'Review count', value: reviews?.reviewCount ?? 0 },
      { label: 'Average rating', value: avgRating.toFixed(2), tone: avgRating >= this.GOOD_RATING_THRESHOLD ? 'good' : 'default' }
    ];

    const publisherRows: AdminDestinationPagedSection<AdminDestinationAnalyticsTableRow> = {
      items: response.publisherStats.items.length
        ? response.publisherStats.items.map((item) => this.mapPublisherStatsItem(item))
        : [{ label: 'No publisher stats', value: 0, hint: 'No publisher data found for this filter' }],
      totalCount: response.publisherStats.totalCount,
      totalPages: response.publisherStats.totalPages,
      page: response.publisherStats.page
    };

    const adminActionRows: AdminDestinationAnalyticsTableRow[] = response.adminActivity.byDestination.length
      ? response.adminActivity.byDestination.map((item) => ({
          label: item.action,
          value: item.count,
          hint: item.destinationName
        }))
      : [{ label: 'No admin actions', value: 0, hint: 'No admin action data found for this filter' }];

    const topSavedItems: AdminDestinationPagedSection<AdminDestinationTopItem> = {
      items: response.mostSaved.items.map((item) => ({
        label: item.name,
        type: item.type,
        value: item.saveCount
      })),
      totalCount: response.mostSaved.totalCount,
      totalPages: response.mostSaved.totalPages,
      page: response.mostSaved.page
    };

    const notes = [
      selectedYear
        ? `Showing analytics for ${selectedYear}. Empty tables mean backend found no records for that year.`
        : 'Showing all-time analytics where the backend endpoint is not year-specific.'
    ];

    return {
      destinationName,
      selectedYear,
      availableYears,
      hasDataForSelectedYear,
      summaryCards,
      contentStatusRows,
      contentTypeRows,
      approvalRows,
      reviewRows,
      publisherRows,
      adminActionRows,
      topSavedItems,
      notes
    };
  }

  private buildEmptyYearAnalytics(
    destinationName: string,
    selectedYear: number,
    availableYears: number[]
  ): AdminDestinationAnalytics {
    const zeroCard = (label: string, hint: string, value = '0'): AdminDestinationSummaryCard => ({
      label, value, hint, tone: 'default'
    });

    return {
      destinationName,
      selectedYear,
      availableYears,
      hasDataForSelectedYear: false,
      summaryCards: [
        zeroCard('Pending work', 'No pending content or publisher requests found'),
        zeroCard('Approved content', '0% of moderated content'),
        zeroCard('Reviews', 'Average rating: 0.0'),
        zeroCard('Publishers', '0 verified / 0 unverified'),
        zeroCard('Saved items', 'Total saves in top listed items'),
        zeroCard('Approval time', 'Average request approval time', '0.0h')
      ],
      contentStatusRows: [
        { label: 'Pending', value: 0, hint: 'Objects + activities + events' },
        { label: 'Approved', value: 0, hint: 'Objects + activities + events' },
        { label: 'Rejected', value: 0, hint: 'Objects + activities + events' },
        { label: 'Total', value: 0, hint: 'All moderated content' }
      ],
      contentTypeRows: [
        { label: 'Objects', value: 0, hint: '0 pending / 0 approved / 0 rejected' },
        { label: 'Activities', value: 0, hint: '0 pending / 0 approved / 0 rejected' },
        { label: 'Events', value: 0, hint: '0 pending / 0 approved / 0 rejected' }
      ],
      approvalRows: [
        { label: 'Pending requests', value: 0 },
        { label: 'Approved requests', value: 0 },
        { label: 'Rejected requests', value: 0 },
        { label: 'Average approval hours', value: '0.0' }
      ],
      reviewRows: [
        { label: 'Review count', value: 0 },
        { label: 'Average rating', value: '0.00' }
      ],
      publisherRows: {
        items: [{ label: 'No publisher stats', value: 0, hint: 'No publisher data found for this filter' }],
        totalCount: 0, totalPages: 0, page: 1
      },
      adminActionRows: [{ label: 'No admin actions', value: 0, hint: 'No admin action data found for this filter' }],
      topSavedItems: { items: [], totalCount: 0, totalPages: 0, page: 1 },
      notes: [`No analytics were found for ${selectedYear}.`]
    };
  }
}
