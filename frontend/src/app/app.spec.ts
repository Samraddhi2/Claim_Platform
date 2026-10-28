import { TestBed } from '@angular/core/testing';
import { Route, provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import { appConfig } from './app.config';
import { routes } from './app.routes';
import { authGuard } from './core/guards';
import { ToastsComponent } from './shared/toasts.component';

describe('AppComponent', () => {
  it('hosts the router outlet and the global toast stack', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(AppComponent);
    f.detectChanges();
    expect(f.nativeElement.querySelector('router-outlet')).toBeTruthy();
    expect(f.debugElement.query(By.directive(ToastsComponent))).toBeTruthy();
  });
});

describe('appConfig', () => {
  it('registers the router and the HTTP client (with the interceptor)', () => {
    expect(appConfig.providers.length).toBe(2);
  });
});

describe('routes', () => {
  const shell = routes.find(r => r.path === '')!;
  const child = (path: string): Route => shell.children!.find(c => c.path === path)!;

  it('exposes /login publicly and everything else behind the auth guard', () => {
    expect(routes.find(r => r.path === 'login')!.canActivate).toBeUndefined();
    expect(shell.canActivate).toEqual([authGuard]);
  });

  it('declares the expected pages', () => {
    expect(shell.children!.map(c => c.path)).toEqual(
      ['my-claims', 'new-claim', 'workload', 'queue', 'claims', 'dashboard', 'claim/:id', '']);
  });

  it('guards every role-specific page', () => {
    for (const p of ['my-claims', 'new-claim', 'workload', 'queue', 'claims', 'dashboard']) {
      expect(child(p).canActivate?.length).withContext(p).toBe(1);
    }
    expect(child('claim/:id').canActivate).toBeUndefined(); // shared by every role
  });

  it('tells the shared list component which mode to run in', () => {
    expect(child('my-claims').data).toEqual({ mode: 'mine' });
    expect(child('queue').data).toEqual({ mode: 'queue' });
    expect(child('claims').data).toEqual({ mode: 'all' });
  });

  it('redirects the empty path to /claims and unknown paths to the root', () => {
    expect(child('').redirectTo).toBe('claims');
    expect(routes.find(r => r.path === '**')!.redirectTo).toBe('');
  });

  it('lazy-loads every page component', async () => {
    const lazy = [...routes, ...shell.children!].filter(r => r.loadComponent);
    expect(lazy.length).toBe(9); // login, shell, and 7 child pages (the list component serves 3 routes)
    for (const r of lazy) {
      const component = await (r.loadComponent as () => Promise<unknown>)();
      expect(typeof component).toBe('function');
    }
  });
});
