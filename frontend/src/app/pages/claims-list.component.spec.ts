import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject, of, throwError } from 'rxjs';
import {
  ApiSpy, CLAIMANT, MANAGER, OFFICER, OFFICER_2, createApiSpy, makeDetail, makeSummary, paged, provideApiSpy,
} from '../../testing/fixtures';
import { AuthService } from '../core/auth.service';
import { ClaimSummary, User } from '../core/models';
import { ToastService } from '../core/toast.service';
import { ClaimsListComponent } from './claims-list.component';

@Component({ standalone: true, template: '' })
class Stub {}

describe('ClaimsListComponent', () => {
  let api: ApiSpy;
  let router: Router;
  let toast: ToastService;
  let fixture: ComponentFixture<ClaimsListComponent>;
  let cmp: ClaimsListComponent;

  const rows: ClaimSummary[] = [
    makeSummary({ id: 1, claimNumber: 'CLM-1', claimedAmount: 1000 }),
    makeSummary({
      id: 2, claimNumber: 'CLM-2', status: 'Assessed', claimedAmount: 2000, assessedAmount: 1800,
      type: 'Property', assignedOfficerId: 5, assignedOfficerName: 'Priya Sharma', claimantName: 'Wei Lin Tan',
    }),
    makeSummary({ id: 3, claimNumber: 'CLM-3', status: 'Approved', claimedAmount: 3000, assessedAmount: 2500, approvedAmount: 2400 }),
  ];

  function setup(mode: 'mine' | 'queue' | 'all', user: User = OFFICER, items: ClaimSummary[] = rows, total = items.length) {
    TestBed.resetTestingModule();
    localStorage.removeItem('claims.user');
    api = createApiSpy();
    api.listClaims.and.returnValue(of(paged(items, total)));
    api.myClaims.and.returnValue(of(paged(items, total)));
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideApiSpy(api)] });
    TestBed.inject(AuthService).signIn(user);
    router = TestBed.inject(Router);
    toast = TestBed.inject(ToastService);
    spyOn(router, 'navigate').and.resolveTo(true);
    spyOn(toast, 'success');
    fixture = TestBed.createComponent(ClaimsListComponent);
    fixture.componentRef.setInput('mode', mode);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const headers = () => Array.from(el().querySelectorAll('th')).map(th => th.textContent?.trim());
  const bodyRows = () => Array.from(el().querySelectorAll('tbody tr'));
  const lastReq = (spy: jasmine.Spy) => spy.calls.mostRecent().args[0];

  afterEach(() => localStorage.removeItem('claims.user'));

  describe('"My claims" mode (claimant)', () => {
    beforeEach(() => setup('mine', CLAIMANT));

    it('has the right title and calls the claimant endpoint', () => {
      expect(el().querySelector('h1')!.textContent).toBe('My claims');
      expect(api.myClaims).toHaveBeenCalledTimes(1);
      expect(api.listClaims).not.toHaveBeenCalled();
      expect(lastReq(api.myClaims)).toEqual({ search: '', page: 1, pageSize: 10, sort: 'newest', type: '' });
    });

    it('offers filing a new claim', () => {
      const link = el().querySelector('a.btn[href="/new-claim"]');
      expect(link).toBeTruthy();
    });

    it('does not load the officer list', () => {
      expect(api.officers).not.toHaveBeenCalled();
    });

    it('omits staff-only columns', () => {
      expect(headers()).toEqual(['Claim', 'Status', 'Exposure', 'Updated']);
    });

    it('has All / Open / Needs-my-reply tabs that filter on the server', () => {
      expect(el().querySelectorAll('.segmented button').length).toBe(3);
      cmp.setTab('open');
      expect(lastReq(api.myClaims).openOnly).toBeTrue();
      cmp.setTab('info');
      expect(lastReq(api.myClaims).status).toBe('InfoRequested');
      cmp.setTab('all');
      expect(lastReq(api.myClaims).openOnly).toBeUndefined();
      expect(lastReq(api.myClaims).status).toBeUndefined();
    });

    it('highlights the active tab', () => {
      cmp.setTab('open');
      fixture.detectChanges();
      expect(el().querySelectorAll('.segmented button')[1].classList).toContain('on');
    });

    it('does not show a sort button', () => {
      expect(el().textContent).not.toContain('Recently updated');
    });

    it('invites the claimant to file one when there are no claims', () => {
      setup('mine', CLAIMANT, []);
      expect(el().querySelector('.empty h3')!.textContent).toBe('No claims found');
      expect(el().querySelector('.empty a[href="/new-claim"]')).toBeTruthy();
    });
  });

  describe('"Claim queue" mode (officer)', () => {
    beforeEach(() => setup('queue', OFFICER));

    it('asks only for unassigned claims, oldest first', () => {
      expect(cmp.sort).toBe('oldest');
      expect(lastReq(api.listClaims)).toEqual({
        search: '', page: 1, pageSize: 10, sort: 'oldest', unassigned: true, market: '',
      });
    });

    it('shows queue-specific columns', () => {
      expect(headers()).toEqual(['Claim', 'Claimant', 'Claimed', 'Waiting', '']);
    });

    it('shows the claimed amount (not exposure)', () => {
      expect(bodyRows()[1].textContent).toContain('$2,000');
    });

    it('has a "Pick up" button for officers', () => {
      expect(el().querySelector('tbody .btn.sm')!.textContent).toContain('Pick up');
    });

    it('says "Assign to me" for managers', () => {
      setup('queue', MANAGER);
      expect(el().querySelector('tbody .btn.sm')!.textContent).toContain('Assign to me');
    });

    it('picking up assigns the claim to me, confirms, and opens it', () => {
      api.assign.and.returnValue(of(makeDetail()));
      (el().querySelector('tbody .btn.sm') as HTMLButtonElement).click();
      expect(api.assign).toHaveBeenCalledWith(1, OFFICER.id);
      expect(toast.success).toHaveBeenCalledWith('CLM-1 is now yours to review.');
      expect(router.navigate).toHaveBeenCalledWith(['/claim', 1]);
      expect(cmp.busyId()).toBeNull();
    });

    it('does not also open the row when the button is clicked (stopPropagation)', () => {
      api.assign.and.returnValue(of(makeDetail()));
      (el().querySelector('tbody .btn.sm') as HTMLButtonElement).click();
      expect(router.navigate).toHaveBeenCalledTimes(1);
    });

    it('disables the button while the pick-up is in flight', () => {
      api.assign.and.returnValue(new Subject());
      const btn = el().querySelector('tbody .btn.sm') as HTMLButtonElement;
      btn.click();
      fixture.detectChanges();
      expect(cmp.busyId()).toBe(1);
      expect(btn.disabled).toBeTrue();
      expect(btn.querySelector('.spin')).toBeTruthy();
    });

    it('refreshes the queue if someone else grabbed the claim first', () => {
      api.assign.and.returnValue(throwError(() => ({ status: 409 })));
      const calls = api.listClaims.calls.count();
      cmp.pickUp(rows[0], new Event('click'));
      expect(cmp.busyId()).toBeNull();
      expect(api.listClaims.calls.count()).toBe(calls + 1);
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('celebrates an empty queue', () => {
      setup('queue', OFFICER, []);
      expect(el().querySelector('.empty h3')!.textContent).toBe('The queue is clear');
      expect(el().querySelector('.empty')!.textContent).toContain('Nothing is waiting for an officer');
    });

    it('can flip the sort order', () => {
      cmp.toggleSort();
      expect(cmp.sort).toBe('newest');
      expect(lastReq(api.listClaims).sort).toBe('newest');
      cmp.toggleSort();
      expect(cmp.sort).toBe('oldest');
    });

    it('filters by market', () => {
      cmp.market = 'TH';
      cmp.reset();
      expect(lastReq(api.listClaims).market).toBe('TH');
    });
  });

  describe('"All claims" mode (staff)', () => {
    beforeEach(() => setup('all', OFFICER));

    it('loads the officer list for the assignee filter', () => {
      expect(api.officers).toHaveBeenCalledTimes(1);
      expect(cmp.officers().map(o => o.name)).toEqual([OFFICER.name, OFFICER_2.name]);
    });

    it('sends every filter, defaulting to "no filter"', () => {
      expect(lastReq(api.listClaims)).toEqual({
        search: '', page: 1, pageSize: 10, sort: 'newest', status: '', type: '', market: '', openOnly: false,
      });
    });

    it('shows the full set of columns', () => {
      expect(headers()).toEqual(['Claim', 'Claimant', 'Market', 'Status', 'Assigned to', 'Exposure', 'Updated']);
    });

    it('shows exposure as approved ?? assessed ?? claimed', () => {
      expect(bodyRows()[0].textContent).toContain('$1,000');   // only claimed
      expect(bodyRows()[1].textContent).toContain('$1,800');   // assessed
      expect(bodyRows()[2].textContent).toContain('$2,400');   // approved wins
    });

    it('shows the assignee, or "Unassigned"', () => {
      expect(bodyRows()[0].textContent).toContain('Unassigned');
      expect(bodyRows()[1].textContent).toContain('Priya Sharma');
    });

    it('renders status chips and claim links', () => {
      expect(bodyRows()[1].querySelector('.chip')!.textContent!.trim()).toBe('Assessed');
      expect(bodyRows()[1].querySelector('a.strong')!.getAttribute('href')).toBe('/claim/2');
    });

    it('applies status, type, market and open-only filters', () => {
      cmp.status = 'Approved'; cmp.type = 'Property'; cmp.market = 'SG'; cmp.openOnly = true;
      cmp.reset();
      expect(lastReq(api.listClaims)).toEqual(jasmine.objectContaining({
        status: 'Approved', type: 'Property', market: 'SG', openOnly: true,
      }));
    });

    it('"Assigned to me" filters on my id', () => {
      cmp.assignee = 'me';
      cmp.reset();
      expect(lastReq(api.listClaims).assignedTo).toBe(OFFICER.id);
    });

    it('filters on a specific officer', () => {
      cmp.assignee = '6';
      cmp.reset();
      expect(lastReq(api.listClaims).assignedTo).toBe(6);
    });

    it('is driven from the DOM selects too', () => {
      const select = el().querySelector('select') as HTMLSelectElement; // status
      select.value = select.options[4].value; // 0 = Any, 1 = Submitted, ... 4 = Assessed
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(cmp.status).toBe('Assessed');
      expect(lastReq(api.listClaims).status).toBe('Assessed');
    });

    it('opens a claim when its row is clicked', () => {
      (bodyRows()[1] as HTMLElement).click();
      expect(router.navigate).toHaveBeenCalledWith(['/claim', 2]);
    });

    it('refreshes on demand', () => {
      const calls = api.listClaims.calls.count();
      (el().querySelector('.page-head .btn.secondary') as HTMLButtonElement).click();
      expect(api.listClaims.calls.count()).toBe(calls + 1);
    });

    it('shows the empty state for no matches', () => {
      setup('all', OFFICER, []);
      expect(el().querySelector('.empty h3')!.textContent).toBe('No claims found');
      expect(el().querySelector('.empty a[href="/new-claim"]')).toBeNull(); // only claimants get that
    });
  });

  describe('loading and failure', () => {
    it('shows a spinner until the first page arrives', () => {
      setup('all');
      const pending = new Subject<ReturnType<typeof paged<ClaimSummary>>>();
      api.listClaims.and.returnValue(pending);
      const fresh = TestBed.createComponent(ClaimsListComponent);
      fresh.componentRef.setInput('mode', 'all');
      fresh.detectChanges();
      expect(fresh.nativeElement.querySelector('.loading .spinner')).toBeTruthy();
      pending.next(paged(rows));
      fresh.detectChanges();
      expect(fresh.nativeElement.querySelector('.loading')).toBeNull();
      expect(fresh.nativeElement.querySelectorAll('tbody tr').length).toBe(3);
    });

    it('exposes safe empty values before the first response', () => {
      setup('all');
      cmp.data.set(null);
      expect(cmp.items()).toEqual([]);
      expect(cmp.total()).toBe(0);
    });

    it('dims the table and disables paging while refreshing', () => {
      setup('all', OFFICER, rows, 25);
      api.listClaims.and.returnValue(new Subject());
      cmp.load();
      fixture.detectChanges();
      expect(el().querySelector('.table-wrap')!.classList).toContain('dim');
      expect((el().querySelector('.pager .btn:last-of-type') as HTMLButtonElement).disabled).toBeTrue();
    });

    it('stops loading (and keeps old rows) when a request fails', () => {
      setup('all');
      api.listClaims.and.returnValue(throwError(() => ({ status: 500 })));
      cmp.load();
      expect(cmp.loading()).toBeFalse();
      expect(cmp.items().length).toBe(3);
    });
  });

  describe('pagination', () => {
    beforeEach(() => setup('all', OFFICER, rows, 25));

    it('computes pages and the visible range', () => {
      expect(cmp.total()).toBe(25);
      expect(cmp.pages()).toBe(3);
      expect(cmp.from()).toBe(1);
      expect(cmp.to()).toBe(10);
      expect(el().querySelector('.pager')!.textContent).toContain('Showing 1–10 of 25');
      expect(el().querySelector('.pager')!.textContent).toContain('Page 1 of 3');
    });

    it('disables Previous on the first page', () => {
      const [prev, next] = Array.from(el().querySelectorAll<HTMLButtonElement>('.pager .btn'));
      expect(prev.disabled).toBeTrue();
      expect(next.disabled).toBeFalse();
    });

    it('moves forward and back, re-querying with the new page', () => {
      cmp.go(2);
      expect(lastReq(api.listClaims).page).toBe(2);
      expect(cmp.from()).toBe(11);
      expect(cmp.to()).toBe(20);
      cmp.go(1);
      expect(lastReq(api.listClaims).page).toBe(1);
    });

    it('clamps the last page range to the total and disables Next', () => {
      cmp.go(3);
      fixture.detectChanges();
      expect(cmp.from()).toBe(21);
      expect(cmp.to()).toBe(25);
      const next = el().querySelectorAll<HTMLButtonElement>('.pager .btn')[1];
      expect(next.disabled).toBeTrue();
    });

    it('drives paging from the Next button', () => {
      (el().querySelectorAll('.pager .btn')[1] as HTMLButtonElement).click();
      expect(cmp.page).toBe(2);
    });

    it('goes back to page 1 whenever a filter changes', () => {
      cmp.go(3);
      cmp.status = 'Settled';
      cmp.reset();
      expect(cmp.page).toBe(1);
      expect(lastReq(api.listClaims).page).toBe(1);
    });

    it('reports 0–0 for an empty result', () => {
      setup('all', OFFICER, [], 0);
      expect(cmp.from()).toBe(0);
      expect(cmp.to()).toBe(0);
      expect(cmp.pages()).toBe(1);
    });
  });

  describe('search box', () => {
    beforeEach(() => setup('all'));

    it('waits 300 ms of silence before querying, and only queries once', async () => {
      const calls = api.listClaims.calls.count();
      cmp.search = 'CLM-20';
      cmp.search$.next('C');
      cmp.search$.next('CL');
      cmp.search$.next('CLM-20');
      expect(api.listClaims.calls.count()).toBe(calls);        // nothing yet
      await new Promise(r => setTimeout(r, 380));
      expect(api.listClaims.calls.count()).toBe(calls + 1);    // exactly one
      expect(lastReq(api.listClaims).search).toBe('CLM-20');
    });

    it('ignores a repeat of the same text', async () => {
      cmp.search$.next('abc');
      await new Promise(r => setTimeout(r, 380));
      const calls = api.listClaims.calls.count();
      cmp.search$.next('abc');
      await new Promise(r => setTimeout(r, 380));
      expect(api.listClaims.calls.count()).toBe(calls);
    });
  });

  describe('deep links from the manager dashboard', () => {
    const routes: Routes = [
      { path: 'claims', component: ClaimsListComponent, data: { mode: 'all' } },
      { path: 'queue', component: ClaimsListComponent, data: { mode: 'queue' } },
      { path: 'claim/:id', component: Stub },
    ];

    async function open(url: string) {
      localStorage.removeItem('claims.user');
      api = createApiSpy();
      api.listClaims.and.returnValue(of(paged(rows)));
      TestBed.configureTestingModule({ providers: [provideRouter(routes, withComponentInputBinding()), provideApiSpy(api)] });
      TestBed.inject(AuthService).signIn(MANAGER);
      const harness = await RouterTestingHarness.create();
      const component = await harness.navigateByUrl(url, ClaimsListComponent);
      harness.detectChanges();
      return component;
    }

    it('applies ?assignedTo&openOnly (the "View claims" link on the team table)', async () => {
      const c = await open('/claims?assignedTo=5&openOnly=true');
      expect(c.mode).toBe('all');                                    // bound from route data
      expect(c.assignee).toBe('5');
      expect(c.openOnly).toBeTrue();
      expect(lastReq(api.listClaims)).toEqual(jasmine.objectContaining({ assignedTo: 5, openOnly: true }));
    });

    it('applies ?status (the status chips on the dashboard)', async () => {
      const c = await open('/claims?status=Approved');
      expect(c.status).toBe('Approved');
      expect(lastReq(api.listClaims).status).toBe('Approved');
    });

    it('leaves filters blank without query parameters', async () => {
      const c = await open('/claims');
      expect(c.assignee).toBe('');
      expect(c.openOnly).toBeFalse();
    });

    it('runs as the queue when routed there', async () => {
      const c = await open('/queue');
      expect(c.mode).toBe('queue');
      expect(c.sort).toBe('oldest');
      expect(lastReq(api.listClaims).unassigned).toBeTrue();
    });
  });

  describe('titles', () => {
    it('describes each mode', () => {
      setup('queue');
      expect(cmp.title()).toBe('Claim queue');
      expect(cmp.subtitle()).toContain('Submitted claims waiting');
      setup('all');
      expect(cmp.title()).toBe('All claims');
    });
  });
});
