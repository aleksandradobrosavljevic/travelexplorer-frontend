import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { Auth } from '../../../../core/services/auth';
import { buildApiUrl, buildAssetUrl } from '../../../../core/config/api';

type PasswordField = 'oldPassword' | 'newPassword' | 'confirmPassword';

interface SidebarProfile {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  avatarUrl?: string;
}

interface PasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

@Component({
  selector: 'app-super-admin-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './super-admin-sidebar.html',
  styleUrl: './super-admin-sidebar.css'
})
export class SuperAdminSidebarComponent implements OnInit {
  isCollapsed = false;
  isProfileModalOpen = signal(false);
  isSavingPassword = signal(false);
  isSavingProfile = signal(false);
  isUploadingAvatar = signal(false);
  showOldPassword = signal(false);
  showNewPassword = signal(false);
  showConfirmPassword = signal(false);

  profile = signal<SidebarProfile>({
    firstName: 'Super',
    lastName: 'Admin',
    email: 'admin@travelexp.com',
    role: 'SuperAdmin',
    avatarUrl: undefined
  });

  editFirstName = signal('');
  editLastName = signal('');
  editEmail = signal('');

  profileHasChanges = computed(() => {
    const p = this.profile();
    return this.editFirstName().trim() !== p.firstName
      || this.editLastName().trim() !== p.lastName
      || this.editEmail().trim() !== p.email;
  });

  passwordData = signal<PasswordForm>({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  displayName = computed(() => {
    const profile = this.profile();
    const fullName = `${profile.firstName} ${profile.lastName}`.trim();
    return fullName || 'Super Admin';
  });

  roleLabel = computed(() => this.getRoleLabel(this.profile().role));

  avatarInitials = computed(() => {
    const profile = this.profile();
    const initials = `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`.trim();
    return initials.toUpperCase() || 'SA';
  });

  constructor(
    private router: Router,
    private http: HttpClient,
    private toastr: ToastrService,
    private auth: Auth
  ) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  toggleSidebar(): void {
    this.isCollapsed = !this.isCollapsed;
  }

  openProfileModal(): void {
    this.resetPasswordFields();
    const p = this.profile();
    this.editFirstName.set(p.firstName);
    this.editLastName.set(p.lastName);
    this.editEmail.set(p.email);
    this.isProfileModalOpen.set(true);
  }

  closeProfileModal(): void {
    this.isProfileModalOpen.set(false);
    this.resetPasswordFields();
  }

  updatePasswordField(field: PasswordField, value: string): void {
    this.passwordData.update((current) => ({
      ...current,
      [field]: value ?? ''
    }));
  }

  togglePasswordVisibility(field: PasswordField): void {
    switch (field) {
      case 'oldPassword':
        this.showOldPassword.set(!this.showOldPassword());
        break;
      case 'newPassword':
        this.showNewPassword.set(!this.showNewPassword());
        break;
      case 'confirmPassword':
        this.showConfirmPassword.set(!this.showConfirmPassword());
        break;
    }
  }

  // ── Avatar upload ─────────────────────────────────────────────────
  triggerAvatarUpload(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) this.uploadAvatar(file);
    };
    input.click();
  }

  private uploadAvatar(file: File): void {
    this.isUploadingAvatar.set(true);
    const formData = new FormData();
    formData.append('file', file);

    this.http.post<{ avatarUrl?: string; relativePath?: string; url?: string }>(
      buildApiUrl('users/me/avatar'),
      formData
    ).subscribe({
      next: (response) => {
        this.profile.update(p => ({
          ...p,
          avatarUrl: buildAssetUrl(response.avatarUrl ?? response.relativePath ?? response.url) ?? undefined
        }));
        this.isUploadingAvatar.set(false);
        this.toastr.success('Profile photo updated.');
      },
      error: () => {
        this.isUploadingAvatar.set(false);
        this.toastr.error('Failed to upload profile photo.');
      }
    });
  }

  removeAvatar(): void {
    if (!this.profile().avatarUrl || this.isUploadingAvatar()) return;

    this.isUploadingAvatar.set(true);
    this.http.delete(buildApiUrl('users/me/avatar')).subscribe({
      next: () => {
        this.profile.update(p => ({ ...p, avatarUrl: undefined }));
        this.isUploadingAvatar.set(false);
        this.toastr.success('Profile photo removed.');
      },
      error: () => {
        this.isUploadingAvatar.set(false);
        this.toastr.error('Failed to remove profile photo.');
      }
    });
  }

