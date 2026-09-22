import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal, HostListener } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { AdminDestinationAnalytics } from '../../shared/admin-destination.models';
import { AdminDestinationDashboardService } from './dashboard.service';

@Component({
  selector: 'app-admin-destination-dashboard',
  standalone: true,
  imports: [NgIf, NgFor, NgClass],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class AdminDestinationDashboardComponent {

  private readonly route = inject(ActivatedRoute);
  private readonly dashboardService = inject(AdminDestinationDashboardService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly resolvedAnalytics = this.route.snapshot.data['analytics'] ?? null;

  private readonly analyticsSignal = signal<AdminDestinationAnalytics | null>(this.resolvedAnalytics);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly selectedYear = signal<string>(
    this.resolvedAnalytics?.selectedYear ? this.resolvedAnalytics.selectedYear.toString() : 'all'
  );

  readonly isDropdownOpen = signal(false);
  readonly isTopSavedDropdownOpen = signal(false);
  readonly isPublisherDropdownOpen = signal(false);

  readonly topNOptions = [3, 5, 10];
  readonly topSavedFilter = signal(5);
  readonly publisherFilter = signal(5);

  readonly filteredTopSaved = computed(() =>
    this.analyticsSignal()?.topSavedItems.items.slice(0, this.topSavedFilter()) ?? []
  );

  readonly filteredPublisherRows = computed(() =>
    this.analyticsSignal()?.publisherRows.items.slice(0, this.publisherFilter()) ?? []
  );

  readonly topSavedMax = computed(() => {
    const values = this.analyticsSignal()?.topSavedItems.items.map((item) => item.value) ?? [];
    return Math.max(...values, 1);
  });

  readonly selectedYearLabel = computed(() => {
    const y = this.selectedYear();
    return y === 'all' ? 'All years' : y;
  });

  get analytics(): AdminDestinationAnalytics | null {
    return this.analyticsSignal();
  }

  get availableYears(): number[] {
    return this.analytics?.availableYears ?? [new Date().getFullYear()];
  }

  toggleDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.isDropdownOpen.update(v => !v);
  }

  selectYear(value: string, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedYear.set(value);
    this.isDropdownOpen.set(false);
    this.loadDashboard(value === 'all' ? null : Number(value));
  }

  closeDropdown(): void {
    this.isDropdownOpen.set(false);
  }

  toggleTopSavedDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.isTopSavedDropdownOpen.update(v => !v);
  }

  selectTopSaved(value: number, event: MouseEvent): void {
    event.stopPropagation();
    this.topSavedFilter.set(value);
    this.isTopSavedDropdownOpen.set(false);
  }

  togglePublisherDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.isPublisherDropdownOpen.update(v => !v);
  }

  selectPublisher(value: number, event: MouseEvent): void {
    event.stopPropagation();
    this.publisherFilter.set(value);
    this.isPublisherDropdownOpen.set(false);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.isDropdownOpen.set(false);
    this.isTopSavedDropdownOpen.set(false);
    this.isPublisherDropdownOpen.set(false);
  }

  loadDashboard(year: number | null): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.dashboardService.getDashboardAnalytics(year)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (analytics) => {
          this.analyticsSignal.set(analytics);
          this.isLoading.set(false);
        },
        error: () => {
          this.errorMessage.set('Dashboard analytics could not be loaded.');
          this.isLoading.set(false);
        }
      });
  }

  relativeWidth(value: number | string, max: number): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0 || max <= 0) return 0;
    return Math.max(4, Math.min(100, (numericValue / max) * 100));
  }

  trackByLabel(index: number, item: { label: string }): string {
    return `${item.label}-${index}`;
  }

  onYearChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedYear.set(value);
    this.loadDashboard(value === 'all' ? null : Number(value));
  }

}
