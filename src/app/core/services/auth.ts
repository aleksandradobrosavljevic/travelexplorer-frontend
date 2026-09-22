import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable, of } from 'rxjs';
import { tap, map, catchError, expand, reduce } from 'rxjs/operators';
import { buildApiUrl } from '../config/api';
import { AuthState } from './auth-state.service';
import { TranslationService } from '../i18n/translation.service';

export interface RegisterFormData {
  role?: 'tourist' | 'publisher' | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  preferredLanguageId?: number | null;
  organizationName?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  website?: string | null;
  description?: string | null;
  publisherTypeId?: number | null;
  destinationId?: number | null;
  email?: string | null;
  password?: string | null;
  confirmPassword?: string | null;
  avatarUrl?: string | null;
}

export interface RegisterDestination {
  id: number;
  name: string;
}

interface AuthApiResponse {
  accessToken: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  destinationId?: number | null;
}

const SESSION_FLAG_KEY = 'has_session';

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly state = inject(AuthState);
  private readonly translation = inject(TranslationService);
  private readonly apiUrl = buildApiUrl();

  private normalizeRole(role: string | null | undefined): string {
    switch ((role ?? '').trim().toLowerCase()) {
      case 'tourist':    return 'tourist';
      case 'publisher':  return 'provider';
      case 'admin':      return 'admin';
      case 'superadmin': return 'super_admin';
      default:           return (role ?? '').trim().toLowerCase();
    }
  }

  private applySession(response: AuthApiResponse): void {
    this.state.setSession(response.accessToken, {
      email: response.email ?? '',
      role: this.normalizeRole(response.role),
      firstName: response.firstName ?? '',
      lastName: response.lastName ?? '',
      destinationId: response.destinationId ?? null,
    });
    localStorage.setItem(SESSION_FLAG_KEY, '1');
  }

  getAccessToken(): string | null {
    return this.state.getAccessToken();
  }

  getUserRole(): string | null {
    return this.state.getUserRole();
  }

  isLoggedIn(): boolean {
    return this.state.isLoggedIn();
  }

  getCurrentUser() {
    return this.state.getCurrentUser();
  }

  initialize(): Observable<void> {
    if (!localStorage.getItem(SESSION_FLAG_KEY)) {
      this.state.clearSession();
      return of(void 0);
    }

    return this.http
      .post<AuthApiResponse>(`${this.apiUrl}/auth/refresh`, {}, { withCredentials: true })
      .pipe(
        tap(response => this.applySession(response)),
        map(() => void 0),
        catchError(() => {
          localStorage.removeItem(SESSION_FLAG_KEY);
          this.state.clearSession();
          this.translation.use('en');
          return of(void 0);
        })
      );
  }

  login(email: string, password: string): Observable<void> {
    return this.http
      .post<AuthApiResponse>(`${this.apiUrl}/auth/login`, { email, password }, { withCredentials: true })
      .pipe(
        tap(response => this.applySession(response)),
        map(() => void 0)
      );
  }

  logout(): Observable<void> {
    return this.http
      .post<void>(`${this.apiUrl}/auth/logout`, {}, { withCredentials: true })
      .pipe(
        tap(() => {
          this.state.clearSession();
          localStorage.removeItem(SESSION_FLAG_KEY);
          this.translation.use('en');
        }),
        catchError(() => {
          this.state.clearSession();
          localStorage.removeItem(SESSION_FLAG_KEY);
          this.translation.use('en');
          return of(void 0);
        }),
        map(() => void 0)
      );
  }

  register(data: RegisterFormData): Observable<any> {
    if (data.role === 'publisher') {
      return this.http.post(`${this.apiUrl}/auth/register/publisher`, {
        email: data.email ?? '',
        password: data.password ?? '',
        organizationName: data.organizationName ?? '',
        contactPerson: data.contactPerson ?? '',
        phone: data.phone ?? '',
        website: data.website?.trim() || null,
        description: data.description?.trim() || null,
        publisherTypeId: data.publisherTypeId ?? 0,
        destinationId: data.destinationId ?? 0,
        avatarUrl: data.avatarUrl ?? null,
      });
    }

    return this.http.post(`${this.apiUrl}/auth/register/tourist`, {
      email: data.email ?? '',
      password: data.password ?? '',
      firstName: data.firstName ?? '',
      lastName: data.lastName ?? '',
      dateOfBirth: data.dateOfBirth || null,
      preferredLanguageId: data.preferredLanguageId ?? 1,
      avatarUrl: data.avatarUrl ?? null,
    });
  }

  uploadRegistrationAvatar(file: File): Observable<{ avatarUrl?: string; relativePath?: string; url?: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ avatarUrl?: string; relativePath?: string; url?: string }>(
      `${this.apiUrl}/images/upload-registration-avatar`,
      formData
    );
  }

  verifyEmail(token: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/auth/verify-email`, {
      params: { token: token.trim().replace(/ /g, '+') }
    });
  }

  resendVerificationEmail(email: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/auth/resend-verification`, {
      email: email.trim()
    });
  }

  getPublisherTypes(): Observable<{ id: number; name: string }[]> {
    return this.http.get<{ id: number; name: string }[]>(`${this.apiUrl}/publisher-types`);
  }

  getDestinations(): Observable<RegisterDestination[]> {
    return this.getDestinationPage(1, 50).pipe(
      expand(result => result.rows.length === 50 ? this.getDestinationPage(result.page + 1, 50) : EMPTY),
      reduce((rows, result) => [...rows, ...result.rows], [] as RegisterDestination[]),
      map(destinations => destinations.map(d => ({ id: d.id, name: d.name })))
    );
  }

  private getDestinationPage(page: number, pageSize: number): Observable<{ page: number; rows: RegisterDestination[] }> {
    return this.http
      .get<any>(`${this.apiUrl}/destinations?page=${page}&pageSize=${pageSize}`)
      .pipe(
        map(response => ({
          page,
          rows: Array.isArray(response) ? response : response?.items ?? response?.data ?? []
        }))
      );
  }
}