  // ── Save profile (name + email) ───────────────────────────────────
  saveProfile(): void {
    if (this.isSavingProfile()) return;

    const firstName = this.editFirstName().trim();
    const lastName = this.editLastName().trim();
    const email = this.editEmail().trim();

    if (!firstName || !lastName) {
      this.toastr.warning('First name and last name are required.');
      return;
    }

    if (!email || !this.isValidEmail(email)) {
      this.toastr.warning('Please enter a valid email address.');
      return;
    }

    this.isSavingProfile.set(true);
    this.http.put(buildApiUrl('users/me'), { firstName, lastName, email }).subscribe({
      next: () => {
        this.profile.update(p => ({ ...p, firstName, lastName, email }));
        this.isSavingProfile.set(false);
        this.toastr.success('Profile updated successfully.');
      },
      error: () => {
        this.isSavingProfile.set(false);
        this.toastr.error('Failed to update profile.');
      }
    });
  }

  discardProfile(): void {
    const p = this.profile();
    this.editFirstName.set(p.firstName);
    this.editLastName.set(p.lastName);
    this.editEmail.set(p.email);
  }

  // ── Change password ───────────────────────────────────────────────
  changePassword(): void {
    if (this.isSavingPassword()) return;

    const passwordData = this.passwordData();
    if (!this.validatePasswordChange(passwordData)) return;

    this.isSavingPassword.set(true);
    this.http.post(buildApiUrl('users/me/change-password'), {
      currentPassword: passwordData.oldPassword,
      newPassword: passwordData.newPassword
    }).subscribe({
      next: () => {
        this.isSavingPassword.set(false);
        this.closeProfileModal();
        this.toastr.success('Password changed successfully. Sign in again on your next session.');
      },
      error: (error) => {
        this.isSavingPassword.set(false);
        this.toastr.error(error?.error?.message ?? 'Password could not be changed.');
      }
    });
  }

  onLogout(): void {
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login'])
    });
  }

  private loadProfile(): void {
    const storedUser = this.auth.getCurrentUser();

    if (storedUser) {
      this.profile.set({
        firstName: storedUser.firstName ?? 'Super',
        lastName: storedUser.lastName ?? 'Admin',
        email: storedUser.email ?? 'admin@travelexp.com',
        role: storedUser.role ?? 'SuperAdmin',
        avatarUrl: undefined
      });
    }

    this.http.get<any>(buildApiUrl('users/me')).subscribe({
      next: (response: any) => {
        this.profile.set({
          firstName: response?.firstName ?? storedUser?.firstName ?? 'Super',
          lastName: response?.lastName ?? storedUser?.lastName ?? 'Admin',
          email: response?.email ?? storedUser?.email ?? 'admin@travelexp.com',
          role: response?.role ?? storedUser?.role ?? 'SuperAdmin',
          avatarUrl: buildAssetUrl(response?.avatarUrl) ?? undefined
        });
      },
      error: () => {}
    });
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private validatePasswordChange(passwordData: PasswordForm): boolean {
    if (!passwordData.oldPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      this.toastr.error('Fill in all password fields.');
      return false;
    }
    if (passwordData.newPassword.length < 8) {
      this.toastr.error('New password must be at least 8 characters long.');
      return false;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      this.toastr.error('New passwords do not match.');
      return false;
    }
    if (passwordData.oldPassword === passwordData.newPassword) {
      this.toastr.error('New password must be different from the current password.');
      return false;
    }
    return true;
  }

  private resetPasswordFields(): void {
    this.passwordData.set({ oldPassword: '', newPassword: '', confirmPassword: '' });
    this.showOldPassword.set(false);
    this.showNewPassword.set(false);
    this.showConfirmPassword.set(false);
  }

  private getRoleLabel(role: string): string {
    switch ((role ?? '').toLowerCase()) {
      case 'superadmin':
      case 'super_admin':
        return 'Super Admin';
      default:
        return role || 'Super Admin';
    }
  }
}
