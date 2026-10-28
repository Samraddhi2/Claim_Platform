import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import {
  ApiSpy, MANAGER, createApiSpy, makeDashboard, provideApiSpy,
} from '../../testing/fixtures';
import { AuthService } from '../core/auth.service';
import { Dashboard } from '../core/models';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  let api: ApiSpy;
  let router: Router;
  let fixture: ComponentFixture<DashboardComponent>;
  let cmp: DashboardComponent;

  function setup(data: Dashboard = makeDashboard()) {
    localStorage.removeItem('claims.user');
    api = createApiSpy();
    api.dashboard.and.returnValue(of(data));
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideApiSpy(api)] });
    TestBed.inject(AuthService).signIn(MANAGER);
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(DashboardComponent);
    cmp = fixture.componentInstance;
  }

  /** First render + the immediate first poll (fakeAsync tests). */
  function boot() { fixture.detectChanges(); tick(0); fixture.detectChanges(); }

  /** Same, for specs that run on real timers (the component is destroyed by TestBed afterwards). */
  async function bootReal() {
    fixture.detectChanges();
    await new Promise(r => setTimeout(r, 10));
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');

  afterEach(() => localStorage.removeItem('claims.user'));

  describe('polling (exposure is eventually consistent)', () => {
    it('loads immediately, quietly, and shows a spinner first', fakeAsync(() => {
      setup();
      fixture.detectChanges();
      expect(el().querySelector('.loading .spinner')).toBeTruthy();
      tick(0); fixture.detectChanges();
      expect(api.dashboard).toHaveBeenCalledOnceWith(true);
      expect(el().querySelector('.loading')).toBeNull();
      fixture.destroy();
    }));

    it('re-polls every 5 seconds', fakeAsync(() => {
      setup(); boot();
      tick(5000); tick(5000);
      expect(api.dashboard).toHaveBeenCalledTimes(3);
      fixture.destroy();
    }));

    it('picks up new numbers from a later poll', fakeAsync(() => {
      setup(); boot();
      api.dashboard.and.returnValue(of(makeDashboard({ totalOutstanding: 999000 })));
      tick(5000); fixture.detectChanges();
      expect(el().querySelector('.big')!.textContent).toBe('$999,000');
      fixture.destroy();
    }));

    it('keeps showing the last good data when a poll fails', fakeAsync(() => {
      setup(); boot();
      api.dashboard.and.returnValue(throwError(() => new Error('blip')));
      tick(5000); fixture.detectChanges();
      expect(el().querySelector('.big')!.textContent).toBe('$312,000');
      fixture.destroy();
    }));

    it('stops polling once destroyed', fakeAsync(() => {
      setup(); boot();
      fixture.destroy();
      tick(30_000);
      expect(api.dashboard).toHaveBeenCalledTimes(1);
    }));

    it('manual refresh is a loud (non-silent) call', fakeAsync(() => {
      setup(); boot();
      (el().querySelector('.page-head .btn.secondary') as HTMLButtonElement).click();
      expect(api.dashboard.calls.mostRecent().args).toEqual([]);
      fixture.destroy();
    }));
  });

  describe('headline numbers', () => {
    beforeEach(async () => { setup(); await bootReal(); });

    it('shows total outstanding exposure and open-claim count', () => {
      expect(el().querySelector('.big')!.textContent).toBe('$312,000');
      expect(text()).toContain('across 20 open claims');
    });

    it('shows the four KPIs', () => {
      const kpis = Array.from(el().querySelectorAll('.hero-kpis div')).map(d => d.textContent!.replace(/\s+/g, ' ').trim());
      expect(kpis).toEqual(['5in queue', '72.5%approval rate', '8.4davg. to decision', '30total claims']);
    });

    it('tells the user how fresh the read model is', () => {
      expect(el().querySelector('.live')!.textContent).toMatch(/Exposure updated .+/);
      expect(el().querySelector('.live')!.getAttribute('title')).toContain('read model');
    });
  });

  describe('before the first response', () => {
    it('derived rows are simply empty (no crash while loading)', fakeAsync(() => {
      setup();
      fixture.detectChanges(); // first poll has not fired yet
      expect(cmp.d()).toBeNull();
      expect(cmp.marketRows()).toEqual([]);
      expect(cmp.typeRows()).toEqual([]);
      expect(cmp.statusRows()).toEqual([]);
      tick(0);
      fixture.destroy();
    }));
  });

  describe('exposure by market', () => {
    it('sorts markets by exposure and scales bars against the largest', fakeAsync(() => {
      setup(); boot();
      expect(cmp.marketRows().map(r => r.key)).toEqual(['MY', 'SG', 'HK']);
      expect(cmp.marketRows().map(r => Math.round(r.pct))).toEqual([100, 25, 0]);
      expect(cmp.marketRows()[0].name).toBe('Malaysia');
      fixture.destroy();
    }));

    it('renders compact amounts and claim counts per market', fakeAsync(() => {
      setup(); boot();
      const first = el().querySelector('.bar-row')!;
      expect(first.textContent).toContain('Malaysia');
      expect(first.textContent).toContain('$200K');
      expect(first.querySelector('.bar-n')!.textContent).toBe('6');
      fixture.destroy();
    }));

    it('survives all-zero exposure (no NaN widths)', fakeAsync(() => {
      setup(makeDashboard({ exposureByMarket: [{ key: 'SG', openClaims: 0, outstandingAmount: 0 }] }));
      boot();
      expect(cmp.marketRows()[0].pct).toBe(0);
      fixture.destroy();
    }));

    it('falls back to the raw key for an unknown market', fakeAsync(() => {
      setup(makeDashboard({ exposureByMarket: [{ key: 'ZZ', openClaims: 1, outstandingAmount: 10 }] }));
      boot();
      expect(cmp.marketRows()[0].name).toBe('ZZ');
      fixture.destroy();
    }));
  });

  describe('exposure by type and by status', () => {
    it('splits Motor vs Property proportionally', fakeAsync(() => {
      setup(); boot();
      expect(cmp.typeRows().map(r => Math.round(r.pct))).toEqual([25, 75]);
      expect(el().querySelectorAll('.split-seg').length).toBe(2);
      expect(el().querySelector('.split-seg.alt')).toBeTruthy(); // Property segment
      expect(el().querySelector('.legend')!.textContent).toContain('$300K');
      fixture.destroy();
    }));

    it('does not divide by zero when there is no exposure at all', fakeAsync(() => {
      setup(makeDashboard({ exposureByType: [{ key: 'Motor', openClaims: 0, outstandingAmount: 0 }] }));
      boot();
      expect(cmp.typeRows()[0].pct).toBe(0);
      fixture.destroy();
    }));

    it('lists only statuses that have claims, in lifecycle order', fakeAsync(() => {
      setup(); boot();
      expect(cmp.statusRows()).toEqual([
        { status: 'Submitted', label: 'Submitted', count: 5 },
        { status: 'UnderReview', label: 'Under review', count: 6 },
        { status: 'Settled', label: 'Settled', count: 4 },
      ]);
      fixture.destroy();
    }));

    it('links each status chip to the filtered claims list', fakeAsync(() => {
      setup(); boot();
      const link = el().querySelector('a.status-link') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/claims?status=Submitted');
      fixture.destroy();
    }));
  });

  describe('team workload', () => {
    beforeEach(async () => { setup(); await bootReal(); });

    it('lists each officer with their numbers', () => {
      const rows = el().querySelectorAll('tbody tr');
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('Priya Sharma');
      expect(rows[0].textContent).toContain('$90,000');
    });

    it('flags a heavy load (6+ open claims)', () => {
      const loads = el().querySelectorAll('.load');
      expect(loads[0].classList).toContain('high');   // 7 open
      expect(loads[1].classList).not.toContain('high'); // 2 open
    });

    it('deep-links to that officer\'s open claims', () => {
      const link = el().querySelector('tbody a.btn') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/claims?assignedTo=5&openOnly=true');
    });
  });

  describe('high-value open claims', () => {
    it('lists them with the amount that matters (approved ?? assessed ?? claimed)', fakeAsync(() => {
      setup(); boot();
      const hv = el().querySelector('.hv')!;
      expect(hv.textContent).toContain('CLM-2026-000007');
      expect(hv.textContent).toContain('Wei Lin Tan · Malaysia');
      expect(hv.textContent).toContain('$85,000');
      fixture.destroy();
    }));

    it('opens the claim when clicked', fakeAsync(() => {
      setup(); boot();
      (el().querySelector('.hv') as HTMLButtonElement).click();
      expect(router.navigate).toHaveBeenCalledWith(['/claim', 7]);
      fixture.destroy();
    }));

    it('has an empty state', fakeAsync(() => {
      setup(makeDashboard({ highValueOpen: [] })); boot();
      expect(text()).toContain('No high-value claims are open.');
      fixture.destroy();
    }));
  });
});
