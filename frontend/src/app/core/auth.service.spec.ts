import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideRouter } from '@angular/router';
import { CLAIMANT, MANAGER, OFFICER } from '../../testing/fixtures';
import { AuthService } from './auth.service';

const KEY = 'claims.user';

describe('AuthService', () => {
  let router: Router;

  function create(): AuthService {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
    return TestBed.inject(AuthService);
  }

  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  it('starts signed out when nothing is stored', () => {
    const auth = create();
    expect(auth.user()).toBeNull();
    expect(auth.isStaff()).toBeFalse();
    expect(auth.isManager()).toBeFalse();
    expect(auth.isClaimant()).toBeFalse();
  });

  it('restores the signed-in user from localStorage', () => {
    localStorage.setItem(KEY, JSON.stringify(OFFICER));
    const auth = create();
    expect(auth.user()).toEqual(OFFICER);
  });

  it('survives corrupted storage', () => {
    localStorage.setItem(KEY, '{not json');
    expect(create().user()).toBeNull();
  });

  it('survives a stored "null"', () => {
    localStorage.setItem(KEY, 'null');
    expect(create().user()).toBeNull();
  });

  it('signIn persists and publishes the user', () => {
    const auth = create();
    auth.signIn(CLAIMANT);
    expect(auth.user()).toEqual(CLAIMANT);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(CLAIMANT);
  });

  it('derives role flags for a claimant', () => {
    const auth = create();
    auth.signIn(CLAIMANT);
    expect(auth.isClaimant()).toBeTrue();
    expect(auth.isStaff()).toBeFalse();
    expect(auth.isManager()).toBeFalse();
  });

  it('derives role flags for an officer', () => {
    const auth = create();
    auth.signIn(OFFICER);
    expect(auth.isStaff()).toBeTrue();
    expect(auth.isManager()).toBeFalse();
    expect(auth.isClaimant()).toBeFalse();
  });

  it('derives role flags for a manager (who is also staff)', () => {
    const auth = create();
    auth.signIn(MANAGER);
    expect(auth.isManager()).toBeTrue();
    expect(auth.isStaff()).toBeTrue();
    expect(auth.isClaimant()).toBeFalse();
  });

  it('signOut clears storage, the signal, and goes to /login', () => {
    const auth = create();
    auth.signIn(OFFICER);
    auth.signOut();
    expect(auth.user()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('knows each role\'s home page', () => {
    const auth = create();
    expect(auth.homeFor('Claimant')).toBe('/my-claims');
    expect(auth.homeFor('Officer')).toBe('/workload');
    expect(auth.homeFor('Manager')).toBe('/dashboard');
  });
});
