import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { makeDashboard, makeDetail, makeNotification, makeWorkload, paged, makeSummary } from '../../testing/fixtures';
import { ApiService } from './api.service';
import { CreateClaimBody } from './models';

describe('ApiService', () => {
  let api: ApiService;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiService);
    ctrl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => ctrl.verify());

  describe('session', () => {
    it('GET /api/users', () => {
      api.users().subscribe();
      const r = ctrl.expectOne('/api/users');
      expect(r.request.method).toBe('GET');
      r.flush([]);
    });

    it('POST /api/auth/login with the email', () => {
      api.login('priya@demo.com').subscribe();
      const r = ctrl.expectOne('/api/auth/login');
      expect(r.request.method).toBe('POST');
      expect(r.request.body).toEqual({ email: 'priya@demo.com' });
      r.flush({});
    });

    it('GET /api/system/info is silent (background poll)', () => {
      api.systemInfo().subscribe();
      const r = ctrl.expectOne('/api/system/info');
      expect(r.request.headers.get('X-Silent')).toBe('1');
      r.flush({});
    });

    it('GET /api/officers', () => {
      api.officers().subscribe();
      ctrl.expectOne('/api/officers').flush([]);
    });
  });

  describe('claim queries', () => {
    it('listClaims sends only meaningful filters', () => {
      api.listClaims({
        status: 'Approved', type: '', market: 'SG', assignedTo: 5, unassigned: false, openOnly: true,
        search: '', sort: 'oldest', page: 2, pageSize: 10,
      }).subscribe();
      const r = ctrl.expectOne(req => req.url === '/api/claims');
      const p = r.request.params;
      expect(p.get('status')).toBe('Approved');
      expect(p.get('market')).toBe('SG');
      expect(p.get('assignedTo')).toBe('5');
      expect(p.get('openOnly')).toBe('true');
      expect(p.get('sort')).toBe('oldest');
      expect(p.get('page')).toBe('2');
      expect(p.get('pageSize')).toBe('10');
      // empty string, false and null/undefined are dropped
      expect(p.has('type')).toBeFalse();
      expect(p.has('search')).toBeFalse();
      expect(p.has('unassigned')).toBeFalse();
      r.flush(paged([makeSummary()]));
    });

    it('listClaims with no filters sends no query string', () => {
      api.listClaims({}).subscribe();
      const r = ctrl.expectOne('/api/claims');
      expect(r.request.params.keys()).toEqual([]);
      r.flush(paged([]));
    });

    it('listClaims drops a null assignee', () => {
      api.listClaims({ assignedTo: null }).subscribe();
      const r = ctrl.expectOne('/api/claims');
      expect(r.request.params.has('assignedTo')).toBeFalse();
      r.flush(paged([]));
    });

    it('myClaims hits /api/claims/mine', () => {
      api.myClaims({ openOnly: true }).subscribe();
      const r = ctrl.expectOne(req => req.url === '/api/claims/mine');
      expect(r.request.params.get('openOnly')).toBe('true');
      r.flush(paged([]));
    });

    it('claim(id) is loud by default and silent when polling', () => {
      api.claim(7).subscribe();
      const loud = ctrl.expectOne('/api/claims/7');
      expect(loud.request.headers.has('X-Silent')).toBeFalse();
      loud.flush(makeDetail());

      api.claim(7, true).subscribe();
      const quiet = ctrl.expectOne('/api/claims/7');
      expect(quiet.request.headers.get('X-Silent')).toBe('1');
      quiet.flush(makeDetail());
    });
  });

  describe('claim commands', () => {
    it('createClaim POSTs the body', () => {
      const body: CreateClaimBody = {
        type: 'Motor', market: 'SG', policyNumber: 'MTR-1', incidentDate: '2026-10-01T00:00:00',
        location: 'PIE', description: 'Rear ended at lights', claimedAmount: 1200,
      };
      api.createClaim(body).subscribe();
      const r = ctrl.expectOne('/api/claims');
      expect(r.request.method).toBe('POST');
      expect(r.request.body).toEqual(body);
      r.flush(makeDetail());
    });

    const commands: [string, () => void, string, unknown][] = [
      ['assign', () => api.assign(3, 9).subscribe(), 'assign', { officerId: 9 }],
      ['assign (self / null)', () => api.assign(3, null).subscribe(), 'assign', { officerId: null }],
      ['requestInfo', () => api.requestInfo(3, 'photos please').subscribe(), 'request-info', { message: 'photos please' }],
      ['provideInfo', () => api.provideInfo(3, 'attached').subscribe(), 'provide-info', { response: 'attached' }],
      ['assess', () => api.assess(3, 900, 'ok').subscribe(), 'assess', { assessedAmount: 900, comment: 'ok' }],
      ['approve', () => api.approve(3, 800, 'fine').subscribe(), 'approve', { approvedAmount: 800, comment: 'fine' }],
      ['reject', () => api.reject(3, 'not covered by policy').subscribe(), 'reject', { reason: 'not covered by policy' }],
      ['reopen', () => api.reopen(3).subscribe(), 'reopen', {}],
      ['settle', () => api.settle(3).subscribe(), 'settle', {}],
      ['withdraw', () => api.withdraw(3).subscribe(), 'withdraw', {}],
      ['addNote', () => api.addNote(3, 'called the garage').subscribe(), 'notes', { text: 'called the garage' }],
    ];

    commands.forEach(([name, call, path, body]) => {
      it(`${name} -> POST /api/claims/3/${path}`, () => {
        call();
        const r = ctrl.expectOne(`/api/claims/3/${path}`);
        expect(r.request.method).toBe('POST');
        expect(r.request.body).toEqual(body as object);
        r.flush(makeDetail());
      });
    });
  });

  describe('notifications', () => {
    it('GET /api/notifications is silent', () => {
      api.notifications().subscribe();
      const r = ctrl.expectOne('/api/notifications');
      expect(r.request.headers.get('X-Silent')).toBe('1');
      r.flush([makeNotification()]);
    });

    it('POST /api/notifications/:id/read', () => {
      api.markRead(12).subscribe();
      const r = ctrl.expectOne('/api/notifications/12/read');
      expect(r.request.method).toBe('POST');
      r.flush(null);
    });

    it('POST /api/notifications/read-all', () => {
      api.markAllRead().subscribe();
      const r = ctrl.expectOne('/api/notifications/read-all');
      expect(r.request.method).toBe('POST');
      r.flush(null);
    });
  });

  describe('insight', () => {
    it('GET /api/workload', () => {
      api.workload().subscribe();
      ctrl.expectOne('/api/workload').flush(makeWorkload());
    });

    it('GET /api/dashboard, silent only when asked', () => {
      api.dashboard().subscribe();
      const loud = ctrl.expectOne('/api/dashboard');
      expect(loud.request.headers.has('X-Silent')).toBeFalse();
      loud.flush(makeDashboard());

      api.dashboard(true).subscribe();
      const quiet = ctrl.expectOne('/api/dashboard');
      expect(quiet.request.headers.get('X-Silent')).toBe('1');
      quiet.flush(makeDashboard());
    });
  });
});
