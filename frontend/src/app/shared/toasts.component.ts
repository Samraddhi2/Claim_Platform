import { Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-toasts',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="stack-toasts" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="t.kind" (click)="toast.dismiss(t.id)">
          <app-icon [name]="t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'zap'" />
          <span>{{ t.text }}</span>
        </div>
      }
    </div>`,
  styles: [`
    .stack-toasts { position: fixed; right: 20px; bottom: 20px; z-index: 200; display: flex; flex-direction: column; gap: 10px; }
    .toast { display: flex; align-items: flex-start; gap: 10px; min-width: 260px; max-width: 380px; padding: 12px 16px; border-radius: 12px;
      color: #fff; font-weight: 500; box-shadow: var(--shadow); cursor: pointer; animation: slide .25s ease; }
    .toast app-icon { margin-top: 1px; }
    .success { background: #0a7a5b; } .error { background: #b82f2f; } .info { background: var(--ink-2); }
    @keyframes slide { from { opacity: 0; transform: translateX(24px); } }
  `],
})
export class ToastsComponent {
  toast = inject(ToastService);
}
