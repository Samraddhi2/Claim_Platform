import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ToastService } from '../core/toast.service';
import { avatarColor } from '../core/util';
import { AvatarComponent } from './avatar.component';
import { IconComponent } from './icon.component';
import { ModalComponent } from './modal.component';
import { StatusChipComponent } from './status-chip.component';
import { ToastsComponent } from './toasts.component';

describe('AvatarComponent', () => {
  function create(name: string, size?: 'sm' | 'md' | 'lg'): HTMLElement {
    const f = TestBed.createComponent(AvatarComponent);
    f.componentRef.setInput('name', name);
    if (size) f.componentRef.setInput('size', size);
    f.detectChanges();
    return f.nativeElement.querySelector('.avatar');
  }

  it('shows the initials', () => {
    expect(create('Aisha Rahman').textContent?.trim()).toBe('AR');
  });

  it('colours the circle deterministically from the name', () => {
    const el = create('Aisha Rahman');
    const probe = document.createElement('span');
    probe.style.background = avatarColor('Aisha Rahman');
    expect(el.style.background).toBe(probe.style.background);
  });

  it('applies size modifiers', () => {
    expect(create('A B', 'lg').classList).toContain('lg');
    expect(create('A B', 'sm').classList).toContain('sm');
    const md = create('A B');
    expect(md.classList).not.toContain('lg');
    expect(md.classList).not.toContain('sm');
  });
});

describe('IconComponent', () => {
  function create(name: string, size?: number) {
    const f = TestBed.createComponent(IconComponent);
    f.componentRef.setInput('name', name);
    if (size) f.componentRef.setInput('size', size);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('draws the requested glyph', () => {
    const path = create('check').querySelector('path')!;
    expect(path.getAttribute('d')).toBe('M20 6L9 17l-5-5');
  });

  it('defaults to 18px and honours a custom size', () => {
    expect(create('plus').querySelector('svg')!.getAttribute('width')).toBe('18');
    expect(create('plus', 32).querySelector('svg')!.getAttribute('height')).toBe('32');
  });

  it('renders an empty path for an unknown icon instead of crashing', () => {
    expect(create('does-not-exist').querySelector('path')!.getAttribute('d')).toBe('');
  });

  it('is hidden from assistive tech', () => {
    expect(create('bell').querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('StatusChipComponent', () => {
  function create(status: string) {
    const f = TestBed.createComponent(StatusChipComponent);
    f.componentRef.setInput('status', status);
    f.detectChanges();
    return f.nativeElement.querySelector('.chip') as HTMLElement;
  }

  it('shows the friendly label and a status class for styling', () => {
    const chip = create('UnderReview');
    expect(chip.textContent?.trim()).toBe('Under review');
    expect(chip.classList).toContain('chip');
    expect(chip.classList).toContain('UnderReview');
  });

  it('falls back to the raw status when it has no label', () => {
    expect(create('Mystery').textContent?.trim()).toBe('Mystery');
  });
});

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: `
    <app-modal title="Approve claim" [subtitle]="subtitle" (closed)="closes = closes + 1">
      <p class="projected-body">Body content</p>
      <button footer class="projected-footer">Confirm</button>
    </app-modal>`,
})
class ModalHost {
  subtitle = '';
  closes = 0;
}

describe('ModalComponent', () => {
  let fixture: ComponentFixture<ModalHost>;
  let host: ModalHost;
  const q = (sel: string) => fixture.debugElement.query(By.css(sel));

  beforeEach(() => {
    fixture = TestBed.createComponent(ModalHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the title and projects body and footer content', () => {
    expect(q('h2').nativeElement.textContent).toBe('Approve claim');
    expect(q('.projected-body')).toBeTruthy();
    expect(q('.projected-footer')).toBeTruthy();
  });

  it('is an accessible dialog', () => {
    const dialog = q('.dialog').nativeElement as HTMLElement;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('only shows a subtitle when one is given', () => {
    expect(q('header p')).toBeNull();
    host.subtitle = 'Approving makes the amount payable.';
    fixture.detectChanges();
    expect(q('header p').nativeElement.textContent).toContain('Approving makes the amount payable.');
  });

  it('closes when the backdrop is clicked', () => {
    q('.backdrop').nativeElement.click();
    expect(host.closes).toBe(1);
  });

  it('does not close when the dialog itself is clicked', () => {
    q('.dialog').nativeElement.click();
    expect(host.closes).toBe(0);
  });

  it('closes via the X button', () => {
    q('header button').nativeElement.click();
    expect(host.closes).toBe(1);
  });

  it('closes on Escape', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.closes).toBe(1);
  });
});

describe('ToastsComponent', () => {
  let fixture: ComponentFixture<ToastsComponent>;
  let svc: ToastService;

  beforeEach(() => {
    fixture = TestBed.createComponent(ToastsComponent);
    svc = TestBed.inject(ToastService);
    fixture.detectChanges();
  });

  const toasts = () => fixture.debugElement.queryAll(By.css('.toast'));

  it('renders nothing when there are no toasts', () => {
    expect(toasts().length).toBe(0);
  });

  it('renders each toast with its kind and message', fakeAsync(() => {
    svc.success('Saved');
    svc.error('Failed');
    svc.info('FYI');
    fixture.detectChanges();
    const els = toasts().map(t => t.nativeElement as HTMLElement);
    expect(els.map(e => e.textContent?.trim())).toEqual(['Saved', 'Failed', 'FYI']);
    expect(els[0].classList).toContain('success');
    expect(els[1].classList).toContain('error');
    expect(els[2].classList).toContain('info');
    flush();
  }));

  it('picks a different icon per kind', fakeAsync(() => {
    svc.success('a'); svc.error('b'); svc.info('c');
    fixture.detectChanges();
    const paths = toasts().map(t => t.query(By.css('path')).nativeElement.getAttribute('d'));
    expect(new Set(paths).size).toBe(3);
    flush();
  }));

  it('dismisses a toast when clicked', fakeAsync(() => {
    svc.info('click me');
    fixture.detectChanges();
    toasts()[0].nativeElement.click();
    fixture.detectChanges();
    expect(toasts().length).toBe(0);
    flush();
  }));

  it('is an aria-live region so screen readers announce toasts', () => {
    expect(fixture.nativeElement.querySelector('.stack-toasts').getAttribute('aria-live')).toBe('polite');
  });
});
