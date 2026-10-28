import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/guards';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login.component').then(m => m.LoginComponent) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then(m => m.ShellComponent),
    children: [
      // claimant
      {
        path: 'my-claims', canActivate: [roleGuard('Claimant')], data: { mode: 'mine' },
        loadComponent: () => import('./pages/claims-list.component').then(m => m.ClaimsListComponent),
      },
      {
        path: 'new-claim', canActivate: [roleGuard('Claimant')],
        loadComponent: () => import('./pages/new-claim.component').then(m => m.NewClaimComponent),
      },
      // claims staff
      {
        path: 'workload', canActivate: [roleGuard('Officer')],
        loadComponent: () => import('./pages/workload.component').then(m => m.WorkloadComponent),
      },
      {
        path: 'queue', canActivate: [roleGuard('Officer', 'Manager')], data: { mode: 'queue' },
        loadComponent: () => import('./pages/claims-list.component').then(m => m.ClaimsListComponent),
      },
      {
        path: 'claims', canActivate: [roleGuard('Officer', 'Manager')], data: { mode: 'all' },
        loadComponent: () => import('./pages/claims-list.component').then(m => m.ClaimsListComponent),
      },
      // manager
      {
        path: 'dashboard', canActivate: [roleGuard('Manager')],
        loadComponent: () => import('./pages/dashboard.component').then(m => m.DashboardComponent),
      },
      // shared
      {
        path: 'claim/:id',
        loadComponent: () => import('./pages/claim-detail.component').then(m => m.ClaimDetailComponent),
      },
      { path: '', pathMatch: 'full', redirectTo: 'claims' },
    ],
  },
  { path: '**', redirectTo: '' },
];
