import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Role } from './models';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.user() ? true : inject(Router).createUrlTree(['/login']);
};

export const roleGuard = (...roles: Role[]): CanActivateFn => () => {
  const auth = inject(AuthService);
  const user = auth.user();
  if (!user) return inject(Router).createUrlTree(['/login']);
  return roles.includes(user.role) ? true : inject(Router).createUrlTree([auth.homeFor(user.role)]);
};
