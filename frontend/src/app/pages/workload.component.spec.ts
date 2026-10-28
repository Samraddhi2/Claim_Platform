import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import {
  ApiSpy, OFFICER, createApiSpy, makeSummary, makeWorkload, paged, provideApiSpy,
} from '../../testing/fixtures';
import { AuthService } from '../core/auth.service';
import { Workload } from '../core/models';
import { WorkloadComponent } from './workload.component';

describe('WorkloadComponent', () => {
  let api: ApiSpy;
  let router: Router;
  let fixture: ComponentFixture<WorkloadComponent>;
  let cmp: WorkloadComponent;

  const mine = [
    makeSummary({ id: 11, claimNumber: 'CLM-11', status: 'UnderReview', claimedAmount: 4000, claimantName: 'Aisha Rahman' }),
    makeSummary({ id: 12, claimNumber: 'CLM-12', status: 'Assessed', claimedAmount: 9000, assessedAmount: 7000, type: 'Property', market: 'HK' }),
  ];

  function setup(w: Workload = makeWorkload()) {
    localStorage.removeItem('claims.user');
    api = createApiSpy();
    api.workload.and.returnValue(of(w));
    api.listClaims.and.returnValue(of(paged(mine)));
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideApiSpy(api)] });
    TestBed.inject(AuthService).signIn(OFFICER);
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(WorkloadComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');

  afterEach(() => localStorage.removeItem('claims.user'));

  it('greets the officer by first name', () => {
    setup();
    expect(el().querySelector('h1')!.textContent).toBe('Good to see you, Priya');
  });

  it('loads my workload and my 8 oldest open claims in parallel', () => {
    setup();
    expect(api.workload).toHaveBeenCalledTimes(1);
    expect(api.listClaims).toHaveBeenCalledOnceWith({ assignedTo: OFFICER.id, openOnly: true, sort: 'oldest', pageSize: 8 });
  });

  it('shows a spinner until both calls return', () => {
    localStorage.removeItem('claims.user');
    api = createApiSpy();
    api.workload.and.returnValue(new Subject<Workload>());
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideApiSpy(api)] });
    TestBed.inject(AuthService).signIn(OFFICER);
    fixture = TestBed.createComponent(WorkloadComponent);
    fixture.detectChanges();
    expect(el().querySelector('.loading .spinner')).toBeTruthy();
    expect(el().querySelector('.stats')).toBeNull();
  });

  describe('stat cards', () => {
    beforeEach(() => setup());

    it('shows the four headline numbers', () => {
      const vals = Array.from(el().querySelectorAll('.stat .val')).map(v => v.textContent?.trim());
      expect(vals).toEqual(['4', '2', '1', '$62K']);
    });

    it('labels them clearly', () => {
      const labels = Array.from(el().querySelectorAll('.stat .lbl')).map(v => v.textContent?.trim());
      expect(labels).toEqual([
        'Open claims assigned to you', 'Waiting on you', 'Waiting on claimants', 'Outstanding exposure',
      ]);
    });

    it('shows performance', () => {
      expect(text()).toContain('Decisions in the last 30 days3');
      expect(text()).toContain('Average time to decision5.5 days');
    });
  });

  describe('queue banner', () => {
    it('says how many are waiting and how long the oldest has waited', () => {
      setup(makeWorkload({ queueSize: 3, oldestQueueDays: 6.2 }));
      const banner = el().querySelector('.banner.queue')!;
      expect(banner.textContent).toContain('3 claims are waiting in the queue');
      expect(banner.textContent).toContain('the oldest has waited 6.2 days');
      expect(banner.querySelector('a')!.getAttribute('href')).toBe('/queue');
    });

    it('uses the singular for one claim', () => {
      setup(makeWorkload({ queueSize: 1 }));
      expect(el().querySelector('.banner.queue')!.textContent).toContain('1 claim is waiting in the queue');
    });

    it('omits the age when unknown', () => {
      setup(makeWorkload({ queueSize: 2, oldestQueueDays: null }));
      expect(el().querySelector('.banner.queue')!.textContent).not.toContain('oldest');
    });

    it('is hidden when the queue is empty', () => {
      setup(makeWorkload({ queueSize: 0 }));
      expect(el().querySelector('.banner.queue')).toBeNull();
    });
  });

  describe('my claims list', () => {
    beforeEach(() => setup());

    it('renders each claim with status, amount (assessed ?? claimed) and context', () => {
      const lines = el().querySelectorAll('.line');
      expect(lines.length).toBe(2);
      expect(lines[0].textContent).toContain('CLM-11');
      expect(lines[0].textContent).toContain('Aisha Rahman · Motor · SG');
      expect(lines[0].textContent).toContain('$4,000');
      expect(lines[1].textContent).toContain('$7,000');
      expect(lines[1].querySelector('.chip')!.textContent!.trim()).toBe('Assessed');
    });

    it('opens a claim on click', () => {
      (el().querySelector('.line') as HTMLButtonElement).click();
      expect(router.navigate).toHaveBeenCalledWith(['/claim', 11]);
    });

    it('links to the full filtered list', () => {
      const link = el().querySelector('.card-head a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(`/claims?assignedTo=${OFFICER.id}&openOnly=true`);
    });
  });

  it('shows an all-caught-up state with nothing assigned', () => {
    setup();
    api.listClaims.and.returnValue(of(paged([])));
    cmp.load();
    fixture.detectChanges();
    expect(el().querySelector('.empty h3')!.textContent).toBe("You're all caught up");
  });

  describe('pipeline', () => {
    it('is empty before the workload has loaded', () => {
      setup();
      cmp.w.set(null);
      expect(cmp.pipeline()).toEqual([]);
    });

    it('draws bars scaled against the largest bucket, in lifecycle order', () => {
      setup(makeWorkload({ byStatus: { Assessed: 1, UnderReview: 4, Approved: 2 } }));
      expect(cmp.pipeline().map(p => [p.status, p.count, p.pct])).toEqual([
        ['UnderReview', 4, 100], ['Assessed', 1, 25], ['Approved', 2, 50],
      ]);
      expect(el().querySelectorAll('.bar-row').length).toBe(3);
    });

    it('says so when nothing is assigned', () => {
      setup(makeWorkload({ byStatus: {} }));
      expect(cmp.pipeline()).toEqual([]);
      expect(text()).toContain('Nothing assigned yet.');
    });
  });

  it('refreshes both data sets on demand', () => {
    setup();
    (el().querySelector('.page-head .btn') as HTMLButtonElement).click();
    expect(api.workload).toHaveBeenCalledTimes(2);
    expect(api.listClaims).toHaveBeenCalledTimes(2);
  });
});
