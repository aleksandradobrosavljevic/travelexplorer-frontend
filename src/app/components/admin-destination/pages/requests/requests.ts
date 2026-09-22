import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { Select } from 'primeng/select';
import { Paginator, PaginatorState } from 'primeng/paginator';
import {
  AdminDestinationModerationRequest,
  AdminDestinationRequestKind
} from '../../shared/admin-destination.models';
import { AdminDestinationRequestsService } from './requests.service';

type RequestKindFilter = AdminDestinationRequestKind | 'all';

@Component({
  selector: 'app-admin-destination-requests',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, DatePipe, FormsModule, Select, Paginator],
  templateUrl: './requests.html',
  styleUrl: './requests.css'
})
export class AdminDestinationRequestsComponent {
  private readonly requestsService = inject(AdminDestinationRequestsService);
  private readonly route = inject(ActivatedRoute);
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);

  readonly requestKindOptions: { value: RequestKindFilter; label: string }[] = [
    { value: 'all', label: 'All request types' },
    { value: 'account', label: 'Accounts' },
    { value: 'object', label: 'Objects' },
    { value: 'activity', label: 'Activities' },
    { value: 'event', label: 'Events' }
  ];

  readonly pageSizeOptions = [5, 10, 20];

  // ── Constants ─────────────────────────────────────────────────────
  readonly REJECTION_REASON_MAX_LENGTH = 800;

  private readonly requests = signal<AdminDestinationModerationRequest[]>(
    this.route.snapshot.data['requests'] ?? []
  );
  readonly searchTerm = signal('');
  readonly typeFilter = signal<RequestKindFilter>('all');
  private readonly rejectionDrafts = signal<Record<string, string>>({});
  private readonly busyKeys = signal<Record<string, boolean>>({});

  readonly selectedItem = signal<AdminDestinationModerationRequest | null>(null);

  // Pagination
  readonly first = signal(0);
  readonly pageSize = signal(10);

  readonly filteredRequests = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    const kind = this.typeFilter();

    return this.requests().filter((item) => {
      const matchesType = kind === 'all' || item.kind === kind;
      const haystack = [item.kind, item.title, item.subtitle, item.detail, item.owner]
        .join(' ').toLowerCase();
      return matchesType && (!query || haystack.includes(query));
    });
  });

  readonly paginatedRequests = computed(() => {
    const start = this.first();
    const size = this.pageSize();
    return this.filteredRequests().slice(start, start + size);
  });

  readonly totalCount = computed(() => this.requests().length);
  readonly filteredCount = computed(() => this.filteredRequests().length);
  readonly accountCount = computed(() => this.countByKind('account'));
  readonly objectCount = computed(() => this.countByKind('object'));
  readonly activityCount = computed(() => this.countByKind('activity'));
  readonly eventCount = computed(() => this.countByKind('event'));

  onPageChange(event: PaginatorState): void {
    this.first.set(event.first ?? 0);
    this.pageSize.set(event.rows ?? 10);
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.typeFilter.set('all');
    this.first.set(0);
  }

  rejectionReason(item: AdminDestinationModerationRequest): string {
    return this.rejectionDrafts()[this.rowKey(item)] ?? '';
  }

  setRejectionReason(item: AdminDestinationModerationRequest, value: string): void {
    const sliced = (value ?? '').slice(0, this.REJECTION_REASON_MAX_LENGTH);
    this.rejectionDrafts.update((drafts) => ({ ...drafts, [this.rowKey(item)]: sliced }));
  }

  approve(item: AdminDestinationModerationRequest): void {
    const reason = this.rejectionReason(item).trim();

    if (reason) {
      this.toastr.warning('Clear the rejection reason before approving.');
      return;
    }

    if (this.isActionInProgress(item)) return;
    this.setBusy(item, true);

    this.requestsService.approveModerationRequest(item)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.removeRequest(item);
          this.toastr.success(`${this.kindLabel(item.kind)} "${item.title}" approved.`);
        },
        error: (err: unknown) => {
          this.toastr.error(this.extractErrorMessage(err, `Could not approve "${item.title}".`));
          this.setBusy(item, false);
        }
      });
  }

  reject(item: AdminDestinationModerationRequest): void {
    const reason = this.rejectionReason(item).trim();

    if (!reason) {
      this.toastr.warning('Please enter a rejection reason before rejecting.');
      return;
    }

    if (reason.length > this.REJECTION_REASON_MAX_LENGTH) {
      this.toastr.warning(`Rejection reason must not exceed ${this.REJECTION_REASON_MAX_LENGTH} characters.`);
      return;
    }

    if (this.isActionInProgress(item)) return;
    this.setBusy(item, true);

    this.requestsService.rejectModerationRequest(item, reason)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.removeRequest(item);
          this.toastr.success(`${this.kindLabel(item.kind)} "${item.title}" rejected.`);
        },
        error: (err: unknown) => {
          this.toastr.error(this.extractErrorMessage(err, `Could not reject "${item.title}".`));
          this.setBusy(item, false);
        }
      });
  }

  isActionInProgress(item: AdminDestinationModerationRequest): boolean {
    return !!this.busyKeys()[this.rowKey(item)];
  }

  kindLabel(kind: AdminDestinationRequestKind): string {
    const labels: Record<AdminDestinationRequestKind, string> = {
      account: 'Account',
      object: 'Object',
      activity: 'Activity',
      event: 'Event'
    };
    return labels[kind];
  }

  trackByRequest(_: number, item: AdminDestinationModerationRequest): string {
    return `${item.kind}-${item.id}`;
  }

  private rowKey(item: AdminDestinationModerationRequest): string {
    return `${item.kind}-${item.id}`;
  }

  private countByKind(kind: AdminDestinationRequestKind): number {
    return this.requests().filter((r) => r.kind === kind).length;
  }

  private removeRequest(item: AdminDestinationModerationRequest): void {
    if (this.selectedItem()?.id === item.id) this.selectedItem.set(null);
    this.requests.update((list) => list.filter((r) => this.rowKey(r) !== this.rowKey(item)));
    this.setBusy(item, false);
  }

  private setBusy(item: AdminDestinationModerationRequest, busy: boolean): void {
    this.busyKeys.update((current) => {
      const next = { ...current };
      if (busy) next[this.rowKey(item)] = true;
      else delete next[this.rowKey(item)];
      return next;
    });
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error === 'string' && error.error.trim()) {
      return error.error;
    }
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }
    return fallback;
  }

  openModal(item: AdminDestinationModerationRequest): void {
    this.selectedItem.set(item);
  }

  closeModal(): void {
    this.selectedItem.set(null);
  }
}