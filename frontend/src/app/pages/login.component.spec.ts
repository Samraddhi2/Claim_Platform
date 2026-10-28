import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import {
  ApiSpy, CLAIMANT, MANAGER, OFFICER, createApiSpy, provideApiSpy,
} from '../../testing/fixtures';
import { AuthService } from '../core/auth.service';
import { User } from '../core/models';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let api: ApiSpy;
  let auth: AuthService;
  let router: Router;
  let fixture: ComponentFixture<LoginComponent>;

  function setup(signedIn?: User) {
    localStorage.removeItem('claims.user');
    api = createApiSpy();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideApiSpy(api)] });
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
    if (signedIn) auth.signIn(signedIn);
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const personas = () => Array.from(el().querySelectorAll<HTMLButtonElement>('.persona'));

  afterEach(() => localStorage.removeItem('claims.user'));

  describe('persona picker', () => {
    it('loads the demo users on start', () => {
      setup();
      expect(api.users).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.loading()).toBeFalse();
    });

    it('groups people into Policyholders / Claims officers / Management', () => {
      setup();
      expect(Array.from(el().querySelectorAll('h3.group')).map(h => h.textContent?.trim()))
        .toEqual(['Policyholders', 'Claims officers', 'Management']);
      expect(personas().length).toBe(3);
    });

    it('hides groups that have nobody in them', () => {
      localStorage.removeItem('claims.user');
      api = createApiSpy();
      api.users.and.returnValue(of([OFFICER]));
      TestBed.configureTestingModule({ providers: [provideRouter([]), provideApiSpy(api)] });
      fixture = TestBed.createComponent(LoginComponent);
      fixture.detectChanges();
      expect(el().querySelectorAll('h3.group').length).toBe(1);
    });

    it('shows each persona\'s role blurb and market name', () => {
      setup();
      const first = personas()[0].textContent!;
      expect(first).toContain('Aisha Rahman');
      expect(first).toContain('Claimant · Malaysia');
      expect(personas()[2].textContent).toContain('Claims manager');
    });

    it('translates market codes and tolerates unknown ones', () => {
      setup();
      expect(fixture.componentInstance.marketName('SG')).toBe('Singapore');
      expect(fixture.componentInstance.marketName('XX')).toBe('XX');
    });

    it('shows a spinner while the user list loads', () => {
      localStorage.removeItem('claims.user');
      api = createApiSpy();
      const pending = new Subject<User[]>();
      api.users.and.returnValue(pending);
      TestBed.configureTestingModule({ providers: [provideRouter([]), provideApiSpy(api)] });
      fixture = TestBed.createComponent(LoginComponent);
      fixture.detectChanges();
      expect(el().querySelector('.loading .spinner')).toBeTruthy();
      expect(personas().length).toBe(0);
    });
  });

  describe('when the backend is unreachable', () => {
    function setupFailing() {
      localStorage.removeItem('claims.user');
      api = createApiSpy();
      api.users.and.returnValue(throwError(() => new Error('down')));
      TestBed.configureTestingModule({ providers: [provideRouter([]), provideApiSpy(api)] });
      fixture = TestBed.createComponent(LoginComponent);
      fixture.detectChanges();
    }

    it('shows a helpful banner instead of an empty page', () => {
      setupFailing();
      expect(fixture.componentInstance.failed()).toBeTrue();
      expect(el().querySelector('.banner.warn')!.textContent).toContain("Can't reach the backend");
      expect(el().querySelector('.banner.warn')!.textContent).toContain('http://localhost:5080');
    });

    it('lets the user retry and recover', () => {
      setupFailing();
      api.users.and.returnValue(of([CLAIMANT]));
      (el().querySelector('.banner button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(api.users).toHaveBeenCalledTimes(2);
      expect(fixture.componentInstance.failed()).toBeFalse();
      expect(personas().length).toBe(1);
    });
  });

  describe('already signed in', () => {
    it('skips the form and redirects to the role\'s home page', () => {
      setup(MANAGER);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard');
      expect(api.users).not.toHaveBeenCalled();
    });
  });

  describe('signing in as a persona', () => {
    it('calls the real login endpoint, stores the session and navigates home', () => {
      setup();
      api.login.and.returnValue(of(OFFICER));
      personas()[1].click();
      expect(api.login).toHaveBeenCalledWith('priya@demo.com');
      expect(auth.user()).toEqual(OFFICER);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/workload');
    });

    it('sends claimants to their claims', () => {
      setup();
      api.login.and.returnValue(of(CLAIMANT));
      fixture.componentInstance.enter(CLAIMANT);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/my-claims');
    });

    it('disables every persona while a login is in flight', () => {
      setup();
      const pending = new Subject<User>();
      api.login.and.returnValue(pending);
      personas()[0].click();
      fixture.detectChanges();
      expect(fixture.componentInstance.busyId()).toBe(CLAIMANT.id);
      expect(personas().every(p => p.disabled)).toBeTrue();
      expect(personas()[0].querySelector('.spinner')).toBeTruthy();
    });

    it('re-enables the buttons if login fails', () => {
      setup();
      api.login.and.returnValue(throwError(() => new Error('401')));
      fixture.componentInstance.enter(CLAIMANT);
      fixture.detectChanges();
      expect(fixture.componentInstance.busyId()).toBeNull();
      expect(auth.user()).toBeNull();
      expect(personas().some(p => p.disabled)).toBeFalse();
    });
  });

  describe('signing in by email', () => {
    it('keeps the Sign in button disabled for a blank email', fakeAsync(() => {
      setup();
      tick();
      const btn = el().querySelector('.row .btn') as HTMLButtonElement;
      expect(btn.disabled).toBeTrue();
      fixture.componentInstance.email = '   ';
      fixture.detectChanges();
      expect(btn.disabled).toBeTrue();
    }));

    it('enables the button once an email is typed', fakeAsync(() => {
      setup();
      const input = el().querySelector('input[type=email]') as HTMLInputElement;
      input.value = 'priya@demo.com';
      input.dispatchEvent(new Event('input'));
      tick(); fixture.detectChanges();
      expect(fixture.componentInstance.email).toBe('priya@demo.com');
      expect((el().querySelector('.row .btn') as HTMLButtonElement).disabled).toBeFalse();
    }));

    it('signs in on click', () => {
      setup();
      api.login.and.returnValue(of(OFFICER));
      fixture.componentInstance.email = 'priya@demo.com';
      fixture.componentInstance.emailLogin();
      expect(api.login).toHaveBeenCalledWith('priya@demo.com');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/workload');
    });

    it('signs in when pressing Enter in the field', fakeAsync(() => {
      setup();
      api.login.and.returnValue(of(OFFICER));
      fixture.componentInstance.email = 'priya@demo.com';
      el().querySelector('input[type=email]')!.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
      expect(api.login).toHaveBeenCalledWith('priya@demo.com');
      tick();
    }));

    it('does nothing for a blank email', () => {
      setup();
      fixture.componentInstance.email = '  ';
      fixture.componentInstance.emailLogin();
      expect(api.login).not.toHaveBeenCalled();
    });

    it('recovers from an unknown email (the interceptor shows the error toast)', () => {
      setup();
      api.login.and.returnValue(throwError(() => ({ status: 401 })));
      fixture.componentInstance.email = 'nobody@demo.com';
      fixture.componentInstance.emailLogin();
      expect(fixture.componentInstance.busyId()).toBeNull();
      expect(auth.user()).toBeNull();
    });

    it('marks the form busy while the request runs', () => {
      setup();
      api.login.and.returnValue(new Subject<User>());
      fixture.componentInstance.email = 'priya@demo.com';
      fixture.componentInstance.emailLogin();
      expect(fixture.componentInstance.busyId()).toBe(-1);
    });
  });
});
