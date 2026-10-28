import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { catchError, forkJoin, of, switchMap, timer } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { NotificationItem, SystemInfo } from '../core/models';
import { ToastService } from '../core/toast.service';
import { AgoPipe } from '../core/pipes';
import { AvatarComponent } from '../shared/avatar.component';
import { IconComponent } from '../shared/icon.component';

interface NavItem { label: string; icon: string; link: string; }

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, AvatarComponent, AgoPipe],
  template: `
    <div class="layout">
      <aside class="side">
        <a class="brand" [routerLink]="auth.homeFor(user()!.role)">
          <span class="logo"><app-icon name="shield" [size]="20" /></span>
          <span>
            <strong>Claims Desk</strong>
            <small>APAC operations</small>
          </span>
        </a>

        <nav>
          <span class="nav-label">{{ roleLabel() }}</span>
          @for (item of nav(); track item.link) {
            <a class="nav-item" [routerLink]="item.link" routerLinkActive="active">
              <app-icon [name]="item.icon" />
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>

        <div class="me">
          <app-avatar [name]="user()!.name" />
          <div class="who">
            <strong>{{ user()!.name }}</strong>
            <small>{{ user()!.role }}{{ user()!.market ? ' · ' + user()!.market : '' }}</small>
          </div>
          <button class="icon-btn" title="Sign out" aria-label="Sign out" (click)="auth.signOut()">
            <app-icon name="logout" />
          </button>
        </div>
      </aside>

      <div class="main">
        <header class="top">
          <div class="bus" [title]="busTitle()">
            <span class="dot" [class.live]="!!info()" [class.off]="!info()"></span>
            @if (info(); as i) {
              <span>Event bus: <strong>{{ i.messagingProvider }}</strong></span>
              @if (i.pendingOutbox > 0) { <span class="pending">{{ i.pendingOutbox }} in flight</span> }
            } @else {
              <span>Backend offline</span>
            }
          </div>

          <div class="bell-wrap">
            <button class="icon-btn bell" aria-label="Notifications" (click)="toggleBell($event)">
              <app-icon name="bell" [size]="20" />
              @if (unread() > 0) { <span class="badge">{{ unread() > 9 ? '9+' : unread() }}</span> }
            </button>

            @if (bellOpen()) {
              <div class="panel" (click)="$event.stopPropagation()">
                <div class="panel-head">
                  <h3>Notifications</h3>
                  <button class="btn ghost sm" [disabled]="unread() === 0" (click)="markAll()">Mark all read</button>
                </div>
                <div class="panel-body">
                  @for (n of notifications(); track n.id) {
                    <button class="note" [class.unread]="!n.isRead" (click)="openNotification(n)">
                      <span class="pip"></span>
                      <span class="txt">
                        <span>{{ n.message }}</span>
                        <small>{{ n.claimNumber }} · {{ n.createdAt | ago }}</small>
                      </span>
                    </button>
                  } @empty {
                    <div class="empty small">
                      <app-icon name="bell" [size]="26" />
                      <h3>All caught up</h3>
                      <p>Updates about your claims show up here.</p>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </header>

        <main><router-outlet /></main>
      </div>
    </div>
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh; }
    .side { background: var(--ink); color: #c9d0ee; display: flex; flex-direction: column; padding: 20px 14px; position: sticky; top: 0; height: 100vh; }
    .brand { display: flex; align-items: center; gap: 12px; padding: 4px 8px 22px; color: #fff; text-decoration: none; }
    .brand:hover { text-decoration: none; }
    .logo { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; color: #fff;
      background: linear-gradient(140deg, #3d52ff, #1a2cd1); box-shadow: 0 6px 16px -4px rgba(36,59,255,.7); }
    .brand strong { display: block; font-family: var(--font-display); font-size: 16px; line-height: 1.1; }
    .brand small { color: #8f9acb; font-size: 12px; }
    nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
    .nav-label { font-size: 12px; color: #7581b8; padding: 6px 12px 8px; font-weight: 600; }
    .nav-item { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 10px; color: #c9d0ee;
      font-weight: 500; text-decoration: none; transition: background .15s, color .15s; }
    .nav-item:hover { background: rgba(255,255,255,.06); color: #fff; text-decoration: none; }
    .nav-item.active { background: var(--brand); color: #fff; box-shadow: 0 6px 18px -6px rgba(36,59,255,.8); }
    .me { display: flex; align-items: center; gap: 10px; padding: 12px; background: var(--ink-2); border-radius: 12px; }
    .who { flex: 1; min-width: 0; }
    .who strong { display: block; color: #fff; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .who small { color: #8f9acb; font-size: 12px; }
    .icon-btn { background: transparent; border: 0; color: #9aa5d6; width: 36px; height: 36px; border-radius: 9px; display: grid; place-items: center; cursor: pointer; position: relative; }
    .icon-btn:hover { background: rgba(255,255,255,.08); color: #fff; }

    .main { min-width: 0; display: flex; flex-direction: column; }
    .top { height: 64px; display: flex; align-items: center; justify-content: flex-end; gap: 16px; padding: 0 32px;
      background: rgba(242,244,249,.85); backdrop-filter: blur(8px); position: sticky; top: 0; z-index: 20; }
    .bus { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); background: #fff;
      border: 1px solid var(--line); padding: 6px 12px; border-radius: 999px; }
    .bus strong { color: var(--text); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); }
    .dot.live { background: #19b07f; box-shadow: 0 0 0 3px rgba(25,176,127,.2); animation: pulse 2.4s infinite; }
    .dot.off { background: var(--red); }
    .pending { background: var(--amber-50); color: #8a5a00; font-weight: 600; font-size: 12px; padding: 1px 8px; border-radius: 999px; }

    .bell-wrap { position: relative; }
    .bell { color: var(--muted); background: #fff; border: 1px solid var(--line); }
    .bell:hover { background: #f7f8fc; color: var(--text); }
    .badge { position: absolute; top: -5px; right: -5px; min-width: 19px; height: 19px; padding: 0 5px; border-radius: 999px;
      background: var(--red); color: #fff; font-size: 11px; font-weight: 700; display: grid; place-items: center; border: 2px solid var(--bg); }
    .panel { position: absolute; right: 0; top: 46px; width: 380px; background: #fff; border: 1px solid var(--line); border-radius: 16px;
      box-shadow: var(--shadow-lg); overflow: hidden; animation: rise .15s ease; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--line-2); }
    .panel-body { max-height: 420px; overflow: auto; }
    .note { display: flex; gap: 12px; width: 100%; text-align: left; background: #fff; border: 0; border-bottom: 1px solid var(--line-2); padding: 13px 16px; cursor: pointer; font-size: 13.5px; color: var(--text); }
    .note:hover { background: #f7f8fd; }
    .note.unread { background: #f5f7ff; }
    .pip { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex: none; background: transparent; }
    .unread .pip { background: var(--brand); }
    .txt { display: flex; flex-direction: column; gap: 3px; }
    .txt small { color: var(--faint); font-size: 12px; }
    main { flex: 1; }

    @media (max-width: 900px) {
      .layout { grid-template-columns: 76px minmax(0, 1fr); }
      .brand span:last-child, .nav-item span, .nav-label, .who { display: none; }
      .nav-item { justify-content: center; }
      .me { justify-content: center; padding: 8px 0; flex-direction: column; }
      .top { padding: 0 16px; }
      .panel { width: min(380px, 92vw); }
    }
  `],
})
export class ShellComponent implements OnInit {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  user = this.auth.user;
  notifications = signal<NotificationItem[]>([]);
  info = signal<SystemInfo | null>(null);
  bellOpen = signal(false);
  unread = computed(() => this.notifications().filter(n => !n.isRead).length);
  busTitle = computed(() => {
    const i = this.info();
    return i ? `Events flow through ${i.messagingProvider} (topic ${i.topic}). Notifications and exposure figures update asynchronously.` : 'Cannot reach backend';
  });

