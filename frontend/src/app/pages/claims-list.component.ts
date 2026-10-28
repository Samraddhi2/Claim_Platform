import { Component, DestroyRef, Input, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ClaimFilter, ClaimStatus, ClaimSummary, ClaimType, Market, User } from '../core/models';
import { AgoPipe, MoneyPipe } from '../core/pipes';
import { ToastService } from '../core/toast.service';
import { ALL_STATUSES, MARKETS, MARKET_NAME, STATUS_LABEL } from '../core/util';
import { AvatarComponent } from '../shared/avatar.component';
import { IconComponent } from '../shared/icon.component';
import { StatusChipComponent } from '../shared/status-chip.component';

type Mode = 'mine' | 'queue' | 'all';
type Tab = 'all' | 'open' | 'info';

@Component({
  selector: 'app-claims-list',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, StatusChipComponent, AvatarComponent, MoneyPipe, AgoPipe],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>{{ title() }}</h1>
          <p class="sub">{{ subtitle() }}</p>
        </div>
        <div class="row">
          <button class="btn secondary" (click)="load()" [disabled]="loading()"><app-icon name="refresh" [size]="16" /> Refresh</button>
          @if (mode === 'mine') {
            <a class="btn" routerLink="/new-claim"><app-icon name="plus" [size]="16" /> New claim</a>
          }
        </div>
      </div>

      <div class="card flush">
        <div class="toolbar">
          @if (mode === 'mine') {
            <div class="segmented">
              <button [class.on]="tab === 'all'" (click)="setTab('all')">All</button>
              <button [class.on]="tab === 'open'" (click)="setTab('open')">Open</button>
              <button [class.on]="tab === 'info'" (click)="setTab('info')">Needs my reply</button>
            </div>
          }

          <div class="input-wrap grow">
            <app-icon name="search" [size]="16" />
            <input class="input sm" placeholder="Search claim no., policy or name" [(ngModel)]="search" (ngModelChange)="search$.next($event)" />
          </div>

          @if (mode === 'all') {
            <select class="select sm" [(ngModel)]="status" (ngModelChange)="reset()">
              <option value="">Any status</option>
              @for (s of statuses; track s) { <option [value]="s">{{ statusLabel[s] }}</option> }
            </select>
          }
          @if (mode !== 'queue') {
            <select class="select sm" [(ngModel)]="type" (ngModelChange)="reset()">
              <option value="">Any type</option>
              <option value="Motor">Motor</option>
              <option value="Property">Property</option>
            </select>
          }
          @if (mode !== 'mine') {
            <select class="select sm" [(ngModel)]="market" (ngModelChange)="reset()">
              <option value="">All markets</option>
              @for (m of markets; track m) { <option [value]="m">{{ marketName[m] }}</option> }
            </select>
          }
          @if (mode === 'all') {
            <select class="select sm" [(ngModel)]="assignee" (ngModelChange)="reset()">
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              @for (o of officers(); track o.id) { <option [value]="o.id">{{ o.name }}</option> }
            </select>
            <label class="check"><input type="checkbox" [(ngModel)]="openOnly" (ngModelChange)="reset()" /> Open only</label>
          }
          @if (mode !== 'mine') {
            <button class="btn ghost sm" (click)="toggleSort()" [title]="'Sorted: ' + sort">
              <app-icon name="clock" [size]="15" /> {{ sort === 'oldest' ? 'Oldest first' : 'Recently updated' }}
            </button>
          }
        </div>

        @if (loading() && !data()) {
          <div class="loading"><div class="spinner"></div></div>
        } @else if (items().length === 0) {
          <div class="empty">
            <app-icon name="inbox" [size]="36" />
            <h3>{{ mode === 'queue' ? 'The queue is clear' : 'No claims found' }}</h3>
            <p>{{ mode === 'queue' ? 'Nothing is waiting for an officer right now.' : 'Try changing the filters or search.' }}</p>
            @if (mode === 'mine') {
              <p style="margin-top:16px"><a class="btn" routerLink="/new-claim"><app-icon name="plus" [size]="16" /> File a claim</a></p>
            }
          </div>
        } @else {
          <div class="table-wrap" [class.dim]="loading()">
            <table class="table">
              <thead>
                <tr>
                  <th>Claim</th>
                  @if (mode !== 'mine') { <th>Claimant</th> }
                  @if (mode === 'all') { <th>Market</th> }
                  @if (mode !== 'queue') { <th>Status</th> }
                  @if (mode === 'all') { <th>Assigned to</th> }
                  <th class="num">{{ mode === 'queue' ? 'Claimed' : 'Exposure' }}</th>
                  <th>{{ mode === 'queue' ? 'Waiting' : 'Updated' }}</th>
                  @if (mode === 'queue') { <th></th> }
                </tr>
              </thead>
              <tbody>
                @for (c of items(); track c.id) {
                  <tr class="click" (click)="open(c)">
                    <td>
                      <div class="claim-cell">
                        <span class="type-ico" [class.property]="c.type === 'Property'"><app-icon [name]="c.type === 'Motor' ? 'car' : 'home'" [size]="17" /></span>
                        <span>
                          <a class="strong" [routerLink]="['/claim', c.id]" (click)="$event.stopPropagation()">{{ c.claimNumber }}</a>
                          <div class="small muted">{{ c.type }} · {{ c.policyNumber }}</div>
                        </span>
                      </div>
                    </td>
                    @if (mode !== 'mine') {
                      <td><div class="row"><app-avatar [name]="c.claimantName" size="sm" /> {{ c.claimantName }}</div></td>
                    }
                    @if (mode === 'all') { <td><span class="tag">{{ c.market }}</span></td> }
                    @if (mode !== 'queue') { <td><app-status-chip [status]="c.status" /></td> }
                    @if (mode === 'all') {
                      <td>
                        @if (c.assignedOfficerName) {
                          <div class="row"><app-avatar [name]="c.assignedOfficerName" size="sm" /> {{ c.assignedOfficerName }}</div>
                        } @else { <span class="faint">Unassigned</span> }
                      </td>
                    }
                    <td class="num strong">{{ (mode === 'queue' ? c.claimedAmount : (c.approvedAmount ?? c.assessedAmount ?? c.claimedAmount)) | money }}</td>
                    <td class="muted">{{ (mode === 'queue' ? c.createdAt : c.updatedAt) | ago }}</td>
                    @if (mode === 'queue') {
                      <td class="num">
                        <button class="btn sm" [disabled]="busyId() === c.id" (click)="pickUp(c, $event)">
                          @if (busyId() === c.id) { <span class="spin"></span> } @else { <app-icon name="user-plus" [size]="15" /> }
                          {{ auth.isManager() ? 'Assign to me' : 'Pick up' }}
                        </button>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="pager">
            <span>Showing {{ from() }}–{{ to() }} of {{ total() }}</span>
            <div class="row">
              <button class="btn secondary sm" [disabled]="page <= 1 || loading()" (click)="go(page - 1)">Previous</button>
              <span class="faint">Page {{ page }} of {{ pages() }}</span>
              <button class="btn secondary sm" [disabled]="page >= pages() || loading()" (click)="go(page + 1)">Next</button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--line-2); }
    .grow { flex: 1; min-width: 220px; }
    .toolbar .select { width: auto; min-width: 140px; }
    .check { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--muted); cursor: pointer; }
    .claim-cell { display: flex; align-items: center; gap: 12px; }
    .type-ico { width: 36px; height: 36px; border-radius: 10px; background: var(--brand-50); color: var(--brand); display: grid; place-items: center; flex: none; }
    .type-ico.property { background: var(--violet-50); color: var(--violet); }
    .claim-cell a { color: var(--text); }
    .claim-cell a:hover { color: var(--brand); }
    .dim { opacity: .55; transition: opacity .15s; }
  `],
})
export class ClaimsListComponent implements OnInit {
  @Input() mode: Mode = 'all';

  auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  statuses = ALL_STATUSES;
  statusLabel = STATUS_LABEL;
  markets = MARKETS;
  marketName = MARKET_NAME;

  officers = signal<User[]>([]);
  data = signal<{ items: ClaimSummary[]; total: number } | null>(null);
  loading = signal(false);
  busyId = signal<number | null>(null);

  items = computed(() => this.data()?.items ?? []);
  total = computed(() => this.data()?.total ?? 0);
  pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize)));
  // plain getters: `page` is not a signal, so computed() would go stale when paging
  from(): number { return this.total() === 0 ? 0 : (this.page - 1) * this.pageSize + 1; }
  to(): number { return Math.min(this.page * this.pageSize, this.total()); }

  // filter state
  search = '';
  status: ClaimStatus | '' = '';
  type: ClaimType | '' = '';
  market: Market | '' = '';
  assignee: string = '';
  openOnly = false;
  tab: Tab = 'all';
  sort: 'newest' | 'oldest' = 'newest';
  page = 1;
  readonly pageSize = 10;
  search$ = new Subject<string>();

  title = computed(() => ({ mine: 'My claims', queue: 'Claim queue', all: 'All claims' }[this.mode]));
  subtitle = computed(() => ({
    mine: "Track every claim you've filed and respond when we need more information.",
    queue: 'Submitted claims waiting for an officer. Pick one up to start the review.',
    all: 'Search and filter every claim across all markets.',
  }[this.mode]));

  ngOnInit() {
    if (this.mode === 'queue') this.sort = 'oldest';

    if (this.mode === 'all') {
      this.api.officers().subscribe(o => this.officers.set(o));
    }

    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reset());

    // deep links such as /claims?assignedTo=3&openOnly=true (used by the manager dashboard)
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(q => {
      if (this.mode === 'all') {
        this.assignee = q.get('assignedTo') ?? '';
        this.status = (q.get('status') as ClaimStatus) ?? '';
        this.openOnly = q.get('openOnly') === 'true';
      }
      this.page = 1;
      this.load();
    });
  }

  setTab(t: Tab) { this.tab = t; this.reset(); }
  toggleSort() { this.sort = this.sort === 'oldest' ? 'newest' : 'oldest'; this.reset(); }
  reset() { this.page = 1; this.load(); }
  go(p: number) { this.page = p; this.load(); }

  load() {
    const f: ClaimFilter = { search: this.search, page: this.page, pageSize: this.pageSize, sort: this.sort };
    if (this.mode === 'mine') {
      f.type = this.type;
      if (this.tab === 'open') f.openOnly = true;
      if (this.tab === 'info') f.status = 'InfoRequested';
    } else if (this.mode === 'queue') {
      f.unassigned = true;
      f.market = this.market;
    } else {
      f.status = this.status; f.type = this.type; f.market = this.market; f.openOnly = this.openOnly;
      if (this.assignee === 'me') f.assignedTo = this.auth.user()!.id;
      else if (this.assignee) f.assignedTo = Number(this.assignee);
    }

    this.loading.set(true);
    const req = this.mode === 'mine' ? this.api.myClaims(f) : this.api.listClaims(f);
    req.subscribe({
      next: r => { this.data.set({ items: r.items, total: r.total }); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  open(c: ClaimSummary) { this.router.navigate(['/claim', c.id]); }

  pickUp(c: ClaimSummary, e: Event) {
    e.stopPropagation();
    this.busyId.set(c.id);
    this.api.assign(c.id, this.auth.user()!.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toast.success(`${c.claimNumber} is now yours to review.`);
        this.router.navigate(['/claim', c.id]);
      },
      error: () => { this.busyId.set(null); this.load(); },
    });
  }
}
