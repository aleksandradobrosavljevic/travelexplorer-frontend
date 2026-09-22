import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Select } from 'primeng/select';
import { Paginator, PaginatorState } from 'primeng/paginator';
import { ToastrService } from 'ngx-toastr';
import {
  DestinationAdminItem,
  DestinationAdminsService
} from './destination-admins.service';

type DestinationAdminFormMode = 'add' | 'edit';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-destination-admins',
  standalone: true,
  imports: [CommonModule, FormsModule, Select, Paginator],
  templateUrl: './destination-admins.html',
  styleUrl: './destination-admins.css'
})
export class DestinationAdminsComponent implements OnInit {
  // ── Signals ───────────────────────────────────────────────────────
  private destinationAdmins = signal<DestinationAdminItem[]>([]);
  private allFilteredDestinationAdmins = signal<DestinationAdminItem[]>([]);
  filteredDestinationAdmins = signal<DestinationAdminItem[]>([]);
  availableDestinations = signal<string[]>([]);

  // ── Pagination ────────────────────────────────────────────────────
  currentPage = signal(1);
  pageSize = signal(10);
  totalRecords = signal(0);

  isFormOpen = signal(false);
  isStatusConfirmOpen = signal(false);
  isSubmitting = signal(false);
  isLookingUpEmail = signal(false);

  selectedAdminForStatus = signal<DestinationAdminItem | null>(null);

  // ── Original values snapshot for edit dirty-check ─────────────────
  private originalFullName = '';
  private originalAssignedDestination = '';

  // ── Computed ──────────────────────────────────────────────────────
  activeCount = computed(() => this.destinationAdmins().filter(a => a.status === 'Active').length);
  inactiveCount = computed(() => this.destinationAdmins().filter(a => a.status === 'Inactive').length);
  availableDestinationOptions = computed(() =>
    this.availableDestinations().map(d => ({ label: d, value: d }))
  );

  get isEditUnchanged(): boolean {
    if (this.formMode !== 'edit') return false;
    return (
      this.formData.fullName.trim() === this.originalFullName.trim() &&
      this.formData.assignedDestination === this.originalAssignedDestination
    );
  }

  // ── Plain state ───────────────────────────────────────────────────
  searchTerm = '';
  selectedStatus = 'all';
  selectedDestination = 'all';
  formMode: DestinationAdminFormMode = 'add';
  editingAdminId: number | null = null;
  formData: DestinationAdminItem = this.getEmptyFormData();

  // ── Dropdown options ──────────────────────────────────────────────
  statusOptions: SelectOption[] = [
    { label: 'All Statuses', value: 'all' },
    { label: 'Active', value: 'Active' },
    { label: 'Inactive', value: 'Inactive' }
  ];

  destinationOptions = signal<SelectOption[]>([
    { label: 'All Destinations', value: 'all' }
  ]);

  constructor(
    private destinationAdminsService: DestinationAdminsService,
    private toastr: ToastrService
  ) {}

  ngOnInit(): void {
    this.getAllAndAvailableDestinations();
  }

  getAllAndAvailableDestinations(): void {
    this.destinationAdminsService.getDestinationAdmins().subscribe({
      next: (data: DestinationAdminItem[]) => {
        this.destinationAdmins.set(data);
        this.applyFilters();
      },
      error: () => {
        this.toastr.error('Failed to load destination admins.');
      }
    });

    this.destinationAdminsService.getAvailableDestinations().subscribe({
      next: (data: string[]) => {
        this.availableDestinations.set(data);
        this.destinationOptions.set([
          { label: 'All Destinations', value: 'all' },
          ...data.map(d => ({ label: d, value: d }))
        ]);
      },
      error: () => {
        this.toastr.error('Failed to load available destinations.');
      }
    });
  }

  getEmptyFormData(): DestinationAdminItem {
    return {
      id: 0,
      userId: 0,
      destinationId: 0,
      fullName: '',
      email: '',
      assignedDestination: '',
      phone: '',
      status: 'Active',
      role: 'Destination Admin'
    };
  }

  // ── Email blur: auto-fill full name in add mode ───────────────────
  onEmailBlur(): void {
    if (this.formMode !== 'add') return;
    const email = this.formData.email.trim();
    if (!email) return;

    this.isLookingUpEmail.set(true);
    this.destinationAdminsService.getUserByEmail(email).subscribe({
      next: (user) => {
        this.isLookingUpEmail.set(false);
        if (user) {
          this.formData.fullName = `${user.firstName} ${user.lastName}`.trim();
        } else {
          this.formData.fullName = '';
        }
      },
      error: () => {
        this.isLookingUpEmail.set(false);
      }
    });
  }

  applyFilters(): void {
    const normalizedSearch = this.searchTerm.trim().toLowerCase();
    const filtered = this.destinationAdmins().filter((admin) => {
      const matchesSearch =
        normalizedSearch === '' ||
        admin.fullName.toLowerCase().includes(normalizedSearch) ||
        admin.email.toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        this.selectedStatus === 'all' || admin.status === this.selectedStatus;
      const matchesDestination =
        this.selectedDestination === 'all' ||
        admin.assignedDestination === this.selectedDestination;
      return matchesSearch && matchesStatus && matchesDestination;
    });
    this.allFilteredDestinationAdmins.set(filtered);
    this.totalRecords.set(filtered.length);
    this.currentPage.set(1);
    this.applyPage();
  }

