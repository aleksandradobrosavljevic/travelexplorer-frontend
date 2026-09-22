import { Component, EventEmitter, OnDestroy, OnInit, Output, signal, computed, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { SelectModule } from 'primeng/select';
import { Auth } from '../../core/services/auth';
import { buildApiUrl, buildAssetUrl } from '../../core/config/api';
import { PublisherContentService } from '../../services/publisher-content.service';
import { TranslationService } from '../../core/i18n/translation.service';
import { switchMap } from 'rxjs/operators';
import {
  PHONE_FORMAT_EXAMPLE,
  PHONE_FORMAT_HELPER,
  PHONE_INVALID_MESSAGE,
  isValidPhone,
  normalizePhone,
  sanitizePhoneInput
} from '../../core/utils/phone-format';

type PasswordField = 'oldPassword' | 'newPassword' | 'confirmPassword';

@Component({
  selector: 'app-publisher-profile-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, SelectModule],
  templateUrl: './publisher-profile-panel.html',
  styleUrl: './publisher-profile-panel.css'
})
export class PublisherProfilePanelComponent implements OnInit, OnDestroy {

  @Output() close = new EventEmitter<void>();
  @Output() avatarChanged = new EventEmitter<string | null>();
  @ViewChild('passwordSection') passwordSectionRef!: ElementRef;
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  readonly DESCRIPTION_MAX_LENGTH = 1000;

  isLoading = signal(true);
  isEditMode = signal(false);
  isSaving = signal(false);
  isUploadingPhoto = signal(false);
  readonly phonePlaceholder = PHONE_FORMAT_EXAMPLE;
  readonly phoneHelperText = PHONE_FORMAT_HELPER;
  readonly websitePlaceholder = 'https://example.com';

  avatarUrl = signal<string | null>(null);

  profile = signal({
    organizationName: '',
    contactPerson: '',
    phone: '',
    website: '',
    description: '',
    language: 'English'
  });

  editForm = signal({
    organizationName: '',
    contactPerson: '',
    phone: '',
    website: '',
    description: '',
    language: 'English'
  });

  passwordData = signal({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  stats = signal({
    totalContent: 0,
    approvedContent: 0,
    avgRating: 0,
    mostReviewed: '—'
  });

  initials = computed(() => {
    const name = this.profile().organizationName;
    if (!name) return '?';
    return name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
  });

  private _languageAtEditOpen = 'English';

  hasProfileChanges = computed(() => {
    const e = this.editForm();
    const p = this.profile();
    return (
      e.organizationName !== p.organizationName ||
      e.contactPerson !== p.contactPerson ||
      e.phone !== p.phone ||
      e.website !== p.website ||
      e.description !== p.description ||
      e.language !== this._languageAtEditOpen
    );
  });

  hasPasswordChanges = computed(() =>
    !!this.passwordData().oldPassword ||
    !!this.passwordData().newPassword ||
    !!this.passwordData().confirmPassword
  );

  hasChanges = computed(() => this.hasProfileChanges() || this.hasPasswordChanges());

  readonly languageOptions = [
    { label: 'English', value: 'English' },
    { label: 'Serbian', value: 'Serbian' }
  ];

  constructor(
    private readonly publisherContentService: PublisherContentService,
    private readonly http: HttpClient,
    private readonly toastr: ToastrService,
    private readonly authService: Auth,
    private readonly router: Router,
    private readonly translation: TranslationService
  ) {}

  ngOnInit(): void {
    document.body.style.overflow = 'hidden';
    this.loadProfile();
  }

  ngOnDestroy(): void {
    document.body.style.overflow = 'auto';
  }

  closePanel(): void {
    this.close.emit();
  }

  startEdit(): void {
    this.editForm.set({ ...this.profile() });
    this._languageAtEditOpen = this.profile().language;
    this.resetPasswordFields();
    this.isEditMode.set(true);
  }

  startEditAndScrollToPassword(): void {
    this.startEdit();
    setTimeout(() => {
      this.passwordSectionRef?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  cancelEdit(): void {
    this.isEditMode.set(false);
    this.resetPasswordFields();
  }

  updateField(field: string, value: string): void {
    if (field === 'description') {
      value = value.slice(0, this.DESCRIPTION_MAX_LENGTH);
    }
    const nextValue = field === 'phone' ? sanitizePhoneInput(value) : value;
    this.editForm.update(f => ({ ...f, [field]: nextValue }));
    if (field === 'language') {
      this.translation.use(value);
    }
  }

  updatePasswordField(field: PasswordField, value: string): void {
    this.passwordData.update(p => ({ ...p, [field]: value }));
  }

  triggerFileInput(): void {
    this.fileInputRef?.nativeElement?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.toastr.error('Please select an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.toastr.error('Image must be smaller than 5MB.');
      return;
    }

    input.value = '';

    const formData = new FormData();
    formData.append('file', file);
    this.isUploadingPhoto.set(true);

    this.http.post<any>(buildApiUrl('users/me/avatar'), formData).subscribe({
      next: (res) => {
        const avatarUrl = buildAssetUrl(res?.avatarUrl ?? res?.relativePath ?? res?.url) ?? null;
        this.avatarUrl.set(avatarUrl);
        this.publisherContentService.invalidateUserCache();
        this.avatarChanged.emit(avatarUrl);
        this.isUploadingPhoto.set(false);
        this.toastr.success('Profile photo updated.');
      },
      error: () => {
        this.isUploadingPhoto.set(false);
        this.toastr.error('Could not upload photo.');
      }
    });
  }

  removeAvatar(): void {
    if (!this.avatarUrl() || this.isUploadingPhoto()) return;

    this.isUploadingPhoto.set(true);
    this.http.delete(buildApiUrl('users/me/avatar')).subscribe({
      next: () => {
        this.avatarUrl.set(null);
        this.publisherContentService.invalidateUserCache();
        this.avatarChanged.emit(null);
        this.isUploadingPhoto.set(false);
        this.toastr.success('Profile photo removed.');
      },
      error: () => {
        this.isUploadingPhoto.set(false);
        this.toastr.error('Could not remove photo.');
      }
    });
  }

  saveChanges(): void {
    if (this.isSaving()) return;

    const pw = this.passwordData();
    const hasPasswordChange = this.hasPasswordChanges();

    if (hasPasswordChange && !this.validatePassword(pw)) return;
    const normalizedPhone = normalizePhone(this.editForm().phone);

    if (!isValidPhone(normalizedPhone)) {
      this.toastr.error(PHONE_INVALID_MESSAGE);
      return;
    }

    this.editForm.update(f => ({ ...f, phone: normalizedPhone ?? '' }));
    this.isSaving.set(true);

    const doSaveProfile = () => {
      const payload = {
        organizationName: this.editForm().organizationName,
        contactPerson: this.editForm().contactPerson,
        phone: normalizedPhone,
        website: this.editForm().website,
        description: this.editForm().description,
        preferredLanguageId: this.editForm().language === 'Serbian' ? 1 : 2
      };

      this.http.put(buildApiUrl('users/me'), payload).subscribe({
        next: () => {
          this.profile.set({ ...this.editForm() });
          this._languageAtEditOpen = this.editForm().language;
          this.isEditMode.set(false);
          this.isSaving.set(false);
          this.resetPasswordFields();
          this.toastr.success('Profile updated successfully.');
        },
        error: () => {
          this.isSaving.set(false);
          this.toastr.error('Could not update profile.');
        }
      });
    };

    if (hasPasswordChange) {
      this.http.post(buildApiUrl('users/me/change-password'), {
        currentPassword: pw.oldPassword,
        newPassword: pw.newPassword
      }).subscribe({
        next: () => doSaveProfile(),
        error: (err) => {
          this.isSaving.set(false);
          this.toastr.error(err?.error?.message ?? 'Password could not be changed.');
        }
      });
      return;
    }

    doSaveProfile();
  }

  signOut(): void {
    const goToLogin = () => {
      this.close.emit();
      window.location.assign('/login');
    };
    this.authService.logout().subscribe({ next: goToLogin, error: goToLogin });
  }

  private validatePassword(pw: { oldPassword: string; newPassword: string; confirmPassword: string }): boolean {
    if (!pw.oldPassword || !pw.newPassword || !pw.confirmPassword) {
      this.toastr.error('Please fill in all password fields.');
      return false;
    }
    if (pw.newPassword.length < 8) {
      this.toastr.error('New password must be at least 8 characters.');
      return false;
    }
    if (pw.newPassword !== pw.confirmPassword) {
      this.toastr.error('Passwords do not match.');
      return false;
    }
    if (pw.oldPassword === pw.newPassword) {
      this.toastr.error('New password must be different from the current one.');
      return false;
    }
    return true;
  }

  private resetPasswordFields(): void {
    this.passwordData.set({ oldPassword: '', newPassword: '', confirmPassword: '' });
  }

  private resolveProfileLanguage(preferredLanguageId: unknown): string {
    const currentLanguage = this.translation.currentLanguage() === 'sr' ? 'Serbian' : 'English';
    const storedLanguage = localStorage.getItem('appLanguage') ?? localStorage.getItem('selectedLanguage');

    if (storedLanguage) {
      return currentLanguage;
    }

    const parsedLanguageId = Number(preferredLanguageId);
    if (parsedLanguageId === 1) return 'Serbian';
    if (parsedLanguageId === 2) return 'English';

    return this.translation.currentLanguage() === 'sr' ? 'Serbian' : 'English';
  }

  private loadProfile(): void {
    this.isLoading.set(true);

    this.publisherContentService.getUserProfile().pipe(
      switchMap((userProfile: any) => {
        const lang = this.resolveProfileLanguage(userProfile?.preferredLanguageId);
        this.profile.set({
          organizationName: userProfile?.publisherProfile?.organizationName ?? '',
          contactPerson: userProfile?.publisherProfile?.contactPerson ?? '',
          phone: userProfile?.publisherProfile?.phone ?? '',
          website: userProfile?.publisherProfile?.website ?? '',
          description: userProfile?.publisherProfile?.description ?? '',
          language: lang
        });
        this.translation.use(lang);
        this.avatarUrl.set(buildAssetUrl(userProfile?.avatarUrl) ?? null);
        return this.http.get<any>(buildApiUrl('users/me/stats'));
      })
    ).subscribe({
      next: (stats) => {
        this.stats.set({
          totalContent: stats.totalContent,
          approvedContent: stats.approvedContent,
          avgRating: stats.avgRating,
          mostReviewed: stats.mostReviewed
        });
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error('Could not load profile.');
      }
    });
  }
}
