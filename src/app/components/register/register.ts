import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';

import { Auth } from '../../core/services/auth';
import { HeaderComponent } from '../header/header';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import { PHONE_FORMAT_EXAMPLE, PHONE_FORMAT_HELPER, PHONE_PATTERN, sanitizePhoneInput } from '../../core/utils/phone-format';

interface SelectOption {
  label: string;
  value: number;
}

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
const NAME_PATTERN = /^[a-zA-ZšđčćžŠĐČĆŽ\s\-']+$/;
const ORGANIZATION_PATTERN = /^(?=.*[a-zA-ZšđčćžŠĐČĆŽ])[a-zA-ZšđčćžŠĐČĆŽ0-9\s\-().,']+$/;
const WEBSITE_PATTERN = /^(https?:\/\/)?([\w\-]+\.)+[\w]{2,}(\/.*)?$/;

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    HeaderComponent,
    InputTextModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    TranslatePipe
  ],
  templateUrl: './register.html',
  styleUrl: './register.css'
})
export class Register implements OnInit {
  readonly DESCRIPTION_MAX_LENGTH = 500;

  registerForm;
  showPassword = signal(false);
  isLoading = signal(false);
  publisherTypeOptions = signal<SelectOption[]>([]);
  destinationOptions = signal<SelectOption[]>([]);
  avatarPreview = signal<string | null>(null);
  readonly phonePlaceholder = PHONE_FORMAT_EXAMPLE;
  readonly phoneHelperText = PHONE_FORMAT_HELPER;
  private avatarFile: File | null = null;

