import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ClaimStatus, ClaimSummary, Workload } from '../core/models';
import { AgoPipe, MoneyPipe } from '../core/pipes';
import { STATUS_LABEL } from '../core/util';
import { IconComponent } from '../shared/icon.component';
import { StatusChipComponent } from '../shared/status-chip.component';

@Component({
  selector: 'app-workload',
  standalone: true,
  imports: [RouterLink, IconComponent, StatusChipComponent, MoneyPipe, AgoPipe],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>Good to see you, {{ firstName }}</h1>
          <p class="sub">Here's what needs your attention today.</p>
        </div>
        <button class="btn secondary" (click)="load()"><app-icon name="refresh" [size]="16" /> Refresh</button>
      </div>

      @if (!w()) {
        <div class="loading"><div class="spinner"></div></div>
      } @else {
        @if (w()!.queueSize > 0) {
          <div class="banner info queue">
            <app-icon name="inbox" [size]="20" />
            <div>
              <strong>{{ w()!.queueSize }} {{ w()!.queueSize === 1 ? 'claim is' : 'claims are' }} waiting in the queue</strong>
              @if (w()!.oldestQueueDays !== null) { <span> · the oldest has waited {{ w()!.oldestQueueDays }} days</span> }
            </div>
            <span class="spacer"></span>
            <a class="btn sm" routerLink="/queue">Open the queue</a>
          </div>
        }

        <div class="grid c4 stats">
          <div class="card stat">
            <span class="ico brand"><app-icon name="briefcase" /></span>
            <div class="val">{{ w()!.openClaims }}</div>
            <div class="lbl">Open claims assigned to you</div>
          </div>
          <div class="card stat">
            <span class="ico amber"><app-icon name="zap" /></span>
            <div class="val">{{ w()!.awaitingMyAction }}</div>
            <div class="lbl">Waiting on you</div>
          </div>
          <div class="card stat">
            <span class="ico violet"><app-icon name="clock" /></span>
            <div class="val">{{ w()!.awaitingClaimant }}</div>
            <div class="lbl">Waiting on claimants</div>
          </div>
          <div class="card stat">
            <span class="ico teal"><app-icon name="dollar" /></span>
            <div class="val">{{ w()!.myExposure | money: true }}</div>
            <div class="lbl">Outstanding exposure</div>
          </div>
        </div>

        <div class="grid main-side" style="margin-top:16px">
          <div class="card flush">
            <div class="card-head pad">
              <h2>Your open claims, oldest first</h2>
              <a routerLink="/claims" [queryParams]="{ assignedTo: me, openOnly: true }" class="small">View all mine</a>
            </div>
            @if (action().length === 0) {
              <div class="empty">
                <app-icon name="check" [size]="32" />
                <h3>You're all caught up</h3>
                <p>Pick up a claim from the queue to get started.</p>
              </div>
            } @else {
              @for (c of action(); track c.id) {
                <button class="line" (click)="open(c)">
                  <span class="grow">
                    <strong>{{ c.claimNumber }}</strong>
                    <small class="muted">{{ c.claimantName }} · {{ c.type }} · {{ c.market }}</small>
                  </span>
                  <app-status-chip [status]="c.status" />
                  <span class="amt mono">{{ (c.assessedAmount ?? c.claimedAmount) | money }}</span>
                  <small class="faint when">{{ c.updatedAt | ago }}</small>
                  <app-icon name="chevron" [size]="16" />
                </button>
              }
            }
          </div>

          <div class="stack">
            <div class="card">
              <div class="card-head"><h2>My pipeline</h2></div>
              @for (row of pipeline(); track row.status) {
                <div class="bar-row">
                  <span class="bar-label">{{ row.label }}</span>
                  <div class="bar"><div [style.width.%]="row.pct" [class]="'fill ' + row.status"></div></div>
                  <span class="bar-n mono">{{ row.count }}</span>
                </div>
              } @empty {
                <p class="muted">Nothing assigned yet.</p>
              }
            </div>
            <div class="card">
              <div class="card-head"><h2>My performance</h2></div>
              <div class="kv"><span>Decisions in the last 30 days</span><strong>{{ w()!.decidedLast30Days }}</strong></div>
              <div class="kv"><span>Average time to decision</span><strong>{{ w()!.avgDaysToDecision }} days</strong></div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .queue { margin-bottom: 16px; }
    .stat { display: flex; flex-direction: column; gap: 4px; }
    .ico { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; margin-bottom: 8px; }
    .ico.brand { background: var(--brand-50); color: var(--brand); }
    .ico.amber { background: var(--amber-50); color: #b97a00; }
    .ico.violet { background: var(--violet-50); color: var(--violet); }
    .ico.teal { background: var(--teal-50); color: var(--teal); }
    .val { font-family: var(--font-display); font-size: 30px; font-weight: 600; line-height: 1.1; }
    .lbl { color: var(--muted); font-size: 13.5px; }
    .pad { padding: 18px 20px 0; }
    .line { display: flex; align-items: center; gap: 14px; width: 100%; padding: 14px 20px; background: #fff; border: 0; border-top: 1px solid var(--line-2);
      text-align: left; cursor: pointer; color: var(--text); font-size: 14px; }
    .line:hover { background: #f7f8fd; }
    .line .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .amt { font-weight: 600; min-width: 70px; text-align: right; }
    .when { min-width: 72px; text-align: right; }
    .bar-row { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
    .bar-label { width: 104px; font-size: 13px; color: var(--muted); }
    .bar { flex: 1; height: 8px; background: var(--line-2); border-radius: 99px; overflow: hidden; }
    .fill { height: 100%; border-radius: 99px; background: var(--brand); transition: width .5s ease; }
    .fill.InfoRequested { background: var(--amber); } .fill.Assessed { background: var(--violet); }
    .fill.Approved, .fill.Settled { background: var(--teal); } .fill.Rejected { background: var(--red); } .fill.Withdrawn { background: var(--faint); }
    .bar-n { width: 24px; text-align: right; font-weight: 600; }
    .kv { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid var(--line-2); color: var(--muted); }
    .kv:last-child { border-bottom: 0; }
    .kv strong { color: var(--text); }
  `],
})
export class WorkloadComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);
  private auth = inject(AuthService);

  w = signal<Workload | null>(null);
  action = signal<ClaimSummary[]>([]);

  me = this.auth.user()!.id;
  firstName = this.auth.user()!.name.split(' ')[0];

  pipeline = computed(() => {
    const by = this.w()?.byStatus ?? {};
    const max = Math.max(1, ...Object.values(by));
    return (Object.keys(STATUS_LABEL) as ClaimStatus[])
      .filter(s => by[s])
      .map(s => ({ status: s, label: STATUS_LABEL[s], count: by[s], pct: (by[s] / max) * 100 }));
  });

  ngOnInit() { this.load(); }

  load() {
    forkJoin({
      w: this.api.workload(),
      list: this.api.listClaims({ assignedTo: this.me, openOnly: true, sort: 'oldest', pageSize: 8 }),
    }).subscribe(({ w, list }) => {
      this.w.set(w);
      this.action.set(list.items);
    });
  }

  open(c: ClaimSummary) { this.router.navigate(['/claim', c.id]); }
}
