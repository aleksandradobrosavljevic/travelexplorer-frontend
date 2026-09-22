import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import { AuthState } from '../../core/services/auth-state.service';
import { Auth } from '../../core/services/auth';
import { HeaderComponent } from '../header/header';

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    HeaderComponent,
    InputTextModule,
    ButtonModule,
    TranslatePipe
  ],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly toastr = inject(ToastrService);
  private readonly auth = inject(Auth);
  private readonly authState = inject(AuthState);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly translation = inject(TranslationService);

  readonly loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.pattern(PASSWORD_PATTERN)]],
  });

  readonly showPassword = signal(false);
  readonly isLoading = signal(false);
  readonly canResendVerification = signal(false);
  readonly resendLoading = signal(false);

  togglePasswordVisibility(): void {
    this.showPassword.update(value => !value);
  }

  goToRegister(): void {
    this.router.navigate(['/register']);
  }

  continueAsGuest(): void {
    this.router.navigate(['/']);
  }

  onSubmit(): void {
    this.loginForm.markAllAsTouched();

    if (this.loginForm.invalid) {
      const emailErrors = this.loginForm.get('email')?.errors;
      const passwordErrors = this.loginForm.get('password')?.errors;

      if (emailErrors?.['required']) {
        this.toastr.error(this.translation.translate('auth.emailRequired'));
        return;
      }

      if (emailErrors?.['email']) {
        this.toastr.error(this.translation.translate('auth.emailInvalid'));
        return;
      }

      if (passwordErrors?.['required'] || passwordErrors?.['minlength'] || passwordErrors?.['pattern']) {
        this.toastr.error(this.translation.translate('auth.passwordFormatError'));
        return;
      }

      return;
    }

    this.isLoading.set(true);
    this.canResendVerification.set(false);

    this.auth.login(
      this.loginForm.value.email ?? '',
      this.loginForm.value.password ?? ''
    ).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.canResendVerification.set(false);
        this.resendLoading.set(false);
        this.toastr.success(this.translation.translate('auth.loginSuccess'));
        this.navigateByRole();
      },
      error: (error) => {
        this.isLoading.set(false);
        this.canResendVerification.set(false);

        const message = error?.error?.message ?? '';
        const normalizedMessage = message.toLowerCase();

        if (error.status === 401) {
          if (normalizedMessage.includes('nije verifikovana') || normalizedMessage.includes('not verified')) {
            this.canResendVerification.set(true);
            this.toastr.error(this.translation.translate('auth.emailNotVerified'));
            return;
          }

          if (normalizedMessage.includes('eka odobrenje') || normalizedMessage.includes('pending')) {
            this.toastr.error(this.translation.translate('auth.pendingApproval'));
            return;
          }

          if (normalizedMessage.includes('destination admin account has been deactivated')) {
            this.toastr.error(this.translation.translate('auth.destinationAdminDeactivated'), this.translation.translate('auth.accessDenied'), { timeOut: 7000 });
            return;
          }

          if (normalizedMessage.includes('account has been suspended') || normalizedMessage.includes('suspended')) {
            this.toastr.error(this.translation.translate('auth.accountSuspended'), this.translation.translate('auth.accessDenied'), { timeOut: 7000 });
            return;
          }

          if (normalizedMessage.includes('deaktiviran') || normalizedMessage.includes('deactivated')) {
            this.toastr.error(this.translation.translate('auth.accountDeactivated'), this.translation.translate('auth.accessDenied'), { timeOut: 7000 });
            return;
          }

          if (normalizedMessage.includes('pogrešan email') || normalizedMessage.includes('pogresan email') || normalizedMessage.includes('invalid')) {
            this.toastr.error(this.translation.translate('auth.invalidCredentials'));
            return;
          }

          // Fallback za sve ostale 401 poruke
          this.toastr.error(this.translation.translate('auth.invalidCredentials'));
          return;
        }

        this.toastr.error(this.translation.translate('auth.loginFailed'));
      },
    });
  }

  resendVerificationEmail(): void {
    const email = this.loginForm.get('email')?.value?.trim();
    if (!email) {
      this.toastr.error(this.translation.translate('auth.enterEmailFirst'));
      return;
    }

    this.resendLoading.set(true);
    this.auth.resendVerificationEmail(email).subscribe({
      next: () => {
        this.resendLoading.set(false);
        this.toastr.success(this.translation.translate('auth.verificationEmailSent'));
      },
      error: (error) => {
        this.resendLoading.set(false);
        this.toastr.error(this.translation.translate('auth.verificationEmailFailed'));
      },
    });
  }

  private navigateByRole(): void {
    const returnUrl = this.getSafeReturnUrl();
    if (returnUrl) {
      this.router.navigateByUrl(returnUrl);
      return;
    }

    switch (this.authState.getUserRole()) {
      case 'tourist':
        this.router.navigate(['/tourist-dashboard']);
        break;
      case 'provider':
        this.router.navigate(['/publisher-my-content']);
        break;
      case 'admin':
        this.router.navigate(['/admin-destination/dashboard']);
        break;
      case 'super_admin':
        this.router.navigate(['/super-admin/analytics']);
        break;
      default:
        this.router.navigate(['/']);
        break;
    }
  }

  private getSafeReturnUrl(): string | null {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl')?.trim();
    if (!returnUrl || !returnUrl.startsWith('/') || returnUrl.startsWith('//')) {
      return null;
    }

    return returnUrl === '/login' || returnUrl === '/register' ? null : returnUrl;
  }
}