  // Max date for date of birth: yesterday (must be in the past)
  readonly maxDateOfBirth: Date = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  })();

  // Default view when calendar opens: 25 years ago
  readonly defaultDateOfBirth: Date = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 25);
    return d;
  })();

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private toastr: ToastrService,
    private authService: Auth,
    private translation: TranslationService
  ) {
    this.registerForm = this.fb.group({
      role: ['tourist', Validators.required],

      firstName: ['', [Validators.required, Validators.minLength(2), Validators.pattern(NAME_PATTERN)]],
      lastName: ['', [Validators.required, Validators.minLength(2), Validators.pattern(NAME_PATTERN)]],
      dateOfBirth: [null as Date | null],

      organizationName: ['', [Validators.maxLength(100), Validators.pattern(ORGANIZATION_PATTERN)]],
      contactPerson: ['', [Validators.pattern(NAME_PATTERN)]],
      phone: ['', [Validators.pattern(PHONE_PATTERN)]],
      website: ['', [Validators.pattern(WEBSITE_PATTERN)]],
      description: ['', [Validators.maxLength(500)]],
      publisherTypeId: [null as number | null],
      destinationId: [null as number | null],

      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.pattern(PASSWORD_PATTERN)]],
      confirmPassword: ['', Validators.required]
    });
  }

  ngOnInit(): void {
    this.applyRoleValidators(this.roleControl.value ?? 'tourist');
    this.loadPublisherTypes();
    this.loadDestinations();
  }

  get roleControl(): AbstractControl {
    return this.registerForm.get('role')!;
  }

  get isPublisher(): boolean {
    return this.roleControl.value === 'publisher';
  }

  get descriptionLength(): number {
    return this.registerForm.get('description')?.value?.length ?? 0;
  }

  selectRole(role: 'tourist' | 'publisher'): void {
    this.roleControl.setValue(role);
    this.applyRoleValidators(role);
  }

  onPhoneInput(value: string): void {
    const control = this.registerForm.get('phone');
    const sanitized = sanitizePhoneInput(value);

    if (control && control.value !== sanitized) {
      control.setValue(sanitized, { emitEvent: false });
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword.set(!this.showPassword());
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }

  continueAsGuest(): void {
    this.router.navigate(['/']);
  }

  onAvatarSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.toastr.error('Please choose an image file.');
      return;
    }

    this.avatarFile = file;
    this.avatarPreview.set(URL.createObjectURL(file));
  }

  clearAvatar(): void {
    this.avatarFile = null;
    this.avatarPreview.set(null);
  }

  onSubmit(): void {
    this.registerForm.markAllAsTouched();

    const form = this.registerForm.getRawValue();

    if (!form.email) {
      this.toastr.error(this.translation.translate('auth.emailRequired'));
      return;
    }

    if (this.registerForm.get('email')?.errors?.['email']) {
      this.toastr.error(this.translation.translate('auth.emailInvalid'));
      return;
    }

    const password = form.password ?? '';
    const passwordInvalid =
      !password ||
      password.length < 8 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password) ||
      !/[^A-Za-z\d]/.test(password);

    if (passwordInvalid) {
      this.toastr.error(this.translation.translate('auth.passwordFormatError'));
      return;
    }

    if (form.password !== form.confirmPassword) {
      this.toastr.error(this.translation.translate('auth.passwordsDoNotMatch'));
      return;
    }

    if (!this.isPublisher) {
      if (!form.firstName || form.firstName.trim().length < 2) {
        this.toastr.error(this.translation.translate('auth.firstNameMinLength'));
        return;
      }

      if (this.registerForm.get('firstName')?.errors?.['pattern']) {
        this.toastr.error(this.translation.translate('auth.firstNameInvalid'));
        return;
      }

      if (!form.lastName || form.lastName.trim().length < 2) {
        this.toastr.error(this.translation.translate('auth.lastNameMinLength'));
        return;
      }

      if (this.registerForm.get('lastName')?.errors?.['pattern']) {
        this.toastr.error(this.translation.translate('auth.lastNameInvalid'));
        return;
      }

      // dateOfBirth is now a Date object from p-datepicker
      if (form.dateOfBirth) {
        const selectedDate = new Date(form.dateOfBirth);
        const today = new Date();

        today.setHours(0, 0, 0, 0);
        selectedDate.setHours(0, 0, 0, 0);

        if (selectedDate >= today) {
          this.toastr.error(this.translation.translate('auth.validDateOfBirth'));
          return;
        }

        const minAgeDate = new Date();
        minAgeDate.setFullYear(minAgeDate.getFullYear() - 13);
        minAgeDate.setHours(0, 0, 0, 0);

        if (selectedDate > minAgeDate) {
          this.toastr.error(this.translation.translate('auth.minimumAge'));
          return;
        }
      }

      // Format Date to ISO string (YYYY-MM-DD) for the API, or null
      const dateOfBirthForApi = form.dateOfBirth
        ? (form.dateOfBirth as Date).toISOString().split('T')[0]
        : null;

      const touristPayload = {
        role: 'tourist',
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: dateOfBirthForApi,
        email: form.email.trim(),
        password: form.password,
      };

      this.submitRegistration(touristPayload, this.translation.translate('auth.accountCreatedVerifyEmail'));
      return;
    }

    if (!form.organizationName?.trim()) {
      this.toastr.error(this.translation.translate('auth.organizationRequired'));
      return;
    }

    if (this.registerForm.get('organizationName')?.errors?.['pattern']) {
      this.toastr.error(this.translation.translate('auth.organizationInvalid'));
      return;
    }

    if (this.registerForm.get('organizationName')?.errors?.['maxlength']) {
      this.toastr.error(this.translation.translate('auth.organizationMaxLength'));
      return;
    }

    if (!form.contactPerson?.trim()) {
      this.toastr.error(this.translation.translate('auth.contactPersonRequired'));
      return;
    }

    if (this.registerForm.get('contactPerson')?.errors?.['pattern']) {
      this.toastr.error(this.translation.translate('auth.contactPersonInvalid'));
      return;
    }

    if (!form.phone?.trim()) {
      this.toastr.error(this.translation.translate('auth.phoneRequired'));
      return;
    }

    if (this.registerForm.get('phone')?.errors?.['pattern']) {
      this.toastr.error(this.translation.translate('auth.phoneInvalid'));
      return;
    }

    if (form.website?.trim() && this.registerForm.get('website')?.errors?.['pattern']) {
      this.toastr.error(this.translation.translate('auth.websiteInvalid'));
      return;
    }

    if (this.registerForm.get('description')?.errors?.['maxlength']) {
      this.toastr.error(this.translation.translate('auth.descriptionMaxLength'));
      return;
    }

    if (!form.publisherTypeId) {
      this.toastr.error(this.translation.translate('auth.publisherTypeRequired'));
      return;
    }

    if (!form.destinationId) {
      this.toastr.error(this.translation.translate('auth.destinationRequired'));
      return;
    }

    const publisherPayload = {
      role: 'publisher',
      organizationName: form.organizationName.trim(),
      contactPerson: form.contactPerson.trim(),
      phone: form.phone.trim(),
      website: form.website?.trim() || null,
      description: form.description?.trim() || null,
      publisherTypeId: form.publisherTypeId,
      destinationId: form.destinationId,
      email: form.email.trim(),
      password: form.password,
    };

    this.submitRegistration(publisherPayload, this.translation.translate('auth.publisherRequestSubmitted'));
  }

  private submitRegistration(payload: any, fallbackMessage: string): void {
    this.isLoading.set(true);

    const registerWithAvatar = (avatarUrl: string | null) => {
      this.authService.register({ ...payload, avatarUrl }).subscribe({
        next: () => {
          this.isLoading.set(false);
          this.toastr.success(fallbackMessage);
          this.router.navigate(['/']);
        },
        error: (error) => {
          this.isLoading.set(false);

          const message = error?.error?.message ?? '';
          const normalizedMessage = message.toLowerCase();

          if (normalizedMessage.includes('email je već u upotrebi') || normalizedMessage.includes('already in use')) {
            this.toastr.error(this.translation.translate('auth.emailAlreadyInUse'));
            return;
          }

          if (normalizedMessage.includes('verifikacioni email nije poslat') || normalizedMessage.includes('email was not sent')) {
            this.toastr.error(this.translation.translate('auth.accountCreatedEmailFailed'));
            return;
          }

          if (error.status === 400 || error.status === 401 || error.status === 409) {
            this.toastr.error(this.translation.translate('auth.registrationFailed'));
            return;
          }

          this.toastr.error(this.translation.translate('common.somethingWrongTryAgain'));
        }
      });
    };

    if (!this.avatarFile) {
      registerWithAvatar(null);
      return;
    }

    this.authService.uploadRegistrationAvatar(this.avatarFile).subscribe({
      next: (response: any) => {
        registerWithAvatar(response?.avatarUrl ?? response?.relativePath ?? response?.url ?? null);
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error('Profile photo could not be uploaded.');
      }
    });
  }

  private loadPublisherTypes(): void {
    this.authService.getPublisherTypes().subscribe({
      next: (types) => {
        this.publisherTypeOptions.set(types.map(type => ({
          label: this.formatPublisherTypeLabel(type.name),
          value: type.id
        })));
      },
      error: () => {
        this.toastr.error(this.translation.translate('auth.loadPublisherTypesError'));
      }
    });
  }

  private loadDestinations(): void {
    this.authService.getDestinations().subscribe({
      next: (destinations) => {
        this.destinationOptions.set(destinations.map(destination => ({
          label: destination.name,
          value: destination.id
        })));
      },
      error: () => {
        this.toastr.error(this.translation.translate('auth.loadDestinationsError'));
      }
    });
  }

  private formatPublisherTypeLabel(name: string): string {
    switch (name.trim().toLowerCase()) {
      case 'object':
        return this.translation.translate('auth.publisherForObjects');
      case 'activity':
        return this.translation.translate('auth.publisherForActivities');
      case 'event':
        return this.translation.translate('auth.publisherForEvents');
      default:
        return name;
    }
  }

  private applyRoleValidators(role: 'tourist' | 'publisher'): void {
    if (role === 'tourist') {
      this.setValidators('firstName', [Validators.required, Validators.minLength(2), Validators.pattern(NAME_PATTERN)]);
      this.setValidators('lastName', [Validators.required, Validators.minLength(2), Validators.pattern(NAME_PATTERN)]);

      ['organizationName', 'contactPerson', 'phone', 'website', 'description']
        .forEach(field => this.clearValidators(field, ''));

      ['publisherTypeId', 'destinationId']
        .forEach(field => this.clearValidators(field, null));
      return;
    }

    ['firstName', 'lastName', 'dateOfBirth']
      .forEach(field => this.clearValidators(field, ''));

    this.setValidators('organizationName', [Validators.required, Validators.maxLength(100), Validators.pattern(ORGANIZATION_PATTERN)]);
    this.setValidators('contactPerson', [Validators.required, Validators.pattern(NAME_PATTERN)]);
    this.setValidators('phone', [Validators.required, Validators.pattern(PHONE_PATTERN)]);
    this.setValidators('website', [Validators.pattern(WEBSITE_PATTERN)]);
    this.setValidators('description', [Validators.maxLength(500)]);
    this.setValidators('publisherTypeId', [Validators.required]);
    this.setValidators('destinationId', [Validators.required]);
  }

  private setValidators(controlName: string, validators: any[]): void {
    const control = this.registerForm.get(controlName);
    control?.setValidators(validators);
    control?.updateValueAndValidity({ emitEvent: false });
  }

  private clearValidators(controlName: string, resetValue?: any): void {
    const control = this.registerForm.get(controlName);
    control?.clearValidators();

    if (resetValue !== undefined) {
      control?.setValue(resetValue, { emitEvent: false });
    }

    control?.updateValueAndValidity({ emitEvent: false });
  }
}