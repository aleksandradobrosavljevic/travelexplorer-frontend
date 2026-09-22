import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ToastrService } from 'ngx-toastr';
import { Auth } from '../../core/services/auth';
import { buildApiUrl, buildAssetUrl } from '../../core/config/api';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import {
  PHONE_FORMAT_EXAMPLE,
  PHONE_FORMAT_HELPER,
  PHONE_INVALID_MESSAGE,
  isValidPhone,
  normalizePhone,
  sanitizePhoneInput
} from '../../core/utils/phone-format';

type UserField = 'firstName' | 'lastName' | 'email' | 'phone' | 'birthDate' | 'gender' | 'language';
type PasswordField = 'oldPassword' | 'newPassword' | 'confirmPassword';

interface ProfileForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthDate: string;
  gender: string;
  language: string;
}

interface PasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    ToggleSwitchModule,
    TranslatePipe
  ],
  templateUrl: './user-profile.html',
  styleUrl: './user-profile.css'
})
export class UserProfileComponent implements OnInit, OnDestroy {
  private readonly locationPreferenceKey = 'travelExplorer.locationEnabled';
  private readonly locationPromptSeenKey = 'travelExplorer.locationPromptSeen';
  private readonly locationPermissionDeniedKey = 'travelExplorer.locationPermissionDenied';
  private readonly locationPreferenceChangedEvent = 'travelExplorer.locationPreferenceChanged';

  @Output() close = new EventEmitter<void>();
  @Output() avatarChanged = new EventEmitter<string | null>();

  readonly isEditMode = signal(false);
  readonly isSaving = signal(false);
  readonly emailNotifications = signal(true);
  readonly tripReminders = signal(true);
  readonly dealsNotifications = signal(true);
  readonly locationEnabled = signal(false);
  readonly avatarUrl = signal<string | null>(null);
  readonly isUploadingAvatar = signal(false);
  readonly phonePlaceholder = PHONE_FORMAT_EXAMPLE;
  readonly phoneHelperText = PHONE_FORMAT_HELPER;

