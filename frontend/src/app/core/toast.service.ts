import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  success(text: string) { this.push('success', text); }
  error(text: string) { this.push('error', text, 6000); }
  info(text: string) { this.push('info', text); }

  dismiss(id: number) { this.toasts.update(list => list.filter(t => t.id !== id)); }

  private push(kind: Toast['kind'], text: string, ms = 3800) {
    const id = this.nextId++;
    this.toasts.update(list => [...list, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }
}
