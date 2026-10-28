import { Component, Input } from '@angular/core';
import { avatarColor, initials } from '../core/util';

@Component({
  selector: 'app-avatar',
  standalone: true,
  template: `<span class="avatar" [class.lg]="size === 'lg'" [class.sm]="size === 'sm'" [style.background]="color">{{ text }}</span>`,
})
export class AvatarComponent {
  @Input({ required: true }) name!: string;
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  get text(): string { return initials(this.name); }
  get color(): string { return avatarColor(this.name); }
}
