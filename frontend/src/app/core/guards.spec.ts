import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { CLAIMANT, MANAGER, OFFICER } from '../../testing/fixtures';
import { AuthService } from './auth.service';
import { authGuard, roleGuard } from './guards';
import { Role } from './models';

describe('route guards', () => {
  let auth: AuthService;
  let router: Router;
  const route = {} as ActivatedRouteSnapshot;
  const state = {} as RouterStateSnapshot;

  beforeEach(() => {
    localStorage.removeItem('claims.user');
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
  });
  afterEach(() => localStorage.removeItem('claims.user'));

  const run = (guard: ReturnType<typeof roleGuard> | typeof authGuard) =>
    TestBed.runInInjectionContext(() => guard(route, state));

  const urlOf = (result: unknown) => router.serializeUrl(result as UrlTree);

  describe('authGuard', () => {
    it('redirects anonymous visitors to /login', () => {
      expect(urlOf(run(authGuard))).toBe('/login');
    });

    it('lets signed-in users through', () => {
      auth.signIn(CLAIMANT);
      expect(run(authGuard)).toBeTrue();
    });
  });

  describe('roleGuard', () => {
    it('redirects anonymous visitors to /login', () => {
      expect(urlOf(run(roleGuard('Officer')))).toBe('/login');
    });

    it('lets a matching role through', () => {
      auth.signIn(OFFICER);
      expect(run(roleGuard('Officer'))).toBeTrue();
    });

    it('accepts any of several roles', () => {
      auth.signIn(MANAGER);
      expect(run(roleGuard('Officer', 'Manager'))).toBeTrue();
    });

    const redirects: [Role, Role[], string][] = [
      ['Claimant', ['Officer', 'Manager'], '/my-claims'],
      ['Officer', ['Manager'], '/workload'],
      ['Manager', ['Claimant'], '/dashboard'],
    ];
    redirects.forEach(([who, allowed, home]) => {
      it(`sends a ${who} away from a ${allowed.join('/')} page to ${home}`, () => {
        auth.signIn({ CLAIMANT, OFFICER, MANAGER }[who.toUpperCase() as 'CLAIMANT' | 'OFFICER' | 'MANAGER']);
        expect(urlOf(run(roleGuard(...allowed)))).toBe(home);
      });
    });
  });
});
