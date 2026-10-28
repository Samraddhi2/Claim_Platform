import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ClaimType } from '../core/models';
import { ToastService } from '../core/toast.service';
import { MARKETS, MARKET_NAME } from '../core/util';
import { IconComponent } from '../shared/icon.component';
import { forkJoin, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-new-claim',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
  template: `
    <div class="page narrow">
      <a routerLink="/my-claims" class="back"><app-icon name="back" [size]="16" /> Back to my claims</a>
      <div class="page-head">
        <div>
          <h1>File a new claim</h1>
          <p class="sub">Tell us what happened. An officer will pick it up and keep you posted.</p>
        </div>
      </div>

      <form class="card" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <span class="label">What kind of claim is it?</span>
          <div class="kinds">
            <button type="button" class="kind" [class.on]="form.value.type === 'Motor'" (click)="setType('Motor')">
              <app-icon name="car" [size]="22" />
              <span><strong>Motor</strong><small>Accident, theft or damage to a vehicle</small></span>
            </button>
            <button type="button" class="kind" [class.on]="form.value.type === 'Property'" (click)="setType('Property')">
              <app-icon name="home" [size]="22" />
              <span><strong>Property</strong><small>Fire, flood, burglary or home damage</small></span>
            </button>
          </div>
        </div>

        <hr class="divider" />

        <div class="form-grid">
          <div class="field">
            <label for="market">Market</label>
            <select id="market" class="select" formControlName="market">
              @for (m of markets; track m) { <option [value]="m">{{ marketName[m] }}</option> }
            </select>
          </div>

          <div class="field">
            <label for="policy">Policy number</label>
            <input id="policy" class="input" formControlName="policyNumber" placeholder="e.g. MTR-SG-482913" [class.invalid]="bad('policyNumber')" />
            @if (bad('policyNumber')) { <span class="error">Enter the policy number from your certificate.</span> }
          </div>

          <div class="field">
            <label for="date">Date of incident</label>
            <input id="date" type="date" class="input" formControlName="incidentDate" [max]="today" [class.invalid]="bad('incidentDate')" />
            @if (bad('incidentDate')) { <span class="error">Choose the date it happened (not in the future).</span> }
          </div>

          <div class="field">
            <label for="amount">Amount you're claiming (USD)</label>
            <input id="amount" type="number" min="1" class="input" formControlName="claimedAmount" placeholder="0" [class.invalid]="bad('claimedAmount')" />
            @if (bad('claimedAmount')) { <span class="error">Enter an amount greater than zero.</span> }
          </div>

          <div class="field full">
            <label for="loc">Where did it happen?</label>
            <input id="loc" class="input" formControlName="location" placeholder="Street, area or city" [class.invalid]="bad('location')" />
            @if (bad('location')) { <span class="error">Tell us where it happened.</span> }
          </div>

          <div class="field full">
            <label for="desc">What happened?</label>
            <textarea id="desc" class="textarea" rows="5" formControlName="description" [class.invalid]="bad('description')"
              placeholder="Describe the incident and the damage or loss in your own words."></textarea>
            <span class="help">{{ form.value.description?.length ?? 0 }} characters (minimum 10)</span>
            @if (bad('description')) { <span class="error">Please give us a little more detail.</span> }
          </div>
        </div>

        <div class="field full documents-field">
          <label for="supportingDocuments">Supporting documents (optional)</label>
          <input id="supportingDocuments" class="input" type="file" multiple accept=".pdf,.jpg,.jpeg,.doc,.docx"
            (change)="onFilesSelected($event)" />
          <span class="help">Attach evidence such as photos, invoices, or reports. PDF, JPEG, DOC and DOCX; maximum 10 MB per file.</span>
          @if (selectedFiles.length) {
            <ul class="selected-files">
              @for (file of selectedFiles; track file.name + file.size + $index) {
                <li><span>{{ file.name }} ({{ formatSize(file.size) }})</span><button type="button" class="remove-file" (click)="removeFile($index)" [disabled]="submitting()">Remove</button></li>
              }
            </ul>
          }
        </div>

        <div class="actions">
          <a class="btn secondary" routerLink="/my-claims">Cancel</a>
          <button class="btn" type="submit" [disabled]="submitting()">
            @if (submitting()) { <span class="spin"></span> Submitting… } @else { <app-icon name="send" [size]="16" /> Submit claim }
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .narrow { max-width: 820px; }
    .back { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); margin-bottom: 14px; font-weight: 500; }
    .kinds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .kind { display: flex; align-items: center; gap: 14px; text-align: left; padding: 16px; border-radius: 14px; background: #fff;
      border: 1.5px solid var(--line); cursor: pointer; color: var(--muted); transition: all .15s; }
    .kind span { display: flex; flex-direction: column; }
    .kind strong { color: var(--text); font-size: 15px; }
    .kind small { font-size: 12.5px; }
    .kind:hover { border-color: #c4cce6; }
    .kind.on { border-color: var(--brand); background: var(--brand-50); color: var(--brand); box-shadow: 0 0 0 3px var(--brand-100); }
    .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
    .documents-field { margin-top: 20px; }
    .selected-files { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 8px; }
    .selected-files li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; font-size: 13px; }
    .remove-file { border: 0; background: transparent; color: var(--brand); cursor: pointer; font: inherit; }
    @media (max-width: 720px) { .kinds { grid-template-columns: 1fr; } }
  `],
})
export class NewClaimComponent {
  private fb = inject(FormBuilder);
  private api = inject(ApiService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private auth = inject(AuthService);

  markets = MARKETS;
  marketName = MARKET_NAME;
  today = new Date().toISOString().slice(0, 10);
  submitting = signal(false);
  selectedFiles: File[] = [];

  form = this.fb.nonNullable.group({
    type: ['Motor' as ClaimType, Validators.required],
    market: [this.auth.user()?.market ?? 'SG', Validators.required],
    policyNumber: ['', [Validators.required, Validators.minLength(4)]],
    incidentDate: [this.today, Validators.required],
    location: ['', [Validators.required, Validators.minLength(3)]],
    description: ['', [Validators.required, Validators.minLength(10)]],
    claimedAmount: [null as number | null, [Validators.required, Validators.min(1)]],
  });

  setType(t: ClaimType) { this.form.patchValue({ type: t }); }

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const incoming = Array.from(input.files ?? []);
    const allowed = /\.(pdf|jpe?g|docx?)$/i;
    const invalid = incoming.find(file => !allowed.test(file.name) || file.size === 0 || file.size > 10 * 1024 * 1024);
    if (invalid) {
      this.toast.error(`${invalid.name}: choose a non-empty PDF, JPEG, DOC or DOCX file no larger than 10 MB.`);
      input.value = '';
      return;
    }
    const existing = new Set(this.selectedFiles.map(file => `${file.name}:${file.size}:${file.lastModified}`));
    this.selectedFiles = [...this.selectedFiles, ...incoming.filter(file => !existing.has(`${file.name}:${file.size}:${file.lastModified}`))];
    input.value = '';
  }

