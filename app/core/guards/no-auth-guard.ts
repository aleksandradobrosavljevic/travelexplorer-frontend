import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthState } from '../services/auth-state.service';
import { roleHomePath } from './role-home-guard';

export const noAuthGuard: CanActivateFn = () => {
  const authState = inject(AuthState);
  const router = inject(Router);

  if (!authState.isLoggedIn()) return true;

  const homePath = roleHomePath(authState.getUserRole());
  return router.createUrlTree(homePath ?? ['/']);
};
