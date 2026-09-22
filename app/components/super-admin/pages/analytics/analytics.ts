import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Select } from 'primeng/select';
import { Paginator, PaginatorState } from 'primeng/paginator';
import { buildApiUrl } from '../../../../core/config/api';

interface TopDestinationItem {
  name: string;
  visits: number;
  growth: string;
}

interface ContentDistributionItem {
  type: 'Object' | 'Event' | 'Activity';
  count: number;
}

interface RoleDistributionItem {
  roleName: string;
  count: number;
  percentage: number;
}

interface ActiveBlockedData {
  activeCount: number;
  blockedCount: number;
  total: number;
  activePercentage: number;
  blockedPercentage: number;
}

interface RetentionData {
  activeLast30Days: number;
  totalUsers: number;
  retentionPercentage: number;
}

interface MostSavedItem {
  name: string;
  type: string;
  saveCount: number;
}

interface ApprovalFunnelData {
  pending: number;
  approved: number;
  rejected: number;
  avgApprovalHours: number;
}

interface SystemHealthData {
  verifiedPublishers: number;
  unverifiedPublishers: number;
  totalPublishers: number;
  verifiedPercentage: number;
}

interface PublisherStatItem {
  publisherId: number;
  organizationName: string;
  totalContent: number;
  rejectedContent: number;
  pendingRequests: number;
}

interface DestinationBreakdownItem {
  destinationId: number;
  destinationName: string;
  approved: number;
  pending: number;
  rejected: number;
  total: number;
}

interface MonthlyEntry {
  month: string;
  value: number;
}

interface MonthlyCompareEntry {
  month: string;
  monthIndex: number;
  primary: number;
  compare: number;
}

interface SelectOption {
  label: string;
  value: any;
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, Select, Paginator],
  templateUrl: './analytics.html',
  styleUrl: './analytics.css'
})
export class AnalyticsComponent implements OnInit {

  // ── Filters ───────────────────────────────────────────────────────
  // Default range; UI dropdown removed until backend honors from/to (logic preserved).
  selectedDateRange = 30;
  topDestinationsFilter = signal(5);
  topSavedFilter = signal(5);

  dateRangeOptions: SelectOption[] = [
    { label: 'Last 7 days', value: 7 },
    { label: 'Last 30 days', value: 30 },
    { label: 'Last 3 months', value: 90 },
    { label: 'Last year', value: 365 },
  ];

  topNOptions: SelectOption[] = [
    { label: 'Top 3', value: 3 },
    { label: 'Top 5', value: 5 },
    { label: 'Top 10', value: 10 }
  ];

  // ── Destination Breakdown filters ─────────────────────────────────
  breakdownContentType = signal<'Objects' | 'Activities' | 'Events'>('Objects');
  breakdownYear = signal<number | null>(null);
  breakdownPage = signal(1);
  breakdownPageSize = signal(10);
  breakdownTotal = signal(0);

  breakdownContentTypeOptions: SelectOption[] = [
    { label: 'Objects', value: 'Objects' },
    { label: 'Activities', value: 'Activities' },
    { label: 'Events', value: 'Events' }
  ];

  breakdownYearOptions: SelectOption[] = [
    { label: 'All years', value: null },
    ...Array.from({ length: 5 }, (_, i) => {
      const y = new Date().getFullYear() - i;
      return { label: String(y), value: y };
    })
  ];

  // ── Publisher Stats pagination ────────────────────────────────────
  publisherPage = signal(1);
  publisherPageSize = signal(5);
  publisherTotal = signal(0);

  // ── Monthly Growth comparison ─────────────────────────────────────
  currentYear = new Date().getFullYear();
  compareYear = signal<number | null>(null);
  monthlyVisits = signal<MonthlyEntry[]>([]);
  monthlyCompare = signal<MonthlyEntry[]>([]);
  isLoadingCompare = signal(false);

  compareYearOptions: SelectOption[] = [
    { label: 'No comparison', value: null },
    ...Array.from({ length: 4 }, (_, i) => {
      const y = new Date().getFullYear() - 1 - i;
      return { label: String(y), value: y };
    })
  ];

  monthlyChartData = computed<MonthlyCompareEntry[]>(() => {
    const primary = this.monthlyVisits();
    const compare = this.monthlyCompare();
    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const primaryMap = new Map(primary.map(e => [e.month, e.value]));
    const compareMap = new Map(compare.map(e => [e.month, e.value]));

    if (this.compareYear() !== null) {
      return monthLabels.map((m, i) => ({
        month: m,
        monthIndex: i + 1,
        primary: primaryMap.get(m) ?? 0,
        compare: compareMap.get(m) ?? 0
      }));
    }

    return primary.map(e => ({
      month: e.month,
      monthIndex: 0,
      primary: e.value,
      compare: 0
    }));
  });

