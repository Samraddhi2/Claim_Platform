import { Component, Input } from '@angular/core';
import { ClaimStatus } from '../core/models';
import { STATUS_LABEL } from '../core/util';

@Component({
  selector: 'app-status-chip',
  standalone: true,
  template: `<span class="chip" [class]="status">{{ label }}</span>`,
})
export class StatusChipComponent {
  @Input({ required: true }) status!: ClaimStatus;
  get label(): string { return STATUS_LABEL[this.status] ?? this.status; }
}
