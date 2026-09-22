import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { buildApiUrl } from '../config/api';
import { AuthState } from '../services/auth-state.service';
import { roleHomePath } from './role-home-guard';

export const roleGuard: CanActivateFn = (route, state) => {
  const authState = inject(AuthState);
  const router = inject(Router);
  const http = inject(HttpClient);

  const required = (route.data?.['role'] ?? '').toString().toLowerCase();
  const userRole = (authState.getUserRole() ?? '').toString().toLowerCase();

  const normalize = (r: string) => r === 'publisher' ? 'provider' : r;

  if (normalize(userRole) !== normalize(required)) {
    const homePath = roleHomePath(userRole);
    return homePath
      ? router.createUrlTree(homePath)
      : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }

  return http.get(buildApiUrl('users/me')).pipe(
    map(() => true),
    catchError(() => {
      authState.clearSession();
      return of(router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }));
    })
  );
};