  removeFile(index: number) { this.selectedFiles = this.selectedFiles.filter((_, i) => i !== index); }

  formatSize(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  bad(name: string): boolean {
    const c = this.form.get(name);
    const future = name === 'incidentDate' && (c?.value ?? '') > this.today;
    return !!c && (c.invalid || future) && (c.dirty || c.touched);
  }

  submit() {
    const v = this.form.getRawValue();
    if (this.form.invalid || v.incidentDate > this.today) {
      this.form.markAllAsTouched();
      this.toast.error('Please fix the highlighted fields.');
      return;
    }
    this.submitting.set(true);
    this.api.createClaim({
      type: v.type,
      market: v.market,
      policyNumber: v.policyNumber.trim(),
      incidentDate: `${v.incidentDate}T00:00:00`, // System.Text.Json needs a full ISO date-time
      location: v.location.trim(),
      description: v.description.trim(),
      claimedAmount: Number(v.claimedAmount),
    }).pipe(
      switchMap(claim => {
        const uploads$ = this.selectedFiles.length
          ? forkJoin(this.selectedFiles.map(file => this.api.uploadDocument(claim.summary.id, file)))
          : of([]);
        return uploads$.pipe(switchMap(() => of(claim)));
      }),
    ).subscribe({
      next: claim => {
        this.toast.success(`Claim ${claim.summary.claimNumber} submitted${this.selectedFiles.length ? ' with supporting documents' : ''}. We'll keep you posted.`);
        this.router.navigate(['/claim', claim.summary.id]);
      },
      error: () => {
        this.submitting.set(false);
        this.toast.error('The claim or a supporting document could not be submitted. Please check your claims list before retrying.');
      },
    });
  }
}
