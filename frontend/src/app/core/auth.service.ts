import { Injectable, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Role, User } from './models';

const KEY = 'claims.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(this.restore());
  readonly isStaff = computed(() => this.user()?.role === 'Officer' || this.user()?.role === 'Manager');
  readonly isManager = computed(() => this.user()?.role === 'Manager');
  readonly isClaimant = computed(() => this.user()?.role === 'Claimant');

  constructor(private router: Router) {}

  signIn(user: User) {
    localStorage.setItem(KEY, JSON.stringify(user));
    this.user.set(user);
  }

  signOut() {
    localStorage.removeItem(KEY);
    this.user.set(null);
    this.router.navigateByUrl('/login');
  }

  homeFor(role: Role): string {
    switch (role) {
      case 'Claimant': return '/my-claims';
      case 'Officer': return '/workload';
      default: return '/dashboard';
    }
  }

  private restore(): User | null {
    try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
  }
}