  private applyPage(): void {
    const start = (this.currentPage() - 1) * this.pageSize();
    this.filteredDestinationAdmins.set(this.allFilteredDestinationAdmins().slice(start, start + this.pageSize()));
  }

  onPageChange(event: PaginatorState): void {
    this.currentPage.set((event.page ?? 0) + 1);
    this.pageSize.set(event.rows ?? 10);
    this.applyPage();
  }

  onSearchChange(): void { this.applyFilters(); }
  onStatusChange(): void { this.applyFilters(); }
  onDestinationChange(): void { this.applyFilters(); }

  clearAllFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = 'all';
    this.selectedDestination = 'all';
    this.applyFilters();
    this.toastr.success('Filters cleared.');
  }

  getStatusClass(status: DestinationAdminItem['status']): string {
    return status === 'Active' ? 'status-active' : 'status-inactive';
  }

  openAddForm(): void {
    this.formMode = 'add';
    this.editingAdminId = null;
    this.formData = this.getEmptyFormData();
    this.originalFullName = '';
    this.originalAssignedDestination = '';
    this.isFormOpen.set(true);
  }

  openEditForm(admin: DestinationAdminItem): void {
    this.formMode = 'edit';
    this.editingAdminId = admin.id;
    this.formData = { ...admin };
    // Snapshot original values for dirty-check
    this.originalFullName = admin.fullName;
    this.originalAssignedDestination = admin.assignedDestination;
    this.isFormOpen.set(true);
  }

  closeForm(): void {
    this.isFormOpen.set(false);
    this.formMode = 'add';
    this.editingAdminId = null;
    this.formData = this.getEmptyFormData();
    this.originalFullName = '';
    this.originalAssignedDestination = '';
  }

  saveDestinationAdmin(): void {
    if (!this.formData.fullName.trim() || !this.formData.email.trim() || !this.formData.assignedDestination.trim()) {
      this.toastr.warning('Please fill in all required fields.');
      return;
    }

    const fullNameParts = this.formData.fullName.trim().split(/\s+/);
    const firstName = fullNameParts[0] ?? '';
    const lastName = fullNameParts.slice(1).join(' ');

    if (this.formMode === 'add') {
      this.destinationAdminsService.getDestinationIdByName(this.formData.assignedDestination).subscribe({
        next: (destinationId) => {
          if (!destinationId) { this.toastr.error('Assigned destination could not be resolved.'); return; }
          this.destinationAdminsService.getUserIdByEmail(this.formData.email).subscribe({
            next: (userId) => {
              if (!userId) { this.toastr.error('User with this email was not found.'); return; }
              this.destinationAdminsService.createDestinationAdmin(userId, destinationId, firstName, lastName).subscribe({
                next: () => { this.toastr.success('Destination admin created successfully.'); this.closeForm(); this.getAllAndAvailableDestinations(); },
                error: (err) => { this.toastr.error(err?.error || 'Failed to create destination admin.'); }
              });
            },
            error: () => { this.toastr.error('Failed to find user by email.'); }
          });
        },
        error: () => { this.toastr.error('Failed to load destination data.'); }
      });
    } else {
      const currentAdmin = this.destinationAdmins().find((admin) => admin.id === this.editingAdminId);
      if (!currentAdmin) { this.toastr.error('Selected destination admin was not found.'); return; }
      this.destinationAdminsService.getDestinationIdByName(this.formData.assignedDestination).subscribe({
        next: (destinationId) => {
          if (!destinationId) { this.toastr.error('Assigned destination could not be resolved.'); return; }
          this.destinationAdminsService.updateDestinationAdmin(currentAdmin, firstName, lastName, destinationId).subscribe({
            next: () => { this.toastr.success('Destination admin updated successfully.'); this.closeForm(); this.getAllAndAvailableDestinations(); },
            error: () => { this.toastr.error('Failed to update destination admin.'); }
          });
        },
        error: () => { this.toastr.error('Failed to load destination data.'); }
      });
    }
  }

  openStatusConfirm(admin: DestinationAdminItem): void {
    this.selectedAdminForStatus.set(admin);
    this.isStatusConfirmOpen.set(true);
  }

  closeStatusConfirm(): void {
    this.selectedAdminForStatus.set(null);
    this.isStatusConfirmOpen.set(false);
  }

  confirmStatusChange(): void {
    const admin = this.selectedAdminForStatus();
    if (!admin) return;
    const willDeactivate = admin.status === 'Active';
    this.isSubmitting.set(true);
    this.destinationAdminsService.toggleDestinationAdminStatus(admin).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.closeStatusConfirm();
        if (willDeactivate) {
          this.toastr.warning(`${admin.fullName}'s account has been deactivated. They will no longer be able to log in.`);
        } else {
          this.toastr.success(`${admin.fullName} has been activated successfully.`);
        }
        this.getAllAndAvailableDestinations();
      },
      error: () => {
        this.toastr.error('Failed to change destination admin status.');
        this.isSubmitting.set(false);
      }
    });
  }
}