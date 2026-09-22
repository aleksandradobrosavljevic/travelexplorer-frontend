import { HttpBackend, HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject, NgZone } from '@angular/core';
import { catchError, finalize, Observable, shareReplay, switchMap, throwError } from 'rxjs';
import { buildApiUrl } from '../config/api';
import { Router } from '@angular/router';
import { AuthState } from '../services/auth-state.service';
import { ToastrService } from 'ngx-toastr';

let refreshRequest$: Observable<any> | null = null;
let lastSessionFailureToastAt = 0;
let isRedirectingToLogin = false;
const ACCESS_DENIED_TITLE = 'Access denied';
const TOKEN_REFRESH_SKEW_SECONDS = 30;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const http = new HttpClient(inject(HttpBackend));
  const router = inject(Router);
  const authState = inject(AuthState);
  const toastr = inject(ToastrService);
  const zone = inject(NgZone);
  const localizedReq = withLanguage(req);

  const isAuthRequest = req.url.includes('/auth/login')
    || req.url.includes('/auth/refresh')
    || req.url.includes('/auth/register')
    || req.url.includes('/auth/verify-email')
    || req.url.includes('/auth/resend-verification')
    || req.url.includes('/auth/forgot-password')
    || req.url.includes('/auth/reset-password');

  if (isAuthRequest) {
    return next(localizedReq);
  }

  const token = authState.getAccessToken();

  if (!token) {
    return next(localizedReq);
  }

  if (isJwtExpiring(token)) {
    return refreshAccessToken(http).pipe(
      catchError((refreshError) => handleRefreshFailure(router, authState, toastr, zone, refreshError)),
      switchMap((response) => {
        authState.setSession(response.accessToken, {
          email: response.email ?? '',
          role: response.role ?? '',
          firstName: response.firstName ?? '',
          lastName: response.lastName ?? '',
          destinationId: response.destinationId ?? null,
        });
        return next(withAuthorization(localizedReq, response.accessToken));
      })
    );
  }

  return next(withAuthorization(localizedReq, token)).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 403) {
          const isApiCall = !req.url.includes('/auth/');
      if (isApiCall) {
        return throwError(() => error);
      }
      endSessionAndRedirect(router, authState, toastr, zone, error);
      return throwError(() => error);
      }

      if (error.status !== 401) {
        return throwError(() => error);
      }

      return refreshAccessToken(http).pipe(
        catchError((refreshError) => handleRefreshFailure(router, authState, toastr, zone, refreshError)),
        switchMap((response) => {
          authState.setSession(response.accessToken, {
            email: response.email ?? '',
            role: response.role ?? '',
            firstName: response.firstName ?? '',
            lastName: response.lastName ?? '',
            destinationId: response.destinationId ?? null,
          });
          return next(withAuthorization(localizedReq, response.accessToken));
        })
      );
    })
  );
};

function refreshAccessToken(http: HttpClient): Observable<any> {
  if (!refreshRequest$) {
    refreshRequest$ = http.post<any>(
      buildApiUrl('auth/refresh'),
      {},
      {
        withCredentials: true,
        headers: { 'Accept-Language': getSelectedLanguageHeader() }
      }
    ).pipe(
      shareReplay(1),
      finalize(() => { refreshRequest$ = null; })
    );
  }
  return refreshRequest$;
}

function withLanguage<T>(req: HttpRequest<T>): HttpRequest<T> {
  return req.clone({
    setHeaders: { 'Accept-Language': getSelectedLanguageHeader() }
  });
}

function withAuthorization<T>(req: HttpRequest<T>, token: string): HttpRequest<T> {
  return req.clone({
    setHeaders: { Authorization: `Bearer ${token}` }
  });
}

function getSelectedLanguageHeader(): string {
  const language = (
    localStorage.getItem('appLanguage')
    ?? localStorage.getItem('selectedLanguage')
    ?? 'en'
  ).trim().toLowerCase();

  return language.startsWith('sr') || language.includes('serbian') ? 'sr' : 'en';
}

function handleRefreshFailure(
  router: Router,
  authState: AuthState,
  toastr: ToastrService,
  zone: NgZone,
  error: unknown
): Observable<never> {
  endSessionAndRedirect(router, authState, toastr, zone, error);
  return throwError(() => error);
}

function endSessionAndRedirect(
  router: Router,
  authState: AuthState,
  toastr: ToastrService,
  zone: NgZone,
  error: unknown
): void {
  authState.clearSession();
  showSessionFailureMessage(toastr, error);

  if (isRedirectingToLogin) {
    return;
  }

  isRedirectingToLogin = true;
  setTimeout(() => {
    zone.run(() => {
      router.navigateByUrl('/login', { replaceUrl: true }).finally(() => {
        isRedirectingToLogin = false;
      });
    });
  }, 0);
}

function showSessionFailureMessage(
  toastr: ToastrService,
  error: unknown
): void {
  const rawMessage = getErrorMessage(error);
  const message = rawMessage.toLowerCase();
  const now = Date.now();

  if (now - lastSessionFailureToastAt < 3000) {
    return;
  }

  if (message.includes('destination admin account has been deactivated')) {
    lastSessionFailureToastAt = now;
    toastr.error(
      rawMessage || 'Your destination admin account has been deactivated. Please contact the system administrator.',
      ACCESS_DENIED_TITLE,
      { timeOut: 7000 }
    );
    return;
  }

  if (message.includes('account has been suspended') || message.includes('suspended')) {
    lastSessionFailureToastAt = now;
    toastr.error(
      rawMessage || 'Your account has been suspended. Please contact support.',
      ACCESS_DENIED_TITLE,
      { timeOut: 7000 }
    );
    return;
  }

  if (message.includes('deaktiviran') || message.includes('deactivated')) {
    lastSessionFailureToastAt = now;
    toastr.error(
      rawMessage || 'Account is deactivated.',
      ACCESS_DENIED_TITLE,
      { timeOut: 7000 }
    );
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    return String(error.error?.message ?? error.message ?? '');
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '';
}

function isJwtExpiring(token: string): boolean {
  const expiration = getJwtExpiration(token);
  if (!expiration) return false;
  const now = Math.floor(Date.now() / 1000);
  return expiration <= now + TOKEN_REFRESH_SKEW_SECONDS;
}

function getJwtExpiration(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(normalized));
    const exp = Number(decoded?.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}
