import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthState } from '../services/auth-state.service';

export function roleHomePath(role: string | null | undefined): string[] | null {
  switch ((role ?? '').toString().trim().toLowerCase()) {
    case 'tourist':
      return ['/tourist-dashboard'];
    case 'provider':
    case 'publisher':
      return ['/publisher-my-content'];
    case 'admin':
      return ['/admin-destination/dashboard'];
    case 'super_admin':
    case 'superadmin':
      return ['/super-admin/analytics'];
    default:
      return null;
  }
}

export const roleHomeGuard: CanActivateFn = () => {
  const authState = inject(AuthState);
  const router = inject(Router);
  const homePath = roleHomePath(authState.getUserRole());

  return homePath ? router.createUrlTree(homePath) : true;
};
