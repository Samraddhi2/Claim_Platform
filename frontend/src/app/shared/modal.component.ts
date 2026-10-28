import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="backdrop" (click)="closed.emit()">
      <div class="dialog" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
        <header>
          <div>
            <h2>{{ title }}</h2>
            @if (subtitle) { <p class="muted small">{{ subtitle }}</p> }
          </div>
          <button class="btn ghost sm" (click)="closed.emit()" aria-label="Close"><app-icon name="x" /></button>
        </header>
        <div class="body"><ng-content /></div>
        <footer><ng-content select="[footer]" /></footer>
      </div>
    </div>`,
  styles: [`
    .backdrop { position: fixed; inset: 0; background: rgba(14,22,51,.55); backdrop-filter: blur(3px); z-index: 100;
      display: grid; place-items: center; padding: 20px; animation: fade .15s ease; }
    .dialog { width: 100%; max-width: 520px; max-height: 92vh; overflow: auto; background: #fff; border-radius: 18px;
      box-shadow: var(--shadow-lg); animation: pop .2s cubic-bezier(.2,.9,.3,1.2); }
    header { display: flex; justify-content: space-between; gap: 12px; padding: 22px 24px 0; }
    .body { padding: 18px 24px 8px; display: flex; flex-direction: column; gap: 16px; }
    footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px 22px; }
    @keyframes fade { from { opacity: 0; } }
    @keyframes pop { from { opacity: 0; transform: translateY(10px) scale(.97); } }
  `],
})
export class ModalComponent {
  @Input({ required: true }) title!: string;
  @Input() subtitle = '';
  @Output() closed = new EventEmitter<void>();

  @HostListener('document:keydown.escape') onEsc() { this.closed.emit(); }
}