  readonly user = signal<ProfileForm>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    birthDate: '',
    gender: '',
    language: 'English'
  });

  readonly passwordData = signal<PasswordForm>({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  readonly avatarInitial = computed(() => this.user().firstName.trim().charAt(0).toUpperCase() || 'U');

  readonly genderOptions = computed(() => [
    { label: this.translation.translate('profile.genderFemale'), value: 'female' },
    { label: this.translation.translate('profile.genderMale'), value: 'male' },
    { label: this.translation.translate('profile.genderOther'), value: 'other' }
  ]);

  readonly languageOptions = computed(() => [
    { label: this.translation.translate('profile.languageEnglish'), value: 'English' },
    { label: this.translation.translate('profile.languageSerbian'), value: 'Serbian' }
  ]);

  constructor(
    private router: Router,
    private http: HttpClient,
    private toastr: ToastrService,
    private authService: Auth,
    private translation: TranslationService
  ) {}

  ngOnInit(): void {
    document.body.style.overflow = 'hidden';
    this.locationEnabled.set(localStorage.getItem(this.locationPreferenceKey) === 'true');
    this.loadProfile();
  }

  ngOnDestroy(): void {
    document.body.style.overflow = 'auto';
  }

  startEdit(): void {
    this.isEditMode.set(true);
  }

  cancelEdit(): void {
    this.closeEditMode();
    this.loadProfile();
  }

  updateUserField(field: UserField, value: string): void {
    const nextValue = field === 'phone' ? sanitizePhoneInput(value) : value ?? '';

    this.user.update((current) => ({
      ...current,
      [field]: nextValue
    }));

    if (field === 'language') {
      this.translation.use(value);
    }
  }

  updatePasswordField(field: PasswordField, value: string): void {
    this.passwordData.update((current) => ({
      ...current,
      [field]: value ?? ''
    }));
  }

  setEmailNotifications(value: boolean): void {
    this.emailNotifications.set(!!value);
  }

  setTripReminders(value: boolean): void {
    this.tripReminders.set(!!value);
  }

  setDealsNotifications(value: boolean): void {
    this.dealsNotifications.set(!!value);
  }

  setLocationEnabled(value: boolean): void {
    const enabled = !!value;
    this.locationEnabled.set(enabled);

    if (enabled) {
      localStorage.setItem(this.locationPreferenceKey, 'true');
      localStorage.setItem(this.locationPromptSeenKey, 'true');
      localStorage.removeItem(this.locationPermissionDeniedKey);
      this.emitLocationPreferenceChanged(true);
      return;
    }

    localStorage.removeItem(this.locationPreferenceKey);
    this.emitLocationPreferenceChanged(false);
  }

  saveChanges(): void {
    if (this.isSaving()) {
      return;
    }

    const passwordData = this.passwordData();
    const hasPasswordChange =
      !!passwordData.oldPassword ||
      !!passwordData.newPassword ||
      !!passwordData.confirmPassword;

    if (hasPasswordChange && !this.validatePasswordChange(passwordData)) {
      return;
    }

    const currentUser = this.user();
    const normalizedPhone = normalizePhone(currentUser.phone);

    if (!isValidPhone(normalizedPhone)) {
      this.toastr.error(PHONE_INVALID_MESSAGE);
      return;
    }

    this.user.update(user => ({ ...user, phone: normalizedPhone ?? '' }));
    const payload = {
      firstName: currentUser.firstName.trim(),
      lastName: currentUser.lastName.trim(),
      phone: normalizedPhone,
      gender: currentUser.gender.trim() || null,
      dateOfBirth: currentUser.birthDate || null,
      preferredLanguageId: currentUser.language === 'Serbian' ? 1 : 2,
      emailNotificationsEnabled: this.emailNotifications(),
      tripRemindersEnabled: this.tripReminders(),
      dealsRecommendationsEnabled: this.dealsNotifications()
    };

    this.isSaving.set(true);

    if (hasPasswordChange) {
      this.http.post(buildApiUrl('users/me/change-password'), {
        currentPassword: passwordData.oldPassword,
        newPassword: passwordData.newPassword
      }).subscribe({
        next: () => this.saveProfile(payload, true),
        error: (error) => {
          this.isSaving.set(false);
          this.toastr.error(error?.error?.message ?? 'Password could not be changed.');
        }
      });
      return;
    }

    this.saveProfile(payload, false);
  }

  closePanel(): void {
    this.close.emit();
  }

  signOut(): void {
    this.authService.logout().subscribe({
      next: () => {
        this.close.emit();
        this.router.navigate(['/login']);
      },
      error: () => {
        this.close.emit();
        this.router.navigate(['/login']);
      }
    });
  }

  uploadAvatar(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';

    if (!file || this.isUploadingAvatar()) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.toastr.error('Please choose an image file.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    this.isUploadingAvatar.set(true);

    this.http.post<any>(buildApiUrl('users/me/avatar'), formData).subscribe({
      next: (response) => {
        const nextAvatar = buildAssetUrl(response?.avatarUrl ?? response?.relativePath ?? response?.url) ?? null;
        this.avatarUrl.set(nextAvatar);
        this.avatarChanged.emit(nextAvatar);
        this.isUploadingAvatar.set(false);
        this.toastr.success('Profile photo updated.');
      },
      error: (error) => {
        this.isUploadingAvatar.set(false);
        this.toastr.error(error?.error?.message ?? 'Profile photo could not be updated.');
      }
    });
  }

  removeAvatar(): void {
    if (!this.avatarUrl() || this.isUploadingAvatar()) {
      return;
    }

    this.isUploadingAvatar.set(true);
    this.http.delete(buildApiUrl('users/me/avatar')).subscribe({
      next: () => {
        this.avatarUrl.set(null);
        this.avatarChanged.emit(null);
        this.isUploadingAvatar.set(false);
        this.toastr.success('Profile photo removed.');
      },
      error: (error) => {
        this.isUploadingAvatar.set(false);
        this.toastr.error(error?.error?.message ?? 'Profile photo could not be removed.');
      }
    });
  }

  private loadProfile(): void {
    this.http.get<any>(buildApiUrl('users/me')).subscribe({
      next: (response) => {
        const touristProfile = response.touristProfile ?? {};
        const language = this.resolveProfileLanguage(touristProfile.preferredLanguageId);

        this.user.set({
          firstName: response.firstName ?? '',
          lastName: response.lastName ?? '',
          email: response.email ?? '',
          phone: touristProfile.phone ?? '',
          birthDate: touristProfile.dateOfBirth ?? '',
          gender: touristProfile.gender ?? '',
          language
        });
        this.translation.use(language);

        this.emailNotifications.set(touristProfile.emailNotificationsEnabled ?? true);
        this.tripReminders.set(touristProfile.tripRemindersEnabled ?? true);
        this.dealsNotifications.set(touristProfile.dealsRecommendationsEnabled ?? true);
        this.avatarUrl.set(buildAssetUrl(response.avatarUrl ?? touristProfile.avatarUrl) ?? null);
      },
      error: () => {
        this.toastr.error(this.translation.translate('profile.loadError'));
      }
    });
  }

  displayGender(value: string): string {
    if (!value) return this.translation.translate('common.notSet');
    const option = this.genderOptions().find((item) => item.value === value);
    return option?.label ?? value;
  }

  displayLanguage(value: string): string {
    const option = this.languageOptions().find((item) => item.value === value);
    return option?.label ?? value;
  }

  statusLabel(value: boolean): string {
    return this.translation.translate(value ? 'common.enabled' : 'common.disabled');
  }

  private validatePasswordChange(passwordData: PasswordForm): boolean {
    if (!passwordData.oldPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      this.toastr.error(this.translation.translate('profile.passwordFillAll'));
      return false;
    }

    if (passwordData.newPassword.length < 8) {
      this.toastr.error(this.translation.translate('profile.passwordTooShort'));
      return false;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      this.toastr.error(this.translation.translate('profile.passwordMismatch'));
      return false;
    }

    if (passwordData.oldPassword === passwordData.newPassword) {
      this.toastr.error(this.translation.translate('profile.passwordSame'));
      return false;
    }

    return true;
  }

  private resetPasswordFields(): void {
    this.passwordData.set({
      oldPassword: '',
      newPassword: '',
      confirmPassword: ''
    });
  }

  private syncStoredUser(): void {
    const currentUser = this.user();
    this.translation.use(currentUser.language);
  }

  private resolveProfileLanguage(preferredLanguageId: unknown): string {
    const currentLanguage = this.translation.currentLanguage() === 'sr' ? 'Serbian' : 'English';
    const storedLanguage = localStorage.getItem('appLanguage') ?? localStorage.getItem('selectedLanguage');

    if (storedLanguage) {
      return currentLanguage;
    }

    const parsedLanguageId = Number(preferredLanguageId);

    if (parsedLanguageId === 1) {
      return 'Serbian';
    }

    if (parsedLanguageId === 2) {
      return 'English';
    }

    return this.translation.currentLanguage() === 'sr' ? 'Serbian' : 'English';
  }

  private emitLocationPreferenceChanged(enabled: boolean): void {
    window.dispatchEvent(new CustomEvent(this.locationPreferenceChangedEvent, { detail: enabled }));
  }

  private saveProfile(payload: Record<string, unknown>, passwordChanged: boolean): void {
    this.http.put(buildApiUrl('users/me'), payload).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.syncStoredUser();
        this.closeEditMode();
        this.toastr.success(
          passwordChanged
            ? this.translation.translate('profile.savePasswordSuccess')
            : this.translation.translate('profile.saveSuccess')
        );
      },
      error: (error) => {
        this.isSaving.set(false);
        this.toastr.error(error?.error?.message ?? this.translation.translate('profile.saveError'));
      }
    });
  }

  private closeEditMode(): void {
    this.isEditMode.set(false);
    this.resetPasswordFields();
  }
}