  maxMonthlyValue = computed(() => {
    const data = this.monthlyChartData();
    return Math.max(...data.map(e => Math.max(e.primary, e.compare)), 1);
  });

  // ── Signals ───────────────────────────────────────────────────────
  topDestinations = signal<TopDestinationItem[]>([]);
  contentDistribution = signal<ContentDistributionItem[]>([
    { type: 'Object', count: 0 },
    { type: 'Event', count: 0 },
    { type: 'Activity', count: 0 }
  ]);
  roleDistribution = signal<RoleDistributionItem[]>([]);
  activeBlocked = signal<ActiveBlockedData>({
    activeCount: 0, blockedCount: 0, total: 0,
    activePercentage: 0, blockedPercentage: 0
  });
  retention = signal<RetentionData>({
    activeLast30Days: 0, totalUsers: 0, retentionPercentage: 0
  });
  mostSavedItems = signal<MostSavedItem[]>([]);
  approvalFunnel = signal<ApprovalFunnelData>({
    pending: 0, approved: 0, rejected: 0, avgApprovalHours: 0
  });
  systemHealth = signal<SystemHealthData>({
    verifiedPublishers: 0, unverifiedPublishers: 0,
    totalPublishers: 0, verifiedPercentage: 0
  });
  publisherStats = signal<PublisherStatItem[]>([]);
  destinationBreakdown = signal<DestinationBreakdownItem[]>([]);

  // ── Publisher sort ────────────────────────────────────────────────
  publisherSortBy = 'totalContent';
  publisherSortDir = 'desc';

  // ── Loading states ────────────────────────────────────────────────
  isLoadingDestinations = signal(true);
  isLoadingContent = signal(true);
  isLoadingMonthly = signal(true);
  isLoadingRoles = signal(true);
  isLoadingActiveBlocked = signal(true);
  isLoadingRetention = signal(true);
  isLoadingMostSaved = signal(true);
  isLoadingFunnel = signal(true);
  isLoadingHealth = signal(true);
  isLoadingPublishers = signal(true);
  isLoadingBreakdown = signal(true);

  // ── Computed ──────────────────────────────────────────────────────
  filteredTopDestinations = computed(() =>
    this.topDestinations().slice(0, this.topDestinationsFilter())
  );

  filteredMostSaved = computed(() =>
    this.mostSavedItems().slice(0, this.topSavedFilter())
  );

  maxVisits = computed(() =>
    Math.max(...this.topDestinations().map(i => i.visits), 1)
  );

  totalPublishedContent = computed(() =>
    this.contentDistribution().reduce((sum, i) => sum + i.count, 0)
  );

  maxRoleCount = computed(() =>
    Math.max(...this.roleDistribution().map(r => r.count), 1)
  );

  maxSaveCount = computed(() =>
    Math.max(...this.mostSavedItems().map(i => i.saveCount), 1)
  );

