import { fakeAsync, tick } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let svc: ToastService;
  beforeEach(() => (svc = new ToastService()));

  it('starts empty', () => {
    expect(svc.toasts()).toEqual([]);
  });

  it('pushes toasts of each kind with the right text', () => {
    svc.success('saved');
    svc.error('broke');
    svc.info('fyi');
    expect(svc.toasts().map(t => [t.kind, t.text])).toEqual([['success', 'saved'], ['error', 'broke'], ['info', 'fyi']]);
  });

  it('gives every toast a unique, increasing id', () => {
    svc.info('a'); svc.info('b'); svc.info('c');
    const ids = svc.toasts().map(t => t.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
  });

  it('can be dismissed manually (only the targeted toast)', fakeAsync(() => {
    svc.info('a'); svc.info('b');
    svc.dismiss(svc.toasts()[0].id);
    expect(svc.toasts().map(t => t.text)).toEqual(['b']);
    tick(10_000);
  }));

  it('auto-dismisses success and info toasts after 3.8 s', fakeAsync(() => {
    svc.success('ok');
    svc.info('hi');
    tick(3799);
    expect(svc.toasts().length).toBe(2);
    tick(1);
    expect(svc.toasts().length).toBe(0);
  }));

  it('keeps error toasts around longer (6 s)', fakeAsync(() => {
    svc.error('bad');
    tick(3800);
    expect(svc.toasts().length).toBe(1);
    tick(2200);
    expect(svc.toasts().length).toBe(0);
  }));

  it('ignores dismissing an unknown id', fakeAsync(() => {
    svc.info('a');
    svc.dismiss(9999);
    expect(svc.toasts().length).toBe(1);
    tick(4000);
  }));
});
