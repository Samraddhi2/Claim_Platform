import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { ApiSpy, CLAIMANT, createApiSpy, makeDetail, provideApiSpy } from '../../testing/fixtures';
import { AuthService } from '../core/auth.service';
import { ClaimDetail, User } from '../core/models';
import { ToastService } from '../core/toast.service';
import { NewClaimComponent } from './new-claim.component';

describe('NewClaimComponent', () => {
  let api: ApiSpy;
  let router: Router;
  let toast: ToastService;
  let fixture: ComponentFixture<NewClaimComponent>;
  let cmp: NewClaimComponent;

  const today = new Date().toISOString().slice(0, 10);
  const daysFromToday = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  function setup(user: User = CLAIMANT) {
    localStorage.removeItem('claims.user');
    api = createApiSpy();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideApiSpy(api)] });
    TestBed.inject(AuthService).signIn(user);
    router = TestBed.inject(Router);
    toast = TestBed.inject(ToastService);
    spyOn(router, 'navigate').and.resolveTo(true);
    spyOn(toast, 'error');
    spyOn(toast, 'success');
    fixture = TestBed.createComponent(NewClaimComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  }

  const valid = () => cmp.form.patchValue({
    type: 'Property', market: 'HK', policyNumber: '  PRP-HK-123456 ', incidentDate: today,
    location: '  Kwun Tong, Hong Kong ', description: '  Burst pipe flooded the living room.  ', claimedAmount: 2500,
  });

  afterEach(() => localStorage.removeItem('claims.user'));

  describe('defaults', () => {
    it('starts as a Motor claim dated today', () => {
      setup();
      expect(cmp.form.value.type).toBe('Motor');
      expect(cmp.form.value.incidentDate).toBe(today);
      expect(cmp.form.value.claimedAmount).toBeNull();
    });

    it('pre-selects the claimant\'s own market', () => {
      setup({ ...CLAIMANT, market: 'TH' });
      expect(cmp.form.value.market).toBe('TH');
    });

    it('falls back to Singapore when the user has no market', () => {
      setup({ ...CLAIMANT, market: null });
      expect(cmp.form.value.market).toBe('SG');
    });

    it('offers all six markets', () => {
      setup();
      expect(fixture.debugElement.queryAll(By.css('#market option')).length).toBe(6);
    });
  });

  describe('claim type tiles', () => {
    it('highlights the selected type', () => {
      setup();
      const [motor, property] = fixture.debugElement.queryAll(By.css('.kind')).map(d => d.nativeElement as HTMLElement);
      expect(motor.classList).toContain('on');
      expect(property.classList).not.toContain('on');
      property.click();
      fixture.detectChanges();
      expect(cmp.form.value.type).toBe('Property');
      expect(motor.classList).not.toContain('on');
      expect(property.classList).toContain('on');
    });
  });

  describe('validation', () => {
    beforeEach(() => setup());

    it('is invalid until every required field is filled', () => {
      expect(cmp.form.invalid).toBeTrue();
      valid();
      expect(cmp.form.valid).toBeTrue();
    });

    const rules: [string, unknown, boolean][] = [
      ['policyNumber', 'ABC', false],
      ['policyNumber', 'ABCD', true],
      ['location', 'ab', false],
      ['location', 'abc', true],
      ['description', 'too short', false],
      ['description', 'long enough!', true],
      ['claimedAmount', 0, false],
      ['claimedAmount', -5, false],
      ['claimedAmount', 1, true],
    ];
    rules.forEach(([field, value, ok]) => {
      it(`${field} = ${JSON.stringify(value)} is ${ok ? 'accepted' : 'rejected'}`, () => {
        valid();
        cmp.form.get(field)!.setValue(value);
        expect(cmp.form.get(field)!.valid).toBe(ok);
      });
    });

    it('does not flag untouched fields', () => {
      expect(cmp.bad('policyNumber')).toBeFalse();
    });

    it('flags an invalid field once it has been touched', () => {
      cmp.form.get('policyNumber')!.markAsTouched();
      expect(cmp.bad('policyNumber')).toBeTrue();
    });

    it('flags a future incident date even though the control is technically valid', () => {
      const date = cmp.form.get('incidentDate')!;
      date.setValue(daysFromToday(3));
      date.markAsDirty();
      expect(date.valid).toBeTrue();
      expect(cmp.bad('incidentDate')).toBeTrue();
    });

    it('flags a date field the user has cleared', () => {
      const date = cmp.form.get('incidentDate')!;
      date.setValue(null as unknown as string);
      date.markAsDirty();
      expect(cmp.bad('incidentDate')).toBeTrue();
    });

    it('does not flag today\'s date', () => {
      cmp.form.get('incidentDate')!.markAsDirty();
      expect(cmp.bad('incidentDate')).toBeFalse();
    });

    it('treats an unknown control as not bad', () => {
      expect(cmp.bad('nope')).toBeFalse();
    });

    it('shows inline messages after the form is touched', () => {
      cmp.form.markAllAsTouched();
      fixture.detectChanges();
      const errors = Array.from(fixture.nativeElement.querySelectorAll('.error')).map(e => (e as HTMLElement).textContent);
      expect(errors).toContain('Enter the policy number from your certificate.');
      expect(errors).toContain('Tell us where it happened.');
      expect(errors).toContain('Please give us a little more detail.');
      expect(errors).toContain('Enter an amount greater than zero.');
    });

    it('live-counts description characters', () => {
      cmp.form.patchValue({ description: 'hello' });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.help').textContent).toContain('5 characters');
    });
  });

  describe('submit', () => {
    beforeEach(() => setup());

    it('refuses an incomplete form, highlights it and tells the user', () => {
      cmp.submit();
      expect(api.createClaim).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Please fix the highlighted fields.');
      expect(cmp.form.touched).toBeTrue();
      expect(cmp.submitting()).toBeFalse();
    });

    it('refuses a future incident date', () => {
      valid();
      cmp.form.patchValue({ incidentDate: daysFromToday(2) });
      cmp.submit();
      expect(api.createClaim).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
    });

    it('sends a trimmed, correctly shaped request', () => {
      valid();
      api.createClaim.and.returnValue(of(makeDetail()));
      cmp.submit();
      expect(api.createClaim).toHaveBeenCalledOnceWith({
        type: 'Property',
        market: 'HK',
        policyNumber: 'PRP-HK-123456',
        incidentDate: `${today}T00:00:00`, // System.Text.Json needs a full ISO date-time
        location: 'Kwun Tong, Hong Kong',
        description: 'Burst pipe flooded the living room.',
        claimedAmount: 2500,
      });
    });

    it('celebrates and opens the new claim on success', () => {
      valid();
      const created: ClaimDetail = makeDetail({}, { id: 321, claimNumber: 'CLM-2026-000321' });
      api.createClaim.and.returnValue(of(created));
      cmp.submit();
      expect(toast.success).toHaveBeenCalledWith("Claim CLM-2026-000321 submitted. We'll keep you posted.");
      expect(router.navigate).toHaveBeenCalledWith(['/claim', 321]);
    });

    it('shows a "Submitting…" state and blocks double-submits while in flight', () => {
      valid();
      api.createClaim.and.returnValue(new Subject<ClaimDetail>());
      cmp.submit();
      fixture.detectChanges();
      const btn = fixture.nativeElement.querySelector('button[type=submit]') as HTMLButtonElement;
      expect(cmp.submitting()).toBeTrue();
      expect(btn.disabled).toBeTrue();
      expect(btn.textContent).toContain('Submitting');
    });

    it('lets the user try again after a server error', () => {
      valid();
      api.createClaim.and.returnValue(throwError(() => ({ status: 400 })));
      cmp.submit();
      expect(cmp.submitting()).toBeFalse();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('submits through the real <form> (ngSubmit)', () => {
      valid();
      api.createClaim.and.returnValue(of(makeDetail()));
      fixture.debugElement.query(By.css('form')).triggerEventHandler('ngSubmit');
      expect(api.createClaim).toHaveBeenCalledTimes(1);
    });
  });
});