  roleLabel = computed(() => {
    switch (this.user()?.role) {
      case 'Claimant': return 'My claims';
      case 'Officer': return 'Claims officer';
      default: return 'Claims management';
    }
  });

  nav = computed<NavItem[]>(() => {
    switch (this.user()?.role) {
      case 'Claimant':
        return [
          { label: 'My claims', icon: 'list', link: '/my-claims' },
          { label: 'New claim', icon: 'plus', link: '/new-claim' },
        ];
      case 'Officer':
        return [
          { label: 'My workload', icon: 'briefcase', link: '/workload' },
          { label: 'Claim queue', icon: 'inbox', link: '/queue' },
          { label: 'All claims', icon: 'list', link: '/claims' },
        ];
      default:
        return [
          { label: 'Dashboard', icon: 'chart', link: '/dashboard' },
          { label: 'Claim queue', icon: 'inbox', link: '/queue' },
          { label: 'All claims', icon: 'list', link: '/claims' },
        ];
    }
  });

  private knownIds = new Set<number>();
  private firstLoad = true;

  ngOnInit() {
    // Poll for async side effects (notifications are produced by the event consumer, not the request).
    timer(0, 4000).pipe(
      switchMap(() => forkJoin({
        notes: this.api.notifications().pipe(catchError(() => of(null))),
        info: this.api.systemInfo().pipe(catchError(() => of(null))),
      })),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ notes, info }) => {
      this.info.set(info);
      if (!notes) return;
      if (!this.firstLoad) {
        const fresh = notes.filter(n => !n.isRead && !this.knownIds.has(n.id));
        if (fresh.length === 1) this.toast.info(fresh[0].message);
        else if (fresh.length > 1) this.toast.info(`${fresh.length} new notifications`);
      }
      notes.forEach(n => this.knownIds.add(n.id));
      this.firstLoad = false;
      this.notifications.set(notes);
    });
  }

  @HostListener('document:click') closeBell() { this.bellOpen.set(false); }

  toggleBell(e: Event) {
    e.stopPropagation();
    this.bellOpen.update(v => !v);
  }

  markAll() {
    this.api.markAllRead().subscribe(() => {
      this.notifications.update(list => list.map(n => ({ ...n, isRead: true })));
    });
  }

  openNotification(n: NotificationItem) {
    this.bellOpen.set(false);
    if (!n.isRead) {
      this.api.markRead(n.id).subscribe(() =>
        this.notifications.update(list => list.map(x => (x.id === n.id ? { ...x, isRead: true } : x))));
    }
    if (n.claimId) this.router.navigate(['/claim', n.claimId]);
  }
}
