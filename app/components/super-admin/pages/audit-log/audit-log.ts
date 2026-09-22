import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Paginator, PaginatorState } from 'primeng/paginator';
import { Select } from 'primeng/select';
import { AuditLogItem, AuditLogService } from './audit-log.service';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [CommonModule, FormsModule, Paginator, Select],
  templateUrl: './audit-log.html',
  styleUrl: './audit-log.css'
})
export class AuditLogComponent implements OnInit {
  // ── Signals ───────────────────────────────────────────────────────
  private logs = signal<AuditLogItem[]>([]);

  filteredLogs = signal<AuditLogItem[]>([]);
  pagedLogs = signal<AuditLogItem[]>([]);
  selectedLog = signal<AuditLogItem | null>(null);
  isDetailsOpen = signal(false);

  currentPage = signal(1);
  pageSize = signal(10);
  totalRecords = signal(0);

  searchTerm = '';
  selectedAction = 'all';
  selectedTargetRole = 'all';
  selectedStatus = 'all';

  actionOptions: SelectOption[] = [
    { label: 'All Actions', value: 'all' },
    { label: 'Block Account', value: 'BLOCK_ACCOUNT' },
    { label: 'Unblock Account', value: 'UNBLOCK_ACCOUNT' },
    { label: 'Create Destination Admin', value: 'CREATE_DESTINATION_ADMIN' },
    { label: 'Update Destination Admin', value: 'UPDATE_DESTINATION_ADMIN' }
  ];

  targetRoleOptions: SelectOption[] = [
    { label: 'All User Types', value: 'all' },
    { label: 'Destination Admin', value: 'Destination Admin' },
    { label: 'Publisher', value: 'Publisher' },
    { label: 'Tourist', value: 'Tourist' }
  ];

  statusOptions: SelectOption[] = [
    { label: 'All Statuses', value: 'all' },
    { label: 'Success', value: 'Success' },
    { label: 'Failed', value: 'Failed' }
  ];

  // ── Computed ──────────────────────────────────────────────────────
  publisherActionCount = computed(() => this.logs().filter(l => l.targetRole === 'Publisher').length);
  accountChangeCount = computed(() => this.logs().filter(l =>
    ['BLOCK_ACCOUNT', 'UNBLOCK_ACCOUNT', 'CREATE_DESTINATION_ADMIN', 'UPDATE_DESTINATION_ADMIN', 'DELETE_DESTINATION_ADMIN']
      .includes(l.action)
  ).length);

  constructor(private auditLogService: AuditLogService) {}

  ngOnInit(): void {
    this.auditLogService.getLogs().subscribe((data: AuditLogItem[]) => {
      this.logs.set(data);
      this.applyFilters();
    });
  }

  applyFilters(): void {
    const normalizedSearch = this.searchTerm.trim().toLowerCase();

    const filtered = this.logs().filter((log) => {
      const matchesSearch =
        normalizedSearch === '' ||
        log.adminName.toLowerCase().includes(normalizedSearch) ||
        log.adminEmail.toLowerCase().includes(normalizedSearch) ||
        log.actionLabel.toLowerCase().includes(normalizedSearch) ||
        log.targetName.toLowerCase().includes(normalizedSearch) ||
        log.targetEmail.toLowerCase().includes(normalizedSearch) ||
        log.targetRole.toLowerCase().includes(normalizedSearch) ||
        log.reason.toLowerCase().includes(normalizedSearch) ||
        log.details.toLowerCase().includes(normalizedSearch);

      const matchesAction =
        this.selectedAction === 'all' || log.action === this.selectedAction;

      const matchesTargetRole =
        this.selectedTargetRole === 'all' || log.targetRole === this.selectedTargetRole;

      const matchesStatus =
        this.selectedStatus === 'all' || log.status === this.selectedStatus;

      return matchesSearch && matchesAction && matchesTargetRole && matchesStatus;
    });

    this.filteredLogs.set(filtered);
    this.totalRecords.set(filtered.length);
    this.currentPage.set(1);
    this.applyPage();
  }

  private applyPage(): void {
    const page = this.currentPage();
    const size = this.pageSize();
    const start = (page - 1) * size;
    this.pagedLogs.set(this.filteredLogs().slice(start, start + size));
  }

  onPageChange(event: PaginatorState): void {
    this.currentPage.set((event.page ?? 0) + 1);
    this.pageSize.set(event.rows ?? 10);
    this.applyPage();
  }

  onSearchChange(): void { this.applyFilters(); }
  onActionChange(): void { this.applyFilters(); }
  onTargetRoleChange(): void { this.applyFilters(); }
  onStatusChange(): void { this.applyFilters(); }

  clearAllFilters(): void {
    this.searchTerm = '';
    this.selectedAction = 'all';
    this.selectedTargetRole = 'all';
    this.selectedStatus = 'all';
    this.applyFilters();
  }

  openDetails(log: AuditLogItem): void {
    this.selectedLog.set(log);
    this.isDetailsOpen.set(true);
  }

  closeDetails(): void {
    this.selectedLog.set(null);
    this.isDetailsOpen.set(false);
  }

  getStatusClass(status: AuditLogItem['status']): string {
    return status === 'Success' ? 'status-success' : 'status-failed';
  }

  formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return timestamp;
    }

    return date.toLocaleString();
  }

  getActionClass(action: AuditLogItem['action']): string {
    const normalized = action.toUpperCase();

    if (normalized.includes('APPROVE') || normalized.includes('UNBLOCK') || normalized.includes('CREATE')) {
      return 'action-approve';
    }

    if (normalized.includes('REJECT') || normalized.includes('BLOCK') || normalized.includes('DELETE')) {
      return 'action-reject';
    }

    if (normalized.includes('UPDATE')) {
      return 'action-update';
    }

    return 'action-neutral';
  }
}
