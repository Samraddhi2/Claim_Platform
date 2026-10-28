import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import {
  ApiSpy, CLAIMANT, MANAGER, OFFICER, SYSTEM_INFO, createApiSpy, makeNotification, provideApiSpy,
} from '../../testing/fixtures';
import { AuthService } from '../core/auth.service';
import { User } from '../core/models';
import { ToastService } from '../core/toast.service';
import { ShellComponent } from './shell.component';

describe('ShellComponent', () => {
  let api: ApiSpy;
  let auth: AuthService;
  let router: Router;
  let toast: ToastService;
  let fixture: ComponentFixture<ShellComponent>;

  function setup(user: User) {
    localStorage.removeItem('claims.user');
    api = createApiSpy();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideApiSpy(api)] });
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    toast = TestBed.inject(ToastService);
    spyOn(router, 'navigate').and.resolveTo(true);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
    auth.signIn(user);
    fixture = TestBed.createComponent(ShellComponent);
  }

  /** First render + first poll (timer(0)). */
  function boot() {
    fixture.detectChanges();
    tick(0);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const navLabels = () => Array.from(el().querySelectorAll('.nav-item span')).map(s => s.textContent?.trim());
  const bell = () => el().querySelector('.bell') as HTMLButtonElement;

  afterEach(() => { localStorage.removeItem('claims.user'); });

  describe('navigation by role', () => {
    it('gives claimants "My claims" and "New claim"', fakeAsync(() => {
      setup(CLAIMANT); boot();
      expect(navLabels()).toEqual(['My claims', 'New claim']);
      expect(el().querySelector('.nav-label')!.textContent).toBe('My claims');
      fixture.destroy();
    }));

    it('gives officers their workload, the queue and all claims', fakeAsync(() => {
      setup(OFFICER); boot();
      expect(navLabels()).toEqual(['My workload', 'Claim queue', 'All claims']);
      expect(el().querySelector('.nav-label')!.textContent).toBe('Claims officer');
      fixture.destroy();
    }));

    it('gives managers the dashboard instead of a personal workload', fakeAsync(() => {
      setup(MANAGER); boot();
      expect(navLabels()).toEqual(['Dashboard', 'Claim queue', 'All claims']);
      expect(el().querySelector('.nav-label')!.textContent).toBe('Claims management');
      fixture.destroy();
    }));

    it('links the logo to the role\'s home page', fakeAsync(() => {
      setup(OFFICER); boot();
      expect(el().querySelector('a.brand')!.getAttribute('href')).toBe('/workload');
      fixture.destroy();
    }));
  });

  describe('signed-in user card', () => {
    it('shows name, role and market', fakeAsync(() => {
      setup(CLAIMANT); boot();
      expect(el().querySelector('.who strong')!.textContent).toBe('Aisha Rahman');
      expect(el().querySelector('.who small')!.textContent).toBe('Claimant · MY');
      fixture.destroy();
    }));

    it('omits the market for staff without one', fakeAsync(() => {
      setup(OFFICER); boot();
      expect(el().querySelector('.who small')!.textContent).toBe('Officer');
      fixture.destroy();
    }));

    it('signs out from the logout button', fakeAsync(() => {
      setup(OFFICER); boot();
      spyOn(auth, 'signOut');
      (el().querySelector('button[aria-label="Sign out"]') as HTMLButtonElement).click();
      expect(auth.signOut).toHaveBeenCalled();
      fixture.destroy();
    }));
  });

  describe('event-bus indicator', () => {
    it('shows which bus the backend is using', fakeAsync(() => {
      setup(OFFICER); boot();
      expect(el().querySelector('.bus')!.textContent).toContain('Event bus: In-Memory');
      expect(el().querySelector('.dot')!.classList).toContain('live');
      expect(el().querySelector('.pending')).toBeNull();
      fixture.destroy();
    }));

    it('flags events still waiting in the outbox', fakeAsync(() => {
      setup(OFFICER);
      api.systemInfo.and.returnValue(of({ ...SYSTEM_INFO, messagingProvider: 'Kafka', pendingOutbox: 3 }));
      boot();
      expect(el().querySelector('.bus')!.textContent).toContain('Kafka');
      expect(el().querySelector('.pending')!.textContent).toContain('3 in flight');
      fixture.destroy();
    }));

    it('reports "Backend offline" when the info call fails', fakeAsync(() => {
      setup(OFFICER);
      api.systemInfo.and.returnValue(throwError(() => new Error('down')));
      boot();
      expect(el().querySelector('.bus')!.textContent).toContain('Backend offline');
      expect(el().querySelector('.dot')!.classList).toContain('off');
      fixture.destroy();
    }));

    it('explains the async design in its tooltip', fakeAsync(() => {
      setup(OFFICER); boot();
      expect(fixture.componentInstance.busTitle()).toContain('Events flow through In-Memory (topic claims.events)');
      fixture.destroy();
    }));

    it('has an offline tooltip when there is no info', fakeAsync(() => {
      setup(OFFICER);
      api.systemInfo.and.returnValue(throwError(() => new Error('down')));
      boot();
      expect(fixture.componentInstance.busTitle()).toBe('Cannot reach backend');
      fixture.destroy();
    }));
  });

  describe('notification bell', () => {
    const three = [
      makeNotification({ id: 1, message: 'Newest', isRead: false }),
      makeNotification({ id: 2, message: 'Older', isRead: false }),
      makeNotification({ id: 3, message: 'Read one', isRead: true }),
    ];

    it('hides the badge when everything is read', fakeAsync(() => {
      setup(OFFICER);
      api.notifications.and.returnValue(of([makeNotification({ isRead: true })]));
      boot();
      expect(el().querySelector('.badge')).toBeNull();
      fixture.destroy();
    }));

    it('counts unread notifications', fakeAsync(() => {
      setup(OFFICER);
      api.notifications.and.returnValue(of(three));
      boot();
      expect(el().querySelector('.badge')!.textContent?.trim()).toBe('2');
      expect(fixture.componentInstance.unread()).toBe(2);
      fixture.destroy();
    }));

    it('caps the badge at 9+', fakeAsync(() => {
      setup(OFFICER);
      api.notifications.and.returnValue(of(Array.from({ length: 12 }, (_, i) => makeNotification({ id: i + 1 }))));
      boot();
      expect(el().querySelector('.badge')!.textContent?.trim()).toBe('9+');
      fixture.destroy();
    }));

    it('opens a panel listing notifications, unread first-class', fakeAsync(() => {
      setup(OFFICER);
      api.notifications.and.returnValue(of(three));
      boot();
      expect(el().querySelector('.panel')).toBeNull();
      bell().click(); fixture.detectChanges();
      const rows = el().querySelectorAll('.note');
      expect(rows.length).toBe(3);
      expect(rows[0].classList).toContain('unread');
      expect(rows[2].classList).not.toContain('unread');
      expect(rows[0].textContent).toContain('Newest');
      expect(rows[0].textContent).toContain('CLM-2026-000101');
      fixture.destroy();
    }));

    it('shows a friendly empty state', fakeAsync(() => {
      setup(OFFICER); boot();
      bell().click(); fixture.detectChanges();
      expect(el().querySelector('.panel .empty')!.textContent).toContain('All caught up');
      fixture.destroy();
    }));

    it('toggles closed when the bell is clicked again', fakeAsync(() => {
      setup(OFFICER); boot();
      bell().click(); fixture.detectChanges();
      bell().click(); fixture.detectChanges();
      expect(el().querySelector('.panel')).toBeNull();
      fixture.destroy();
    }));

    it('closes when the user clicks elsewhere on the page', fakeAsync(() => {
      setup(OFFICER); boot();
      bell().click(); fixture.detectChanges();
      document.body.click(); fixture.detectChanges();
      expect(el().querySelector('.panel')).toBeNull();
      fixture.destroy();
    }));

    it('stays open when the click lands inside the panel', fakeAsync(() => {
      setup(OFFICER); boot();
      bell().click(); fixture.detectChanges();
      (el().querySelector('.panel-head h3') as HTMLElement).click(); fixture.detectChanges();
      expect(el().querySelector('.panel')).not.toBeNull();
      fixture.destroy();
    }));

    it('marks everything read in one call and updates the badge', fakeAsync(() => {
      setup(OFFICER);
      api.notifications.and.returnValue(of(three));
      api.markAllRead.and.returnValue(of(undefined));
      boot();
      bell().click(); fixture.detectChanges();
      (el().querySelector('.panel-head button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(api.markAllRead).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance.unread()).toBe(0);
      expect(el().querySelector('.badge')).toBeNull();
      fixture.destroy();
    }));

    it('disables "Mark all read" when nothing is unread', fakeAsync(() => {
      setup(OFFICER); boot();
      bell().click(); fixture.detectChanges();
      expect((el().querySelector('.panel-head button') as HTMLButtonElement).disabled).toBeTrue();
      fixture.destroy();
    }));

    it('opening an unread notification marks it read and jumps to the claim', fakeAsync(() => {
      setup(OFFICER);
      api.notifications.and.returnValue(of(three));
      api.markRead.and.returnValue(of(undefined));
      boot();
      bell().click(); fixture.detectChanges();
      (el().querySelectorAll('.note')[0] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(api.markRead).toHaveBeenCalledWith(1);
      expect(router.navigate).toHaveBeenCalledWith(['/claim', 101]);
      expect(fixture.componentInstance.unread()).toBe(1);
      expect(el().querySelector('.panel')).toBeNull(); // panel closes
      fixture.destroy();
    }));

    it('does not re-mark an already-read notification', fakeAsync(() => {
      setup(OFFICER);
      api.notifications.and.returnValue(of(three));
      boot();
      fixture.componentInstance.openNotification(three[2]);
      expect(api.markRead).not.toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/claim', 101]);
      fixture.destroy();
    }));

    it('does not navigate for a notification without a claim', fakeAsync(() => {
      setup(OFFICER);
      boot();
      fixture.componentInstance.openNotification(makeNotification({ claimId: null, isRead: true }));
      expect(router.navigate).not.toHaveBeenCalled();
      fixture.destroy();
    }));
  });

  describe('background polling (how async events reach the user)', () => {
    it('polls every 4 seconds', fakeAsync(() => {
      setup(OFFICER); boot();
      expect(api.notifications).toHaveBeenCalledTimes(1);
      tick(4000);
      expect(api.notifications).toHaveBeenCalledTimes(2);
      tick(4000);
      expect(api.notifications).toHaveBeenCalledTimes(3);
      expect(api.systemInfo).toHaveBeenCalledTimes(3);
      fixture.destroy();
    }));

    it('stays quiet about notifications that already existed on first load', fakeAsync(() => {
      setup(OFFICER);
      api.notifications.and.returnValue(of([makeNotification({ id: 1 })]));
      spyOn(toast, 'info');
      boot();
      expect(toast.info).not.toHaveBeenCalled();
      fixture.destroy();
    }));

    it('toasts the message of a single new notification', fakeAsync(() => {
      setup(OFFICER);
      spyOn(toast, 'info');
      boot();
      api.notifications.and.returnValue(of([makeNotification({ id: 9, message: 'New claim CLM-2026-000200 in the SG queue.' })]));
      tick(4000);
      expect(toast.info).toHaveBeenCalledOnceWith('New claim CLM-2026-000200 in the SG queue.');
      fixture.destroy();
      flush();
    }));

    it('summarises several new notifications in one toast', fakeAsync(() => {
      setup(OFFICER);
      spyOn(toast, 'info');
      boot();
      api.notifications.and.returnValue(of([makeNotification({ id: 7 }), makeNotification({ id: 8 }), makeNotification({ id: 9 })]));
      tick(4000);
      expect(toast.info).toHaveBeenCalledOnceWith('3 new notifications');
      fixture.destroy();
      flush();
    }));

    it('never toasts the same notification twice', fakeAsync(() => {
      setup(OFFICER);
      spyOn(toast, 'info');
      boot();
      api.notifications.and.returnValue(of([makeNotification({ id: 9 })]));
      tick(4000);
      tick(4000);
      expect(toast.info).toHaveBeenCalledTimes(1);
      fixture.destroy();
      flush();
    }));

    it('ignores already-read notifications it has not seen before', fakeAsync(() => {
      setup(OFFICER);
      spyOn(toast, 'info');
      boot();
      api.notifications.and.returnValue(of([makeNotification({ id: 5, isRead: true })]));
      tick(4000);
      expect(toast.info).not.toHaveBeenCalled();
      fixture.destroy();
      flush();
    }));

    it('keeps the previous list when a poll fails', fakeAsync(() => {
      setup(OFFICER);
      api.notifications.and.returnValue(of([makeNotification({ id: 1 })]));
      boot();
      api.notifications.and.returnValue(throwError(() => new Error('blip')));
      tick(4000);
      expect(fixture.componentInstance.notifications().length).toBe(1);
      fixture.destroy();
    }));

    it('stops polling when the shell is destroyed', fakeAsync(() => {
      setup(OFFICER); boot();
      fixture.destroy();
      tick(20000);
      expect(api.notifications).toHaveBeenCalledTimes(1);
    }));
  });

  it('renders the routed page inside <main>', fakeAsync(() => {
    setup(OFFICER); boot();
    expect(fixture.debugElement.query(By.css('main router-outlet'))).toBeTruthy();
    fixture.destroy();
  }));
});
