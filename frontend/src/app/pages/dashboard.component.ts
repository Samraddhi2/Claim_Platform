import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, of, switchMap, timer } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ClaimStatus, ClaimSummary, Dashboard } from '../core/models';
import { AgoPipe, MoneyPipe } from '../core/pipes';
import { MARKET_NAME, STATUS_LABEL } from '../core/util';
import { AvatarComponent } from '../shared/avatar.component';
import { IconComponent } from '../shared/icon.component';
import { StatusChipComponent } from '../shared/status-chip.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent, StatusChipComponent, MoneyPipe, AgoPipe],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>Portfolio overview</h1>
          <p class="sub">Outstanding liability and team workload across all markets.</p>
        </div>
        <div class="row">
          @if (d(); as dash) {
            <span class="live" title="Exposure is a read model rebuilt from claim events in the background">
              <span class="pulse"></span>
              Exposure updated {{ dash.exposureUpdatedAt | ago }}
            </span>
          }
          <button class="btn secondary" (click)="refresh()"><app-icon name="refresh" [size]="16" /> Refresh</button>
        </div>
      </div>

      @if (!d()) {
        <div class="loading"><div class="spinner"></div></div>
      } @else {
        <div class="hero card">
          <div>
            <span class="lbl">Total outstanding exposure</span>
            <div class="big">{{ d()!.totalOutstanding | money }}</div>
            <span class="lbl">across {{ d()!.openClaims }} open claims</span>
          </div>
          <div class="hero-kpis">
            <div><strong>{{ d()!.queueSize }}</strong><span>in queue</span></div>
            <div><strong>{{ d()!.approvalRatePct }}%</strong><span>approval rate</span></div>
            <div><strong>{{ d()!.avgDaysToDecision }}d</strong><span>avg. to decision</span></div>
            <div><strong>{{ d()!.totalClaims }}</strong><span>total claims</span></div>
          </div>
        </div>

        <div class="grid c2" style="margin-top:16px">
          <div class="card">
            <div class="card-head"><h2>Exposure by market</h2><span class="hint">Open claims, USD</span></div>
            @for (r of marketRows(); track r.key) {
              <div class="bar-row">
                <span class="bar-label">{{ r.name }}</span>
                <div class="bar"><div class="fill" [style.width.%]="r.pct"></div></div>
                <span class="bar-val mono">{{ r.outstandingAmount | money: true }}</span>
                <span class="bar-n faint mono">{{ r.openClaims }}</span>
              </div>
            }
          </div>

          <div class="stack">
            <div class="card">
              <div class="card-head"><h2>By claim type</h2></div>
              <div class="split">
                @for (t of typeRows(); track t.key) {
                  <div class="split-seg" [class.alt]="t.key === 'Property'" [style.flex-grow]="t.pct || 1"></div>
                }
              </div>
              <div class="legend">
                @for (t of typeRows(); track t.key) {
                  <div class="lg">
                    <span class="sw" [class.alt]="t.key === 'Property'"></span>
                    <span>{{ t.key }}</span>
                    <strong class="mono">{{ t.outstandingAmount | money: true }}</strong>
                    <small class="faint">{{ t.openClaims }} claims</small>
                  </div>
                }
              </div>
            </div>

            <div class="card">
              <div class="card-head"><h2>Claims by status</h2></div>
              <div class="stack-bar">
                @for (s of statusRows(); track s.status) {
                  <div [class]="'seg ' + s.status" [style.flex-grow]="s.count" [title]="s.label + ': ' + s.count"></div>
                }
              </div>
              <div class="chips">
                @for (s of statusRows(); track s.status) {
                  <a class="status-link" routerLink="/claims" [queryParams]="{ status: s.status }">
                    <span class="chip" [class]="s.status">{{ s.label }}</span>
                    <strong class="mono">{{ s.count }}</strong>
                  </a>
                }
              </div>
            </div>
          </div>
        </div>

        <div class="grid main-side" style="margin-top:16px">
          <div class="card flush">
            <div class="card-head pad"><h2>Team workload</h2><span class="hint">Last 30 days for decisions</span></div>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Officer</th><th class="num">Open</th><th class="num">Exposure</th><th class="num">Decided</th><th class="num">Avg. days</th><th></th></tr></thead>
                <tbody>
                  @for (m of d()!.team; track m.officerId) {
                    <tr>
                      <td><div class="row"><app-avatar [name]="m.name" size="sm" /> <strong>{{ m.name }}</strong></div></td>
                      <td class="num">
                        <span class="load" [class.high]="m.openClaims >= 6">{{ m.openClaims }}</span>
                      </td>
                      <td class="num">{{ m.exposure | money }}</td>
                      <td class="num">{{ m.decidedLast30Days }}</td>
                      <td class="num">{{ m.avgDaysToDecision }}</td>
                      <td class="num">
                        <a class="btn ghost sm" routerLink="/claims" [queryParams]="{ assignedTo: m.officerId, openOnly: true }">View claims</a>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h2>High-value open claims</h2>
            </div>
            <p class="muted small" style="margin-bottom:10px">Above $50,000 - approval needs a manager.</p>
            @for (c of d()!.highValueOpen; track c.id) {
              <button class="hv" (click)="open(c)">
                <span class="grow">
                  <strong>{{ c.claimNumber }}</strong>
                  <small class="muted">{{ c.claimantName }} · {{ marketName[c.market] }}</small>
                </span>
                <span class="right">
                  <strong class="mono">{{ (c.approvedAmount ?? c.assessedAmount ?? c.claimedAmount) | money }}</strong>
                  <app-status-chip [status]="c.status" />
                </span>
              </button>
            } @empty {
              <p class="muted">No high-value claims are open.</p>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .live { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); background: #fff; border: 1px solid var(--line); padding: 7px 12px; border-radius: 999px; }
    .pulse { width: 8px; height: 8px; border-radius: 50%; background: #19b07f; animation: pulse 2s infinite; }
    .hero { display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap; padding: 26px 28px;
      background: linear-gradient(135deg, #0e1633, #1a2468); color: #fff; border: 0; }
    .hero .lbl { color: #aab4e6; font-size: 13.5px; }
    .big { font-family: var(--font-display); font-size: 46px; font-weight: 600; line-height: 1.15; letter-spacing: -0.02em; }
    .hero-kpis { display: grid; grid-template-columns: repeat(4, auto); gap: 8px 34px; }
    .hero-kpis div { display: flex; flex-direction: column; }
    .hero-kpis strong { font-family: var(--font-display); font-size: 26px; font-weight: 600; }
    .hero-kpis span { color: #aab4e6; font-size: 13px; }

    .bar-row { display: flex; align-items: center; gap: 12px; margin: 13px 0; }
    .bar-label { width: 92px; font-size: 13.5px; color: var(--text); }
    .bar { flex: 1; height: 12px; background: var(--line-2); border-radius: 99px; overflow: hidden; }
    .fill { height: 100%; border-radius: 99px; background: linear-gradient(90deg, #4a5dff, #243bff); transition: width .6s cubic-bezier(.2,.8,.2,1); }
    .bar-val { width: 62px; text-align: right; font-weight: 600; }
    .bar-n { width: 28px; text-align: right; font-size: 12.5px; }

    .split { display: flex; gap: 4px; height: 14px; }
    .split-seg { border-radius: 99px; background: var(--brand); transition: flex-grow .5s; }
    .split-seg.alt, .sw.alt { background: var(--violet); }
    .legend { display: flex; gap: 28px; margin-top: 14px; flex-wrap: wrap; }
    .lg { display: flex; align-items: center; gap: 8px; }
    .sw { width: 10px; height: 10px; border-radius: 3px; background: var(--brand); }

    .stack-bar { display: flex; gap: 3px; height: 14px; }
    .seg { border-radius: 99px; background: var(--brand); min-width: 8px; transition: flex-grow .5s; }
    .seg.Submitted { background: #9aa6cf; } .seg.UnderReview { background: var(--brand); } .seg.InfoRequested { background: var(--amber); }
    .seg.Assessed { background: var(--violet); } .seg.Approved { background: var(--teal); } .seg.Settled { background: #06604a; }
    .seg.Rejected { background: var(--red); } .seg.Withdrawn { background: #b6bbca; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 14px; }
    .status-link { display: inline-flex; align-items: center; gap: 6px; color: var(--text); }
    .status-link:hover { text-decoration: none; opacity: .8; }

    .pad { padding: 18px 20px 12px; margin: 0; }
    .load { display: inline-block; min-width: 28px; text-align: center; padding: 2px 8px; border-radius: 99px; background: var(--brand-50); color: var(--brand-600); font-weight: 700; }
    .load.high { background: var(--amber-50); color: #8a5a00; }
    .hv { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; text-align: left; border: 0; background: transparent;
      padding: 12px 10px; margin: 0 -10px; border-radius: 10px; cursor: pointer; color: var(--text); border-top: 1px solid var(--line-2); width: calc(100% + 20px); }
    .hv:hover { background: #f7f8fd; }
    .hv .grow { display: flex; flex-direction: column; }
    .hv .right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    @media (max-width: 720px) { .hero-kpis { grid-template-columns: repeat(2, auto); } .big { font-size: 36px; } }
  `],
})
export class DashboardComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  d = signal<Dashboard | null>(null);
  marketName = MARKET_NAME;

  marketRows = computed(() => {
    const rows = this.d()?.exposureByMarket ?? [];
    const max = Math.max(1, ...rows.map(r => r.outstandingAmount));
    return rows
      .map(r => ({ ...r, name: MARKET_NAME[r.key as keyof typeof MARKET_NAME] ?? r.key, pct: (r.outstandingAmount / max) * 100 }))
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount);
  });

  typeRows = computed(() => {
    const rows = this.d()?.exposureByType ?? [];
    const total = rows.reduce((s, r) => s + r.outstandingAmount, 0) || 1;
    return rows.map(r => ({ ...r, pct: (r.outstandingAmount / total) * 100 }));
  });

  statusRows = computed(() => {
    const by = this.d()?.byStatus ?? {};
    return (Object.keys(STATUS_LABEL) as ClaimStatus[])
      .filter(s => by[s])
      .map(s => ({ status: s, label: STATUS_LABEL[s], count: by[s] }));
  });

  ngOnInit() {
    // Re-poll quietly: exposure is eventually consistent, so changes made elsewhere appear here within seconds.
    timer(0, 5000).pipe(
      switchMap(() => this.api.dashboard(true).pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(d => { if (d) this.d.set(d); });
  }

  refresh() { this.api.dashboard().subscribe(d => this.d.set(d)); }

  open(c: ClaimSummary) { this.router.navigate(['/claim', c.id]); }
}
