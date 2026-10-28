import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Role, User } from '../core/models';
import { MARKET_NAME } from '../core/util';
import { AvatarComponent } from '../shared/avatar.component';
import { IconComponent } from '../shared/icon.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, AvatarComponent, IconComponent],
  template: `
    <div class="wrap">
      <section class="hero">
        <div class="hero-inner">
          <span class="logo"><app-icon name="shield" [size]="26" /></span>
          <h1>Claims Desk</h1>
          <p class="lead">One place to file, review and settle motor and property claims across the APAC region.</p>

          <ul class="points">
            <li><app-icon name="zap" /> Event-driven: notifications and exposure update in the background</li>
            <li><app-icon name="check" /> Every decision recorded in an audit trail</li>
            <li><app-icon name="users" /> Role-based views for claimants, officers and managers</li>
          </ul>
        </div>
      </section>

      <section class="pick">
        <div class="pick-inner">
          <h2>Sign in to a demo account</h2>
          <p class="muted">Pick a persona to explore the platform from their point of view.</p>

          @if (loading()) {
            <div class="loading"><div class="spinner"></div></div>
          } @else if (failed()) {
            <div class="banner warn">
              <app-icon name="alert" />
              <div>
                <strong>Can't reach the backend.</strong>
                <div class="small">Start the API on http://localhost:5080, then retry.</div>
              </div>
              <span class="spacer"></span>
              <button class="btn secondary sm" (click)="load()"><app-icon name="refresh" [size]="15" /> Retry</button>
            </div>
          } @else {
            @for (g of groups(); track g.role) {
              <h3 class="group">{{ g.title }}</h3>
              <div class="cards">
                @for (u of g.users; track u.id) {
                  <button class="persona" [disabled]="busyId() !== null" (click)="enter(u)">
                    <app-avatar [name]="u.name" size="lg" />
                    <span class="meta">
                      <strong>{{ u.name }}</strong>
                      <small>{{ g.blurb }}{{ u.market ? ' · ' + marketName(u.market) : '' }}</small>
                    </span>
                    @if (busyId() === u.id) { <span class="spinner sm"></span> } @else { <app-icon name="chevron" /> }
                  </button>
                }
              </div>
            }

            <div class="or"><span>or sign in with an email</span></div>
            <div class="row">
              <input class="input" type="email" placeholder="e.g. priya@demo.com" [(ngModel)]="email" (keyup.enter)="emailLogin()" />
              <button class="btn" [disabled]="!email.trim() || busyId() !== null" (click)="emailLogin()">Sign in</button>
            </div>
          }
        </div>
      </section>
    </div>
  `,
  styles: [`
    .wrap { display: grid; grid-template-columns: minmax(340px, 5fr) 7fr; min-height: 100vh; }
    .hero { background: radial-gradient(1200px 600px at 0% 0%, #2a3cff 0%, transparent 55%), linear-gradient(160deg, #0e1633, #131c4a 60%, #1a2468);
      color: #fff; display: flex; align-items: center; padding: 56px; }
    .hero-inner { max-width: 440px; }
    .logo { width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; margin-bottom: 28px;
      background: linear-gradient(140deg, #4a5dff, #243bff); box-shadow: 0 14px 30px -8px rgba(36,59,255,.8); }
    .hero h1 { font-size: 44px; line-height: 1.05; margin-bottom: 16px; }
    .lead { color: #c3cbf0; font-size: 17px; line-height: 1.55; margin-bottom: 34px; }
    .points { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; color: #dbe0fa; }
    .points li { display: flex; gap: 12px; align-items: flex-start; }
    .points app-icon { color: #7f8dff; margin-top: 2px; }

    .pick { display: flex; align-items: center; justify-content: center; padding: 40px 24px; }
    .pick-inner { width: 100%; max-width: 620px; animation: rise .4s ease both; }
    .pick h2 { font-size: 26px; margin-bottom: 6px; }
    .group { margin: 26px 0 10px; font-size: 13px; color: var(--muted); font-family: var(--font); font-weight: 600; }
    .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .persona { display: flex; align-items: center; gap: 14px; text-align: left; background: #fff; border: 1px solid var(--line);
      border-radius: 14px; padding: 14px 16px; cursor: pointer; transition: transform .15s, box-shadow .15s, border-color .15s; color: var(--text); }
    .persona:hover:not([disabled]) { transform: translateY(-2px); box-shadow: var(--shadow); border-color: var(--brand); }
    .persona[disabled] { opacity: .6; cursor: wait; }
    .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .meta small { color: var(--muted); }
    .spinner.sm { width: 18px; height: 18px; border-width: 2px; }
    .or { display: flex; align-items: center; gap: 12px; color: var(--faint); font-size: 13px; margin: 26px 0 14px; }
    .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line); }

    @media (max-width: 860px) {
      .wrap { grid-template-columns: 1fr; }
      .hero { padding: 36px 24px; }
      .hero h1 { font-size: 32px; }
      .points { display: none; }
      .cards { grid-template-columns: 1fr; }
    }
  `],
})
export class LoginComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  users = signal<User[]>([]);
  loading = signal(true);
  failed = signal(false);
  busyId = signal<number | null>(null);
  email = '';

  groups = computed(() => {
    const defs: { role: Role; title: string; blurb: string }[] = [
      { role: 'Claimant', title: 'Policyholders', blurb: 'Claimant' },
      { role: 'Officer', title: 'Claims officers', blurb: 'Claims officer' },
      { role: 'Manager', title: 'Management', blurb: 'Claims manager' },
    ];
    return defs
      .map(d => ({ ...d, users: this.users().filter(u => u.role === d.role) }))
      .filter(g => g.users.length > 0);
  });

  ngOnInit() {
    // already signed in? go straight to the right home page
    const existing = this.auth.user();
    if (existing) { this.router.navigateByUrl(this.auth.homeFor(existing.role)); return; }
    this.load();
  }

  load() {
    this.loading.set(true);
    this.failed.set(false);
    this.api.users().subscribe({
      next: users => { this.users.set(users); this.loading.set(false); },
      error: () => { this.failed.set(true); this.loading.set(false); },
    });
  }

  marketName(m: string) { return MARKET_NAME[m as keyof typeof MARKET_NAME] ?? m; }

  enter(user: User) {
    this.busyId.set(user.id);
    // go through the real login endpoint so the backend is exercised
    this.api.login(user.email).subscribe({
      next: u => this.finish(u),
      error: () => this.busyId.set(null),
    });
  }

  emailLogin() {
    if (!this.email.trim()) return;
    this.busyId.set(-1);
    this.api.login(this.email).subscribe({
      next: u => this.finish(u),
      error: () => this.busyId.set(null),
    });
  }

  private finish(u: User) {
    this.auth.signIn(u);
    this.router.navigateByUrl(this.auth.homeFor(u.role));
  }
}
