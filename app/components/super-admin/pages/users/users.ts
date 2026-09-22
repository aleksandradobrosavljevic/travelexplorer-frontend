import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastrService } from 'ngx-toastr';
import { Paginator, PaginatorState } from 'primeng/paginator';
import { Select } from 'primeng/select';
import { Auth } from '../../../../core/services/auth';
import {
  ToggleUserStatusRequest,
  UserItem,
  UsersService
} from './user.service';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, FormsModule, Paginator, Select],
  templateUrl: './users.html',
  styleUrl: './users.css'
})
export class UsersComponent implements OnInit {
  // ── Signals ───────────────────────────────────────────────────────
  private users = signal<UserItem[]>([]);
  private allFilteredUsers = signal<UserItem[]>([]);
  filteredUsers = signal<UserItem[]>([]);
  selectedUser = signal<UserItem | null>(null);
  isStatusModalOpen = signal(false);
  isDisabled = signal(false);

  // ── Pagination ────────────────────────────────────────────────────
  currentPage = signal(1);
  pageSize = signal(10);
  totalRecords = signal(0);

  // ── Plain state ───────────────────────────────────────────────────
  searchTerm = '';
  selectedRole = 'all';
  selectedStatus = 'all';
  statusReason = '';

  // ── Current logged-in user ────────────────────────────────────────
  private currentUser: any = null;

  // ── Dropdown options ──────────────────────────────────────────────
  roleOptions: SelectOption[] = [
    { label: 'All Roles', value: 'all' },
    { label: 'Super Admin', value: 'SuperAdmin' },
    { label: 'Destination Admin', value: 'Admin' },
    { label: 'Publisher', value: 'Publisher' },
    { label: 'Tourist', value: 'Tourist' }
  ];

  statusOptions: SelectOption[] = [
    { label: 'All Statuses', value: 'all' },
    { label: 'Active', value: 'Active' },
    { label: 'Blocked', value: 'Blocked' }
  ];

  constructor(
    private usersService: UsersService,
    private toastr: ToastrService,
    private auth: Auth
  ) {}

  ngOnInit(): void {
    this.currentUser = this.auth.getCurrentUser();
    this.usersService.getUsers().subscribe({
      next: (data: UserItem[]) => {
        this.users.set(data);
        this.applyFilters();
      },
      error: () => {
        this.toastr.error('Failed to load users.');
      }
    });
  }

  // ── Determines if the Block/Unblock button should be shown ────────
  canToggleStatus(user: UserItem): boolean {
    // Cannot block/unblock Super Admins (including self)
    if (user.role === 'SuperAdmin') return false;
    // Extra safety: cannot act on own account
    if (user.email === this.currentUser?.email) return false;
    return true;
  }

  applyFilters(): void {
    const normalizedSearch = this.searchTerm.trim().toLowerCase();

    const filtered = this.users().filter((user) => {
      const displayName = this.getDisplayName(user).toLowerCase();
      const roleLabel = this.getRoleLabel(user.role).toLowerCase();

      const matchesSearch =
        normalizedSearch === '' ||
        displayName.includes(normalizedSearch) ||
        user.email.toLowerCase().includes(normalizedSearch) ||
        roleLabel.includes(normalizedSearch);

      const matchesRole =
        this.selectedRole === 'all' || user.role === this.selectedRole;

      const matchesStatus =
        this.selectedStatus === 'all' ||
        (this.selectedStatus === 'Active' && user.isActive) ||
        (this.selectedStatus === 'Blocked' && !user.isActive);

      return matchesSearch && matchesRole && matchesStatus;
    });

    this.allFilteredUsers.set(filtered);
    this.totalRecords.set(filtered.length);
    this.currentPage.set(1);
    this.applyPage();
  }

  private applyPage(): void {
    const page = this.currentPage();
    const size = this.pageSize();
    const start = (page - 1) * size;
    this.filteredUsers.set(this.allFilteredUsers().slice(start, start + size));
  }

  onPageChange(event: PaginatorState): void {
    this.currentPage.set((event.page ?? 0) + 1);
    this.pageSize.set(event.rows ?? 10);
    this.applyPage();
  }

  onSearchChange(): void { this.applyFilters(); }
  onRoleChange(): void { this.applyFilters(); }
  onStatusChange(): void { this.applyFilters(); }

  clearAllFilters(): void {
    this.searchTerm = '';
    this.selectedRole = 'all';
    this.selectedStatus = 'all';
    this.applyFilters();
    this.toastr.success('Filters cleared.');
  }

  getDisplayName(user: UserItem): string {
    const firstName = user.firstName?.trim() ?? '';
    const lastName = user.lastName?.trim() ?? '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    if (user.organizationName?.trim()) return user.organizationName.trim();
    return 'Unnamed User';
  }

  getRoleLabel(role: string): string {
    switch (role) {
      case 'SuperAdmin':        return 'Super Admin';
      case 'DestinationAdmin':
      case 'Admin':             return 'Destination Admin';
      case 'Publisher':         return 'Publisher';
      case 'Tourist':           return 'Tourist';
      default:                  return role;
    }
  }

  getUserStatusLabel(user: UserItem): string {
    return user.isActive ? 'Active' : 'Blocked';
  }

  getStatusClass(user: UserItem): string {
    return user.isActive ? 'status-active' : 'status-blocked';
  }

  openStatusModal(user: UserItem): void {
    this.selectedUser.set(user);
    this.statusReason = user.isActive
      ? 'Manual block by super admin'
      : 'Manual unblock by super admin';
    this.isStatusModalOpen.set(true);
  }

  closeStatusModal(): void {
    this.isStatusModalOpen.set(false);
    this.selectedUser.set(null);
    this.statusReason = '';
  }

  confirmUserStatusChange(): void {
    const user = this.selectedUser();
    if (!user) return;

    const trimmedReason = this.statusReason.trim();
    if (!trimmedReason) {
      this.toastr.warning('Reason is required.');
      return;
    }

    this.isDisabled.set(true);
    const displayName = this.getDisplayName(user);
    const request: ToggleUserStatusRequest = { reason: trimmedReason };

    this.usersService.toggleUserStatus(user.id, request).subscribe({
      next: () => {
        this.users.update(list =>
          list.map(u => u.id === user.id ? { ...u, isActive: !user.isActive } : u)
        );
        this.applyFilters();
        this.toastr.success(
          user.isActive
            ? `${displayName} has been blocked.`
            : `${displayName} has been unblocked.`
        );
        this.closeStatusModal();
        this.isDisabled.set(false);
      },
      error: () => {
        this.toastr.error('Failed to update user status.');
        this.isDisabled.set(false);
      }
    });
  }
}