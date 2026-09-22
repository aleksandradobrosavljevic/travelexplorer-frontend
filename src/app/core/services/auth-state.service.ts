import { Injectable, signal, computed } from '@angular/core';
import { setAssetAccessToken } from '../config/api';

export interface UserProfile {
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  destinationId?: number | null;
}

@Injectable({ providedIn: 'root' })
export class AuthState {
  private readonly _accessToken = signal<string | null>(null);
  private readonly _currentUser = signal<UserProfile | null>(null);

  readonly user = this._currentUser.asReadonly();
  readonly isLoggedIn = computed(() => this._accessToken() !== null);

  getAccessToken(): string | null {
    return this._accessToken();
  }

  getUserRole(): string | null {
    return this._currentUser()?.role ?? null;
  }

  getCurrentUser(): UserProfile | null {
    return this._currentUser();
  }

  setSession(accessToken: string, user: UserProfile): void {
    this._accessToken.set(accessToken);
    this._currentUser.set(user);
    setAssetAccessToken(accessToken);
  }

  clearSession(): void {
    this._accessToken.set(null);
    this._currentUser.set(null);
    setAssetAccessToken(null);
  }
}
