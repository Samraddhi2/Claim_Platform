import { HttpClient, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OFFICER } from '../../testing/fixtures';
import { AuthService } from './auth.service';
import { httpInterceptor } from './http.interceptor';
import { ToastService } from './toast.service';

describe('httpInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let auth: AuthService;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    localStorage.removeItem('claims.user');
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'dismiss']);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([httpInterceptor])),
        provideHttpClientTesting(),
        { provide: ToastService, useValue: toast },
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => { ctrl.verify(); localStorage.removeItem('claims.user'); });

  /** Fires a GET and swallows the expected rejection so only the side effects are asserted. */
  function failWith(status: number, body: object | null, url = '/api/claims', options: { headers?: HttpHeaders } = {}) {
    let caught: unknown;
    http.get(url, options).subscribe({ error: e => (caught = e) });
    ctrl.expectOne(url).flush(body, { status, statusText: 'x' });
    return caught as { status: number } | undefined;
  }

  describe('identity header', () => {
    it('adds X-User-Id once someone is signed in', () => {
      auth.signIn(OFFICER);
      http.get('/api/claims').subscribe();
      expect(ctrl.expectOne('/api/claims').request.headers.get('X-User-Id')).toBe(String(OFFICER.id));
    });

    it('sends no identity header while signed out', () => {
      http.get('/api/users').subscribe();
      expect(ctrl.expectOne('/api/users').request.headers.has('X-User-Id')).toBeFalse();
    });

    it('passes successful responses through untouched', () => {
      let result: unknown;
      http.get('/api/users').subscribe(r => (result = r));
      ctrl.expectOne('/api/users').flush([{ id: 1 }]);
      expect(result).toEqual([{ id: 1 }]);
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe('error toasts', () => {
    it('explains a dead backend (status 0)', () => {
      let err: unknown;
      http.get('/api/users').subscribe({ error: e => (err = e) });
      ctrl.expectOne('/api/users').error(new ProgressEvent('error'));
      expect(toast.error).toHaveBeenCalledWith("Can't reach the server. Is the backend running on port 5080?");
      expect(err).toBeTruthy();
    });

    it('prefers the API\'s { error } message', () => {
      failWith(409, { error: 'A claim in \'Submitted\' cannot move to \'Approved\'.' });
      expect(toast.error).toHaveBeenCalledWith("A claim in 'Submitted' cannot move to 'Approved'.");
    });

    it('falls back to a ProblemDetails title', () => {
      failWith(400, { title: 'One or more validation errors occurred.' });
      expect(toast.error).toHaveBeenCalledWith('One or more validation errors occurred.');
    });

    it('falls back to a generic message with the status code', () => {
      failWith(500, null);
      expect(toast.error).toHaveBeenCalledWith('Something went wrong (500).');
    });

    it('re-throws so callers can still react to the failure', () => {
      const err = failWith(403, { error: 'nope' });
      expect(err?.status).toBe(403);
    });

    it('stays quiet for background polling (X-Silent)', () => {
      const err = failWith(500, { error: 'boom' }, '/api/notifications', { headers: new HttpHeaders({ 'X-Silent': '1' }) });
      expect(toast.error).not.toHaveBeenCalled();
      expect(err?.status).toBe(500);
    });
  });

  describe('401 handling', () => {
    it('signs the user out instead of showing a toast', () => {
      auth.signIn(OFFICER);
      spyOn(auth, 'signOut');
      failWith(401, { error: 'Please sign in first.' });
      expect(auth.signOut).toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('does not sign out on a failed login attempt - it shows the reason', () => {
      auth.signIn(OFFICER);
      spyOn(auth, 'signOut');
      failWith(401, { error: 'No account found for that email.' }, '/api/auth/login');
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('No account found for that email.');
    });

    it('shows a toast when nobody is signed in', () => {
      spyOn(auth, 'signOut');
      failWith(401, { error: 'Please sign in first.' });
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Please sign in first.');
    });
  });
});
