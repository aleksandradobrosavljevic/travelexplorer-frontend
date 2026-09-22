import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Auth } from '../../core/services/auth';
import { AuthState } from '../../core/services/auth-state.service';

@Component({
  selector: 'app-verify-email',
  imports: [CommonModule],
  templateUrl: './verify-email.html',
  styleUrl: './verify-email.css',
})
export class VerifyEmail implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(Auth);
  private readonly authState = inject(AuthState);

  readonly loading = signal(true);
  readonly success = signal(false);
  readonly title = signal('Verifying your email');
  readonly message = signal('Please wait while we confirm your account.');
  readonly role = signal('');

  private querySub?: Subscription;
  private redirectTimeout: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.querySub = this.route.queryParamMap.subscribe((params) => {
      const rawToken = params.get('token');
      const token = rawToken?.trim().replace(/ /g, '+') ?? null;

      this.loading.set(true);
      this.success.set(false);
      this.title.set('Verifying your email');
      this.message.set('Please wait while we confirm your account.');

      if (!token) {
        this.loading.set(false);
        this.success.set(false);
        this.title.set('Verification failed');
        this.message.set('Missing verification token.');
        return;
      }

      this.authService.verifyEmail(token).subscribe({
        next: (response: any) => {
          this.loading.set(false);
          this.success.set(true);
          this.role.set(response?.role ?? '');

          if (response?.role === 'Publisher') {
            this.title.set('Email verified');
            this.message.set('Your email has been verified. Your request is pending admin approval. You will be notified by email.');
          } else {
            this.title.set('Email verified');
            this.message.set(response?.message ?? 'Your account has been successfully verified. You can now sign in.');

            this.redirectTimeout = setTimeout(() => {
              this.router.navigate(['/login']);
            }, 2500);
          }

          if (this.authState.isLoggedIn()) {
            this.authService.logout();
          }
        },
        error: (error) => {
          this.loading.set(false);
          this.success.set(false);
          this.title.set('Verification failed');
          this.message.set(
            error?.error?.message ?? 'The verification link is invalid or has expired.'
          );
        },
      });
    });
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }

  ngOnDestroy(): void {
    this.querySub?.unsubscribe();
    if (this.redirectTimeout) {
      clearTimeout(this.redirectTimeout);
    }
  }
}