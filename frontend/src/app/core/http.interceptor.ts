import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

/** Adds the demo identity header and turns every failure into a readable toast. */
export const httpInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const toast = inject(ToastService);
  const user = auth.user();

  const request = user ? req.clone({ setHeaders: { 'X-User-Id': String(user.id) } }) : req;

  return next(request).pipe(
    catchError((err: HttpErrorResponse) => {
      const silent = req.headers.has('X-Silent');
      const message =
        err.status === 0 ? "Can't reach the server. Is the backend running on port 5080?" :
        err.error?.error ?? err.error?.title ?? `Something went wrong (${err.status}).`;

      if (err.status === 401 && user && !req.url.includes('/auth/login')) {
        auth.signOut();
      } else if (!silent) {
        toast.error(message);
      }
      return throwError(() => err);
    })
  );
};
