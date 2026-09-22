import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { Auth } from '../../../../core/services/auth';
import { buildApiUrl, buildAssetUrl } from '../../../../core/config/api';

type PasswordField = 'oldPassword' | 'newPassword' | 'confirmPassword';

interface SidebarProfile {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
}

interface PasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

@Component({
  selector: 'app-admin-destination-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-destination-sidebar.html',
  styleUrl: './admin-destination-sidebar.css'
})
export class AdminDestinationSidebarComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);
  private readonly toastr = inject(ToastrService);

  readonly links = [
    { label: 'Dashboard', path: '/admin-destination/dashboard', icon: 'pi pi-chart-bar' },
    { label: 'Content',   path: '/admin-destination/content',   icon: 'pi pi-file' },
    { label: 'Map',       path: '/admin-destination/map',       icon: 'pi pi-map' },
    { label: 'Requests',  path: '/admin-destination/requests',  icon: 'pi pi-inbox' },
    { label: 'Reviews',   path: '/admin-destination/reviews',   icon: 'pi pi-star' },
    { label: 'Publisher Overview', path: '/admin-destination/users', icon: 'pi pi-users' }
  ];

  isCollapsed = false;
  isProfileModalOpen = signal(false);
  isSavingProfile = signal(false);
  isSavingPassword = signal(false);
  avatarPreview = signal<string | null>(null);
  showOldPassword = signal(false);
  showNewPassword = signal(false);
  showConfirmPassword = signal(false);

  profile = signal<SidebarProfile>({
    firstName: 'Destination',
    lastName: 'Admin',
    email: 'admin@destination.com',
    role: 'DestinationAdmin',
    avatarUrl: null
  });

  profileEditData = signal<{ firstName: string; lastName: string; email: string }>({
    firstName: '',
    lastName: '',
    email: ''
  });

  passwordData = signal<PasswordForm>({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  displayName = computed(() => {
    const p = this.profile();
    return `${p.firstName} ${p.lastName}`.trim() || 'Destination Admin';
  });

  roleLabel = computed(() => this.getRoleLabel(this.profile().role));

  avatarInitials = computed(() => {
    const p = this.profile();
    return (`${p.firstName.charAt(0)}${p.lastName.charAt(0)}`).trim().toUpperCase() || 'DA';
  });

  ngOnInit(): void {
    this.loadProfile();
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
  }

  isActive(path: string): boolean {
    return this.router.url === path;
  }

  navigate(path: string): void {
    if (this.router.url !== path) {
      if (path === '/admin-destination/map') {
        sessionStorage.removeItem('mapState');
      }
      this.router.navigateByUrl(path);
    }
  }

  openProfileModal(): void {
    const p = this.profile();
    this.profileEditData.set({ firstName: p.firstName, lastName: p.lastName, email: p.email });
    this.resetPasswordFields();
    this.isProfileModalOpen.set(true);
  }

  closeProfileModal(): void {
    this.isProfileModalOpen.set(false);
    this.resetPasswordFields();
    // Keep avatarPreview so it persists during the session
  }

  updatePasswordField(field: PasswordField, value: string): void {
    this.passwordData.update(current => ({ ...current, [field]: value ?? '' }));
  }

  updateProfileField(field: 'firstName' | 'lastName' | 'email', value: string): void {
    this.profileEditData.update(current => ({ ...current, [field]: value ?? '' }));
  }

  togglePasswordVisibility(field: PasswordField): void {
    switch (field) {
      case 'oldPassword':    this.showOldPassword.set(!this.showOldPassword());       break;
      case 'newPassword':    this.showNewPassword.set(!this.showNewPassword());       break;
      case 'confirmPassword': this.showConfirmPassword.set(!this.showConfirmPassword()); break;
    }
  }

  saveProfile(): void {
    if (this.isSavingProfile()) return;

    const data = this.profileEditData();
    if (!data.firstName.trim() || !data.lastName.trim() || !data.email.trim()) {
      this.toastr.error('All profile fields are required.');
      return;
    }

    this.isSavingProfile.set(true);
    this.http.put(buildApiUrl('users/me'), {
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      email: data.email.trim()
    }).subscribe({
      next: () => {
        this.profile.update(p => ({ ...p, ...data }));
        this.isSavingProfile.set(false);
        this.toastr.success('Profile updated successfully.');
      },
      error: (error) => {
        this.isSavingProfile.set(false);
        this.toastr.error(error?.error?.message ?? 'Profile could not be updated.');
      }
    });
  }

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

  onAvatarFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    input.value = '';

    const formData = new FormData();
    formData.append('file', file);

    this.http.post<any>(buildApiUrl('users/me/avatar'), formData).subscribe({
      next: (response) => {
        const avatarUrl = buildAssetUrl(response?.avatarUrl ?? response?.relativePath ?? response?.url) ?? null;
        this.avatarPreview.set(avatarUrl);
        this.profile.update(profile => ({ ...profile, avatarUrl }));
        this.toastr.success('Profile photo updated.');
      },
      error: (error) => {
        this.toastr.error(error?.error?.message ?? 'Profile photo could not be updated.');
      }
    });
  }

  removeAvatar(): void {
    if (!this.avatarPreview()) return;

    this.http.delete(buildApiUrl('users/me/avatar')).subscribe({
      next: () => {
        this.avatarPreview.set(null);
        this.profile.update(profile => ({ ...profile, avatarUrl: null }));
        this.toastr.success('Profile photo removed.');
      },
      error: (error) => {
        this.toastr.error(error?.error?.message ?? 'Profile photo could not be removed.');
      }
    });
  }

  logout(): void {
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login'])
    });
  }

  private loadProfile(): void {
    const storedUser = this.auth.getCurrentUser();

    if (storedUser) {
      this.profile.set({
        firstName: storedUser.firstName ?? 'Destination',
        lastName:  storedUser.lastName  ?? 'Admin',
        email:     storedUser.email     ?? 'admin@destination.com',
        role:      storedUser.role      ?? 'DestinationAdmin',
        avatarUrl: null
      });
    }

    this.http.get<any>(buildApiUrl('users/me')).subscribe({
      next: (response: any) => {
        this.profile.set({
          firstName: response?.firstName ?? storedUser?.firstName ?? 'Destination',
          lastName:  response?.lastName  ?? storedUser?.lastName  ?? 'Admin',
          email:     response?.email     ?? storedUser?.email     ?? 'admin@destination.com',
          role:      response?.role      ?? storedUser?.role      ?? 'DestinationAdmin',
          avatarUrl: buildAssetUrl(response?.avatarUrl) ?? null
        });
        this.avatarPreview.set(buildAssetUrl(response?.avatarUrl) ?? null);
      },
      error: () => {}
    });
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
      case 'destinationadmin':
      case 'destination_admin':
        return 'Destination Admin';
      default:
        return role || 'Destination Admin';
    }
  }

  hasProfileChanges = computed(() => {
    const p = this.profile();
    const e = this.profileEditData();
    return e.firstName !== p.firstName ||
           e.lastName !== p.lastName ||
           e.email !== p.email;
  });
  
  hasPasswordChanges = computed(() => {
    const pw = this.passwordData();
    return pw.oldPassword.length > 0 ||
           pw.newPassword.length > 0 ||
           pw.confirmPassword.length > 0;
  });
}