  approvalTotal = computed(() => {
    const f = this.approvalFunnel();
    return f.pending + f.approved + f.rejected;
  });

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.loadAll();
  }

  // ── Filter handlers ───────────────────────────────────────────────
  onDateRangeChange(): void {
    this.loadAll();
  }

  onBreakdownFilterChange(): void {
    this.breakdownPage.set(1);
    this.loadDestinationBreakdown();
  }

  onBreakdownPageChange(event: PaginatorState): void {
    this.breakdownPage.set((event.page ?? 0) + 1);
    this.breakdownPageSize.set(event.rows ?? 10);
    this.loadDestinationBreakdown();
  }

  onPublisherPageChange(event: PaginatorState): void {
    this.publisherPage.set((event.page ?? 0) + 1);
    this.publisherPageSize.set(event.rows ?? 5);
    this.loadPublisherStats();
  }

  onCompareYearChange(year: number | null): void {
    this.compareYear.set(year);
    if (year !== null) {
      this.loadCompareYear(year);
    } else {
      this.monthlyCompare.set([]);
    }
  }

  // ── Sort ──────────────────────────────────────────────────────────
  sortPublishers(column: string): void {
    if (this.publisherSortBy === column) {
      this.publisherSortDir = this.publisherSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.publisherSortBy = column;
      this.publisherSortDir = 'desc';
    }
    this.publisherPage.set(1);
    this.loadPublisherStats();
  }

  getSortIcon(column: string): string {
    if (this.publisherSortBy !== column) return '↕';
    return this.publisherSortDir === 'asc' ? '↑' : '↓';
  }

  private loadAll(): void {
    this.loadTopDestinations();
    this.loadContentDistribution();
    this.loadMonthlyVisits();
    this.loadRoleDistribution();
    this.loadActiveBlocked();
    this.loadRetention();
    this.loadMostSaved();
    this.loadApprovalFunnel();
    this.loadSystemHealth();
    this.loadPublisherStats();
    this.loadDestinationBreakdown();
  }

  private getDateParams(): string {
    if (this.selectedDateRange === 0) return '';
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - this.selectedDateRange);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    return `&from=${fmt(from)}&to=${fmt(to)}`;
  }

  getApprovalPercent(value: number): number {
    const total = this.approvalTotal();
    return total === 0 ? 0 : Math.round((value / total) * 100);
  }

  getBarWidth(visits: number): number {
    return (visits / this.maxVisits()) * 100;
  }

  getMonthlyBarHeight(value: number): number {
    return (value / this.maxMonthlyValue()) * 100;
  }

  getTypeColor(type: string): string {
    const colors: Record<string, string> = {
      'Object': '#2563eb',
      'Activity': '#239485',
      'Event': '#f59e0b',
    };
    return colors[type] ?? '#6b7280';
  }

  getSavedTypeColor(type: string): string {
    return this.getTypeColor(type);
  }

  getBreakdownBarWidth(value: number, total: number): number {
    return total === 0 ? 0 : Math.round((value / total) * 100);
  }

  // ── Loaders ───────────────────────────────────────────────────────
  private loadTopDestinations(): void {
    this.isLoadingDestinations.set(true);
    const params = this.getDateParams();
    this.http.get<any>(buildApiUrl(`analytics/content/destination-reviews?page=1&pageSize=10${params}`)).subscribe({
      next: (response) => {
        const items = response?.items ?? response?.Items ?? [];
        this.topDestinations.set(items.map((item: any) => ({
          name: item.destinationName ?? item.DestinationName,
          visits: item.reviewCount ?? item.ReviewCount ?? 0,
          growth: `${Number(item.avgRating ?? item.AvgRating ?? 0).toFixed(1)} avg`
        })));
        this.isLoadingDestinations.set(false);
      },
      error: () => {
        this.topDestinations.set([]);
        this.isLoadingDestinations.set(false);
      }
    });
  }

  private loadContentDistribution(): void {
    this.isLoadingContent.set(true);
    const params = this.getDateParams();
    this.http.get<any>(buildApiUrl(`analytics/content/status-breakdown?page=1&pageSize=50${params}`)).subscribe({
      next: (response) => {
        const items = response?.items ?? response?.Items ?? [];
        const totals = items.reduce((acc: { object: number; event: number; activity: number }, item: any) => {
          acc.object += (item.pendingObjects ?? item.PendingObjects ?? 0)
                      + (item.approvedObjects ?? item.ApprovedObjects ?? 0)
                      + (item.rejectedObjects ?? item.RejectedObjects ?? 0);
          acc.event  += (item.pendingEvents ?? item.PendingEvents ?? 0)
                      + (item.approvedEvents ?? item.ApprovedEvents ?? 0)
                      + (item.rejectedEvents ?? item.RejectedEvents ?? 0);
          acc.activity += (item.pendingActivities ?? item.PendingActivities ?? 0)
                        + (item.approvedActivities ?? item.ApprovedActivities ?? 0)
                        + (item.rejectedActivities ?? item.RejectedActivities ?? 0);
          return acc;
        }, { object: 0, event: 0, activity: 0 });

        this.contentDistribution.set([
          { type: 'Object', count: totals.object },
          { type: 'Event', count: totals.event },
          { type: 'Activity', count: totals.activity }
        ]);
        this.isLoadingContent.set(false);
      },
      error: () => {
        this.contentDistribution.set([
          { type: 'Object', count: 0 },
          { type: 'Event', count: 0 },
          { type: 'Activity', count: 0 }
        ]);
        this.isLoadingContent.set(false);
      }
    });
  }

  private loadMonthlyVisits(): void {
    this.isLoadingMonthly.set(true);
    this.http.get<any>(buildApiUrl(`analytics/users/growth?groupBy=month`)).subscribe({
      next: (response) => {
        const data = response?.data ?? response?.Data ?? [];
        this.monthlyVisits.set(data.map((item: any) => ({
          month: this.getMonthLabel(item.month ?? item.Month),
          value: item.count ?? item.Count ?? 0
        })));
        this.isLoadingMonthly.set(false);
      },
      error: () => {
        this.monthlyVisits.set([]);
        this.isLoadingMonthly.set(false);
      }
    });
  }

  private loadCompareYear(year: number): void {
    this.isLoadingCompare.set(true);
    this.http.get<any>(buildApiUrl(`analytics/users/growth?groupBy=month&year=${year}`)).subscribe({
      next: (response) => {
        const data = response?.data ?? response?.Data ?? [];
        this.monthlyCompare.set(data.map((item: any) => ({
          month: this.getMonthLabel(item.month ?? item.Month),
          value: item.count ?? item.Count ?? 0
        })));
        this.isLoadingCompare.set(false);
      },
      error: () => {
        this.monthlyCompare.set([]);
        this.isLoadingCompare.set(false);
      }
    });
  }

  private loadDestinationBreakdown(): void {
    this.isLoadingBreakdown.set(true);
    const type = this.breakdownContentType();
    const year = this.breakdownYear();
    const page = this.breakdownPage();
    const pageSize = this.breakdownPageSize();

    let params = `page=${page}&pageSize=${pageSize}`;
    if (year) params += `&year=${year}`;

    this.http.get<any>(buildApiUrl(`analytics/content/status-breakdown?${params}`)).subscribe({
      next: (response) => {
        const items = response?.items ?? response?.Items ?? [];
        const totalCount = response?.totalCount ?? response?.TotalCount ?? 0;
        this.breakdownTotal.set(totalCount);

        const mapped: DestinationBreakdownItem[] = items.map((item: any) => {
          let approved = 0, pending = 0, rejected = 0;

          if (type === 'Objects') {
            approved = item.approvedObjects ?? item.ApprovedObjects ?? 0;
            pending  = item.pendingObjects  ?? item.PendingObjects  ?? 0;
            rejected = item.rejectedObjects ?? item.RejectedObjects ?? 0;
          } else if (type === 'Activities') {
            approved = item.approvedActivities ?? item.ApprovedActivities ?? 0;
            pending  = item.pendingActivities  ?? item.PendingActivities  ?? 0;
            rejected = item.rejectedActivities ?? item.RejectedActivities ?? 0;
          } else {
            approved = item.approvedEvents ?? item.ApprovedEvents ?? 0;
            pending  = item.pendingEvents  ?? item.PendingEvents  ?? 0;
            rejected = item.rejectedEvents ?? item.RejectedEvents ?? 0;
          }

          return {
            destinationId: item.destinationId ?? item.DestinationId,
            destinationName: item.destinationName ?? item.DestinationName ?? '—',
            approved, pending, rejected,
            total: approved + pending + rejected
          };
        });

        mapped.sort((a, b) => b.total - a.total);
        this.destinationBreakdown.set(mapped);
        this.isLoadingBreakdown.set(false);
      },
      error: () => {
        this.destinationBreakdown.set([]);
        this.isLoadingBreakdown.set(false);
      }
    });
  }

  private loadRoleDistribution(): void {
    this.isLoadingRoles.set(true);
    const params = this.getDateParams();
    this.http.get<any[]>(buildApiUrl(`analytics/users/roles${params ? '?' + params.slice(1) : ''}`)).subscribe({
      next: (response) => {
        const items = Array.isArray(response) ? response : [];
        this.roleDistribution.set(
          items
            .filter((item: any) => {
              const name = item.roleName ?? item.RoleName ?? '';
              return name === 'Publisher' || name === 'Tourist';
            })
            .map((item: any) => ({
              roleName: item.roleName ?? item.RoleName ?? '',
              count: item.count ?? item.Count ?? 0,
              percentage: item.percentage ?? item.Percentage ?? 0
            }))
        );
        this.isLoadingRoles.set(false);
      },
      error: () => {
        this.roleDistribution.set([]);
        this.isLoadingRoles.set(false);
      }
    });
  }

  private loadActiveBlocked(): void {
    this.isLoadingActiveBlocked.set(true);
    const params = this.getDateParams();
    this.http.get<any>(buildApiUrl(`analytics/users/active-blocked${params ? '?' + params.slice(1) : ''}`)).subscribe({
      next: (response) => {
        this.activeBlocked.set({
          activeCount: response?.activeCount ?? response?.ActiveCount ?? 0,
          blockedCount: response?.blockedCount ?? response?.BlockedCount ?? 0,
          total: response?.total ?? response?.Total ?? 0,
          activePercentage: response?.activePercentage ?? response?.ActivePercentage ?? 0,
          blockedPercentage: response?.blockedPercentage ?? response?.BlockedPercentage ?? 0
        });
        this.isLoadingActiveBlocked.set(false);
      },
      error: () => { this.isLoadingActiveBlocked.set(false); }
    });
  }

  private loadRetention(): void {
    this.isLoadingRetention.set(true);
    const params = this.getDateParams();
    this.http.get<any>(buildApiUrl(`analytics/users/retention${params ? '?' + params.slice(1) : ''}`)).subscribe({
      next: (response) => {
        this.retention.set({
          activeLast30Days: response?.activeLast30Days ?? response?.ActiveLast30Days ?? 0,
          totalUsers: response?.totalUsers ?? response?.TotalUsers ?? 0,
          retentionPercentage: response?.retentionPercentage ?? response?.RetentionPercentage ?? 0
        });
        this.isLoadingRetention.set(false);
      },
      error: () => { this.isLoadingRetention.set(false); }
    });
  }

  private loadMostSaved(): void {
    this.isLoadingMostSaved.set(true);
    const params = this.getDateParams();
    this.http.get<any>(buildApiUrl(`analytics/content/most-saved?page=1&pageSize=10${params}`)).subscribe({
      next: (response) => {
        const items = response?.items ?? response?.Items ?? (Array.isArray(response) ? response : []);
        this.mostSavedItems.set(items.map((item: any) => ({
          name: item.name ?? item.Name ?? '',
          type: item.type ?? item.Type ?? '',
          saveCount: item.saveCount ?? item.SaveCount ?? 0
        })));
        this.isLoadingMostSaved.set(false);
      },
      error: () => {
        this.mostSavedItems.set([]);
        this.isLoadingMostSaved.set(false);
      }
    });
  }

  private loadApprovalFunnel(): void {
    this.isLoadingFunnel.set(true);
    const params = this.getDateParams();
    this.http.get<any>(buildApiUrl(`analytics/content/approval-funnel${params ? '?' + params.slice(1) : ''}`)).subscribe({
      next: (response) => {
        this.approvalFunnel.set({
          pending: response?.pending ?? response?.Pending ?? 0,
          approved: response?.approved ?? response?.Approved ?? 0,
          rejected: response?.rejected ?? response?.Rejected ?? 0,
          avgApprovalHours: response?.avgApprovalHours ?? response?.AvgApprovalHours ?? 0
        });
        this.isLoadingFunnel.set(false);
      },
      error: () => { this.isLoadingFunnel.set(false); }
    });
  }

  private loadSystemHealth(): void {
    this.isLoadingHealth.set(true);
    this.http.get<any>(buildApiUrl('analytics/audit/system-health')).subscribe({
      next: (response) => {
        this.systemHealth.set({
          verifiedPublishers: response?.verifiedPublishers ?? response?.VerifiedPublishers ?? 0,
          unverifiedPublishers: response?.unverifiedPublishers ?? response?.UnverifiedPublishers ?? 0,
          totalPublishers: response?.totalPublishers ?? response?.TotalPublishers ?? 0,
          verifiedPercentage: response?.verifiedPercentage ?? response?.VerifiedPercentage ?? 0
        });
        this.isLoadingHealth.set(false);
      },
      error: () => { this.isLoadingHealth.set(false); }
    });
  }

  private loadPublisherStats(): void {
    this.isLoadingPublishers.set(true);
    const page = this.publisherPage();
    const pageSize = this.publisherPageSize();
    const params = this.getDateParams();
    this.http.get<any>(buildApiUrl(
      `analytics/content/publisher-stats?page=${page}&pageSize=${pageSize}&sortBy=${this.publisherSortBy}&sortDir=${this.publisherSortDir}${params}`
    )).subscribe({
      next: (response) => {
        const items = response?.items ?? response?.Items ?? [];
        const totalCount = response?.totalCount ?? response?.TotalCount ?? 0;
        this.publisherTotal.set(totalCount);
        this.publisherStats.set(items.map((item: any) => ({
          publisherId: item.publisherId ?? item.PublisherId ?? 0,
          organizationName: item.organizationName ?? item.OrganizationName ?? '',
          totalContent: item.totalContent ?? item.TotalContent ?? 0,
          rejectedContent: item.rejectedContent ?? item.RejectedContent ?? 0,
          pendingRequests: item.pendingRequests ?? item.PendingRequests ?? 0
        })));
        this.isLoadingPublishers.set(false);
      },
      error: () => {
        this.publisherStats.set([]);
        this.isLoadingPublishers.set(false);
      }
    });
  }

  private getMonthLabel(month: number): string {
    const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return labels[(month ?? 1) - 1] ?? 'N/A';
  }

  getSaveBarWidth(count: number): number {
    return (count / this.maxSaveCount()) * 100;
  }
}