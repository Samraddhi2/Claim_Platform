import { Location } from '@angular/common';
import { Component, DestroyRef, Input, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Observable, catchError, of, switchMap, timer } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ClaimDetail, ClaimDocument, ClaimStatus, User } from '../core/models';
import { AgoPipe, DateOnlyPipe, MoneyPipe, StampPipe } from '../core/pipes';
import { ToastService } from '../core/toast.service';
import { MARKET_NAME, STATUS_LABEL } from '../core/util';
import { AvatarComponent } from '../shared/avatar.component';
import { IconComponent } from '../shared/icon.component';
import { ModalComponent } from '../shared/modal.component';
import { StatusChipComponent } from '../shared/status-chip.component';

type ModalKind = 'assign' | 'requestInfo' | 'assess' | 'approve' | 'reject' | 'reopen' | 'settle' | 'withdraw';

const STEPS: ClaimStatus[] = ['Submitted', 'UnderReview', 'Assessed', 'Approved', 'Settled'];
const STEP_INDEX: Record<string, number> = { Submitted: 0, UnderReview: 1, InfoRequested: 1, Assessed: 2, Approved: 3, Settled: 4 };
const APPROVAL_THRESHOLD = 50_000;

@Component({
  selector: 'app-claim-detail',
  standalone: true,
  imports: [FormsModule, IconComponent, AvatarComponent, ModalComponent, StatusChipComponent, MoneyPipe, AgoPipe, StampPipe, DateOnlyPipe],
  template: `
    <div class="page">
      <button class="back" (click)="back()"><app-icon name="back" [size]="16" /> Back</button>

      @if (detail(); as d) {
        <!-- header -->
        <div class="head">
          <div class="head-main">
            <span class="type-ico" [class.property]="d.summary.type === 'Property'">
              <app-icon [name]="d.summary.type === 'Motor' ? 'car' : 'home'" [size]="24" />
            </span>
            <div>
              <div class="row wrap">
                <h1>{{ d.summary.claimNumber }}</h1>
                <app-status-chip [status]="d.summary.status" />
              </div>
              <p class="muted">
                {{ d.summary.type }} claim · {{ marketName[d.summary.market] }} · filed {{ d.summary.createdAt | ago }} by {{ d.summary.claimantName }}
              </p>
            </div>
          </div>
        </div>

        <!-- lifecycle -->
        <div class="card rail-card">
          <ol class="rail">
            @for (s of rail(); track s.status) {
              <li [class]="s.state">
                <span class="node">
                  @if (s.state === 'done') { <app-icon name="check" [size]="14" /> }
                </span>
                <span class="step-label">{{ s.label }}</span>
                @if (s.state === 'current' && d.summary.status === 'InfoRequested') {
                  <small class="wait">Waiting for claimant</small>
                }
              </li>
            }
          </ol>
          @if (d.summary.status === 'Rejected' || d.summary.status === 'Withdrawn') {
            <div class="terminal" [class]="d.summary.status">
              <app-icon [name]="d.summary.status === 'Rejected' ? 'x' : 'undo'" [size]="16" />
              This claim was {{ d.summary.status === 'Rejected' ? 'rejected' : 'withdrawn' }}.
            </div>
          }
        </div>

        @if (d.summary.status === 'InfoRequested' && auth.isClaimant()) {
          <div class="banner warn" style="margin-bottom:16px">
            <app-icon name="alert" [size]="20" />
            <div><strong>We need something from you.</strong> Please reply in the "Information requests" section below so we can continue.</div>
          </div>
        }

        <div class="grid main-side">
          <!-- main column -->
          <div class="stack">
            <div class="card">
              <div class="card-head"><h2>What happened</h2></div>
              <p class="desc">{{ d.description }}</p>
              <hr class="divider" />
              <div class="facts">
                <div><span>Incident date</span><strong>{{ d.summary.incidentDate | dateOnly }}</strong></div>
                <div><span>Location</span><strong>{{ d.location }}</strong></div>
                <div><span>Policy number</span><strong>{{ d.summary.policyNumber }}</strong></div>
                <div><span>Claimant</span>
                  <strong class="row"><app-avatar [name]="d.summary.claimantName" size="sm" /> {{ d.summary.claimantName }}</strong>
                </div>
              </div>
              @if (d.decisionReason) {
                <hr class="divider" />
                <div class="banner" [class.warn]="d.summary.status === 'Rejected'">
                  <app-icon name="alert" />
                  <div><strong>Decision reason</strong><div>{{ d.decisionReason }}</div></div>
                </div>
              }
            </div>

            <div class="card">
              <div class="card-head"><h2>Supporting documents</h2><span class="hint">PDF, JPEG, DOC or DOCX · max 10 MB each</span></div>
              @if (auth.isClaimant() && d.summary.status === 'InfoRequested') {
                <p class="muted small">Upload the documents requested by the claims team. Your files will be visible to staff handling this claim.</p>
                <div class="reply-form">
                  <input #documentInput type="file" class="input" accept=".pdf,.jpg,.jpeg,.doc,.docx,application/pdf,image/jpeg,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" (change)="selectDocument($event)" />
                  @if (selectedDocument) { <p class="muted small">Selected: {{ selectedDocument.name }}</p> }
                  <div class="right"><button class="btn" [disabled]="busy() || !selectedDocument" (click)="uploadDocument()">@if (busy()) { <span class="spin"></span> } @else { <app-icon name="upload" [size]="16" /> } Submit document</button></div>
                </div>
              } @else if (auth.isClaimant() && d.documents.length === 0) {
                <p class="muted small">You can upload documents here when the claims team requests more information.</p>
              }
              @for (doc of d.documents; track doc.id) {
                <div class="note-item document-item">
                  <app-icon name="file-text" [size]="20" />
                  <div class="document-meta"><strong>{{ doc.fileName }}</strong><small class="faint">{{ doc.uploadedByName }} · {{ doc.uploadedAt | stamp }} · {{ formatBytes(doc.sizeBytes) }}</small></div>
                  <button class="btn secondary" (click)="downloadDocument(doc.id)"><app-icon name="download" [size]="15" /> View / download</button>
                </div>
              } @empty {
                @if (auth.isStaff()) { <p class="muted">No documents have been submitted yet.</p> }
              }
            </div>

            @if (d.infoRequests.length > 0) {
              <div class="card">
                <div class="card-head"><h2>Information requests</h2></div>
                @for (r of d.infoRequests; track r.id) {
                  <div class="thread">
                    <div class="bubble ask">
                      <div class="who"><strong>{{ r.requestedByName }}</strong><small class="faint">{{ r.requestedAt | stamp }}</small></div>
                      <p>{{ r.message }}</p>
                    </div>
                    @if (r.response) {
                      <div class="bubble reply">
                        <div class="who"><strong>{{ d.summary.claimantName }}</strong><small class="faint">{{ r.respondedAt | stamp }}</small></div>
                        <p>{{ r.response }}</p>
                      </div>
                    } @else if (has('provideInfo')) {
                      <div class="reply-form">
                        <label class="label" for="reply">Your reply</label>
                        <textarea id="reply" class="textarea" rows="3" [(ngModel)]="replyText" placeholder="Share the details or documents referenced above..."></textarea>
                        <div class="right">
                          <button class="btn" [disabled]="busy() || replyText.trim().length < 3" (click)="sendReply()">
                            @if (busy()) { <span class="spin"></span> } @else { <app-icon name="send" [size]="16" /> } Send reply
                          </button>
                        </div>
                      </div>
                    } @else {
                      <p class="faint small awaiting"><app-icon name="clock" [size]="14" /> Awaiting the claimant's reply</p>
                    }
                  </div>
                }
              </div>
            }

            @if (auth.isStaff()) {
              <div class="card">
                <div class="card-head"><h2>Internal notes</h2><span class="hint">Only claims staff can see these</span></div>
                @if (has('addNote')) {
                  <div class="note-form">
                    <input class="input" placeholder="Add a note for the team..." [(ngModel)]="noteText" (keyup.enter)="addNote()" />
                    <button class="btn" [disabled]="busy() || !noteText.trim()" (click)="addNote()">Add note</button>
                  </div>
                }
                @for (n of d.notes; track n.id) {
                  <div class="note-item">
                    <app-avatar [name]="n.authorName" size="sm" />
                    <div><p>{{ n.text }}</p><small class="faint">{{ n.authorName }} · {{ n.at | ago }}</small></div>
                  </div>
                } @empty {
                  <p class="muted">No notes yet.</p>
                }
              </div>
            }

            <div class="card">
              <div class="card-head"><h2>Activity</h2><span class="hint">Full audit trail</span></div>
              <ol class="timeline">
                @for (h of historyDesc(); track $index) {
                  <li>
                    <span class="tdot" [class]="h.toStatus"></span>
                    <div>
                      <div><strong>{{ h.action }}</strong></div>
                      @if (h.comment) { <p class="muted small">{{ h.comment }}</p> }
                      <small class="faint">{{ h.actorName }} · {{ h.at | stamp }}</small>
                    </div>
                  </li>
                }
              </ol>
            </div>
          </div>

          <!-- side column -->
          <div class="stack side">
            <div class="card">
              <div class="card-head"><h2>Amounts</h2></div>
              <div class="amt"><span>Claimed</span><strong class="mono">{{ d.summary.claimedAmount | money }}</strong></div>
              <div class="amt"><span>Assessed</span><strong class="mono">{{ d.summary.assessedAmount | money }}</strong></div>
              <div class="amt total"><span>{{ d.summary.approvedAmount !== null ? 'Approved' : 'Current exposure' }}</span>
                <strong class="mono">{{ (d.summary.approvedAmount ?? d.summary.assessedAmount ?? d.summary.claimedAmount) | money }}</strong>
              </div>
              <hr class="divider" />
              <div class="amt">
                <span>Handled by</span>
                @if (d.summary.assignedOfficerName) {
                  <strong class="row"><app-avatar [name]="d.summary.assignedOfficerName" size="sm" /> {{ d.summary.assignedOfficerName }}</strong>
                } @else { <span class="faint">Not assigned yet</span> }
              </div>
            </div>

            <div class="card">
              <div class="card-head"><h2>Actions</h2></div>
              <div class="actions">
                @if (has('assignToMe')) {
                  <button class="btn block" [disabled]="busy()" (click)="assignToMe()"><app-icon name="user-plus" [size]="16" /> Pick up this claim</button>
                }
                @if (has('assess')) {
                  <button class="btn block" (click)="openModal('assess')"><app-icon name="dollar" [size]="16" /> Record assessment</button>
                }
                @if (has('approve')) {
                  <button class="btn success block" (click)="openModal('approve')"><app-icon name="check" [size]="16" /> Approve claim</button>
                }
                @if (has('settle')) {
                  <button class="btn success block" (click)="openModal('settle')"><app-icon name="dollar" [size]="16" /> Mark as settled</button>
                }
                @if (has('requestInfo')) {
                  <button class="btn secondary block" (click)="openModal('requestInfo')"><app-icon name="message" [size]="16" /> Request information</button>
                }
                @if (has('assign')) {
                  <button class="btn secondary block" (click)="openModal('assign')"><app-icon name="users" [size]="16" /> {{ d.summary.assignedOfficerId ? 'Reassign officer' : 'Assign to officer' }}</button>
                }
                @if (has('reopen')) {
                  <button class="btn ghost block" (click)="openModal('reopen')"><app-icon name="undo" [size]="16" /> Send back for review</button>
                }
                @if (has('reject')) {
                  <button class="btn danger block" (click)="openModal('reject')"><app-icon name="x" [size]="16" /> Reject claim</button>
                }
                @if (has('withdraw')) {
                  <button class="btn danger block" (click)="openModal('withdraw')"><app-icon name="undo" [size]="16" /> Withdraw claim</button>
                }
                @if (d.availableActions.length === 0 || onlyNotes(d.availableActions)) {
                  <p class="muted small">No actions are available for you on this claim right now.</p>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- ───────── dialogs ───────── -->
        @switch (modal()) {
          @case ('assess') {
            <app-modal title="Record assessment" subtitle="Put a value on this claim after reviewing the evidence." (closed)="closeModal()">
              <div class="field">
                <label for="a-amt">Assessed amount (USD)</label>
                <input id="a-amt" type="number" min="1" class="input" [(ngModel)]="assessAmount" />
                <span class="help">The claimant asked for {{ d.summary.claimedAmount | money }}.</span>
              </div>
              <div class="field">
                <label for="a-note">Comment <span class="faint">(optional)</span></label>
                <textarea id="a-note" class="textarea" rows="3" [(ngModel)]="comment" placeholder="Basis for the assessment..."></textarea>
              </div>
              <div footer>
                <button class="btn secondary" (click)="closeModal()">Cancel</button>
                <button class="btn" [disabled]="busy() || !(assessAmount > 0)" (click)="submitAssess()">Save assessment</button>
              </div>
            </app-modal>
          }
          @case ('approve') {
            <app-modal title="Approve claim" subtitle="Approving makes the amount payable." (closed)="closeModal()">
              <div class="field">
                <label for="p-amt">Approved amount (USD)</label>
                <input id="p-amt" type="number" min="1" class="input" [(ngModel)]="approveAmount" />
                <span class="help">Assessed at {{ d.summary.assessedAmount | money }}. You can approve up to that amount.</span>
              </div>
              @if (approveAmount > threshold) {
                <div class="banner warn">
                  <app-icon name="shield" />
                  <span>{{ auth.isManager() ? 'Above $50,000: you are signing off as a manager.' : 'Approvals above $50,000 need a manager. Ask a manager to approve this claim.' }}</span>
                </div>
              }
              <div class="field">
                <label for="p-note">Comment <span class="faint">(optional)</span></label>
                <textarea id="p-note" class="textarea" rows="2" [(ngModel)]="comment"></textarea>
              </div>
              <div footer>
                <button class="btn secondary" (click)="closeModal()">Cancel</button>
                <button class="btn success" [disabled]="busy() || !(approveAmount > 0) || (approveAmount > threshold && !auth.isManager())" (click)="submitApprove()">Approve</button>
              </div>
            </app-modal>
          }
          @case ('reject') {
            <app-modal title="Reject claim" subtitle="The claimant will see this reason." (closed)="closeModal()">
              <div class="field">
                <label for="r-reason">Reason</label>
                <textarea id="r-reason" class="textarea" rows="4" [(ngModel)]="reason" placeholder="Explain clearly why the claim cannot be paid..."></textarea>
                <span class="help">{{ reason.trim().length }} / 10 characters minimum</span>
              </div>
              <div footer>
                <button class="btn secondary" (click)="closeModal()">Cancel</button>
                <button class="btn danger" [disabled]="busy() || reason.trim().length < 10" (click)="submitReject()">Reject claim</button>
              </div>
            </app-modal>
          }
          @case ('requestInfo') {
            <app-modal title="Request information" subtitle="The claim pauses until the claimant replies." (closed)="closeModal()">
              <div class="field">
                <label for="i-msg">What do you need?</label>
                <textarea id="i-msg" class="textarea" rows="4" [(ngModel)]="message" placeholder="e.g. Please upload the police report and photos of the damage."></textarea>
              </div>
              <div footer>
                <button class="btn secondary" (click)="closeModal()">Cancel</button>
                <button class="btn" [disabled]="busy() || message.trim().length < 5" (click)="submitRequestInfo()">Send request</button>
              </div>
            </app-modal>
          }
          @case ('assign') {
            <app-modal title="Assign to an officer" subtitle="The officer is notified straight away." (closed)="closeModal()">
              <div class="field">
                <label for="o-sel">Officer</label>
                <select id="o-sel" class="select" [(ngModel)]="assignOfficerId">
                  @for (o of officers(); track o.id) { <option [ngValue]="o.id">{{ o.name }}</option> }
                </select>
              </div>
              <div footer>
                <button class="btn secondary" (click)="closeModal()">Cancel</button>
                <button class="btn" [disabled]="busy() || assignOfficerId === null" (click)="submitAssign()">Assign</button>
              </div>
            </app-modal>
          }
          @case ('reopen') {
            <app-modal title="Send back for review?" subtitle="The claim returns to 'Under review' so it can be re-assessed." (closed)="closeModal()">
              <div footer>
                <button class="btn secondary" (click)="closeModal()">Cancel</button>
                <button class="btn" [disabled]="busy()" (click)="submitSimple('reopen')">Send back</button>
              </div>
            </app-modal>
          }
          @case ('settle') {
            <app-modal title="Mark as settled?" subtitle="Confirm the payment of {{ (d.summary.approvedAmount) | money }} has been made." (closed)="closeModal()">
              <div footer>
                <button class="btn secondary" (click)="closeModal()">Cancel</button>
                <button class="btn success" [disabled]="busy()" (click)="submitSimple('settle')">Confirm settlement</button>
              </div>
            </app-modal>
          }
          @case ('withdraw') {
            <app-modal title="Withdraw this claim?" subtitle="You won't be able to reopen it, but you can file a new claim." (closed)="closeModal()">
              <div footer>
                <button class="btn secondary" (click)="closeModal()">Keep claim</button>
                <button class="btn danger" [disabled]="busy()" (click)="submitSimple('withdraw')">Withdraw</button>
              </div>
            </app-modal>
          }
        }
      } @else {
        <div class="loading"><div class="spinner"></div></div>
      }
    </div>
  `,
  styles: [`
    .document-item { align-items: center; gap: 12px; }
    .document-meta { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; overflow-wrap: anywhere; }
    .back { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 0; color: var(--muted); cursor: pointer; margin-bottom: 14px; font-weight: 500; padding: 0; font-size: 14px; }
    .back:hover { color: var(--text); }
    .head { margin-bottom: 18px; }
    .head-main { display: flex; gap: 16px; align-items: center; }
    .type-ico { width: 52px; height: 52px; border-radius: 15px; background: var(--brand-50); color: var(--brand); display: grid; place-items: center; flex: none; }
    .type-ico.property { background: var(--violet-50); color: var(--violet); }
    .head h1 { font-size: 28px; }

    .rail-card { margin-bottom: 16px; padding: 22px 26px; }
    .rail { list-style: none; margin: 0; padding: 0; display: flex; }
    .rail li { flex: 1; position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
    .rail li:not(:last-child)::after { content: ''; position: absolute; top: 13px; left: calc(50% + 18px); right: calc(-50% + 18px); height: 3px; border-radius: 3px; background: var(--line); }
    .rail li.done:not(:last-child)::after { background: var(--brand); }
    .node { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--line); background: #fff; display: grid; place-items: center; color: #fff; z-index: 1; }
    .done .node { background: var(--brand); border-color: var(--brand); }
    .current .node { border-color: var(--brand); box-shadow: 0 0 0 5px var(--brand-100); }
    .current .node::after { content: ''; width: 10px; height: 10px; border-radius: 50%; background: var(--brand); }
    .step-label { font-size: 13px; font-weight: 600; color: var(--faint); }
    .done .step-label, .current .step-label { color: var(--text); }
    .wait { color: #a56a00; font-weight: 600; font-size: 12px; margin-top: -4px; }
    .terminal { margin-top: 18px; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 10px; font-weight: 600; }
    .terminal.Rejected { background: var(--red-50); color: var(--red); }
    .terminal.Withdrawn { background: #edeef2; color: #5b6377; }

    .desc { font-size: 15px; line-height: 1.6; }
    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px; }
    .facts div { display: flex; flex-direction: column; gap: 3px; }
    .facts span, .amt span { color: var(--muted); font-size: 13px; }

    .thread { margin-bottom: 18px; display: flex; flex-direction: column; gap: 10px; }
    .thread:last-child { margin-bottom: 0; }
    .bubble { padding: 12px 14px; border-radius: 12px; max-width: 92%; }
    .bubble.ask { background: var(--brand-50); align-self: flex-start; }
    .bubble.reply { background: var(--line-2); align-self: flex-end; }
    .bubble .who { display: flex; gap: 10px; align-items: baseline; margin-bottom: 4px; }
    .reply-form { display: flex; flex-direction: column; gap: 8px; border: 1px dashed #b9c2f5; border-radius: 12px; padding: 14px; background: #fbfbff; }
    .awaiting { display: flex; align-items: center; gap: 6px; }

    .note-form { display: flex; gap: 10px; margin-bottom: 14px; }
    .note-item { display: flex; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line-2); }
    .note-item p { margin-bottom: 2px; }

    .timeline { list-style: none; margin: 0; padding: 0; }
    .timeline li { display: flex; gap: 14px; padding-bottom: 18px; position: relative; }
    .timeline li:not(:last-child)::before { content: ''; position: absolute; left: 6px; top: 16px; bottom: 0; width: 2px; background: var(--line); }
    .tdot { width: 14px; height: 14px; border-radius: 50%; background: var(--brand); margin-top: 4px; flex: none; border: 3px solid #fff; box-shadow: 0 0 0 1px var(--line); }
    .tdot.Submitted { background: #9aa6cf; } .tdot.InfoRequested { background: var(--amber); } .tdot.Assessed { background: var(--violet); }
    .tdot.Approved { background: var(--teal); } .tdot.Settled { background: #06604a; } .tdot.Rejected { background: var(--red); } .tdot.Withdrawn { background: #b6bbca; }

    .amt { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; }
    .amt.total { border-top: 1px solid var(--line-2); margin-top: 4px; padding-top: 14px; }
    .amt.total strong { font-size: 22px; font-family: var(--font-display); }
    .actions { display: flex; flex-direction: column; gap: 10px; }
    .side { position: sticky; top: 80px; }
    @media (max-width: 1100px) { .side { position: static; } }
    @media (max-width: 720px) { .rail li .step-label { font-size: 11px; } .facts { grid-template-columns: 1fr; } }
  `],
})
export class ClaimDetailComponent {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private destroyRef = inject(DestroyRef);

  marketName = MARKET_NAME;
  threshold = APPROVAL_THRESHOLD;

  detail = signal<ClaimDetail | null>(null);
  modal = signal<ModalKind | null>(null);
  busy = signal(false);
  officers = signal<User[]>([]);
  claimId = 0;

  // form state for the dialogs / inline forms
  assessAmount = 0;
  approveAmount = 0;
  comment = '';
  reason = '';
  message = '';
  noteText = '';
  replyText = '';
  selectedDocument: File | null = null;
  assignOfficerId: number | null = null;

  historyDesc = computed(() => [...(this.detail()?.history ?? [])].reverse());

  rail = computed(() => {
    const d = this.detail();
    if (!d) return [];
    const status = d.summary.status;
    const terminalBad = status === 'Rejected' || status === 'Withdrawn';
    const reached = new Set(d.history.map(h => h.toStatus));
    const idx = STEP_INDEX[status] ?? 0;
    return STEPS.map((s, i) => {
      let state: 'done' | 'current' | 'todo';
      if (terminalBad) state = reached.has(s) ? 'done' : 'todo';
      else if (status === 'Settled') state = 'done';
      else state = i < idx ? 'done' : i === idx ? 'current' : 'todo';
      return { status: s, label: STATUS_LABEL[s], state };
    });
  });

  @Input() set id(value: string) {
    this.claimId = Number(value);
    this.detail.set(null);
    this.fetch(false);
    this.startPolling();
  }

  private pollStarted = false;
  private startPolling() {
    if (this.pollStarted) return;
    this.pollStarted = true;
    // Quietly refresh so changes made by someone else (or by background consumers) show up.
    timer(6000, 6000).pipe(
      switchMap(() => (this.modal() || this.busy() ? of(null) : this.api.claim(this.claimId, true).pipe(catchError(() => of(null))))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(d => { if (d) this.detail.set(d); });
  }

  private fetch(quiet: boolean) {
    this.api.claim(this.claimId, quiet).subscribe({
      next: d => this.detail.set(d),
      error: () => this.location.back(),
    });
  }

  has(action: string): boolean { return !!this.detail()?.availableActions.includes(action); }
  onlyNotes(actions: string[]): boolean { return actions.every(a => a === 'addNote'); }
  back() { this.location.back(); }

  // ───────── dialogs ─────────
  openModal(kind: ModalKind) {
    const d = this.detail()!;
    this.comment = ''; this.reason = ''; this.message = '';
    this.assessAmount = d.summary.assessedAmount ?? d.summary.claimedAmount;
    this.approveAmount = d.summary.assessedAmount ?? d.summary.claimedAmount;
    if (kind === 'assign') {
      this.assignOfficerId = d.summary.assignedOfficerId;
      if (this.officers().length === 0) this.api.officers().subscribe(o => this.officers.set(o));
    }
    this.modal.set(kind);
  }
  closeModal() { this.modal.set(null); }

  // ───────── commands (each one is a real backend call) ─────────
  private run(call: Observable<ClaimDetail>, successMessage: string) {
    this.busy.set(true);
    call.subscribe({
      next: d => {
        this.detail.set(d);
        this.busy.set(false);
        this.modal.set(null);
        this.toast.success(successMessage);
      },
      error: () => this.busy.set(false),
    });
  }

  assignToMe() { this.run(this.api.assign(this.claimId, this.auth.user()!.id), 'Claim assigned to you.'); }
  submitAssign() { this.run(this.api.assign(this.claimId, this.assignOfficerId), 'Claim assigned.'); }
  submitAssess() { this.run(this.api.assess(this.claimId, Number(this.assessAmount), this.comment), 'Assessment recorded.'); }
  submitApprove() { this.run(this.api.approve(this.claimId, Number(this.approveAmount), this.comment), 'Claim approved.'); }
  submitReject() { this.run(this.api.reject(this.claimId, this.reason), 'Claim rejected. The claimant has been notified.'); }
  submitRequestInfo() { this.run(this.api.requestInfo(this.claimId, this.message), 'Request sent to the claimant.'); }

  submitSimple(kind: 'reopen' | 'settle' | 'withdraw') {
    switch (kind) {
      case 'reopen': this.run(this.api.reopen(this.claimId), 'Sent back for review.'); break;
      case 'settle': this.run(this.api.settle(this.claimId), 'Claim settled.'); break;
      case 'withdraw': this.run(this.api.withdraw(this.claimId), 'Claim withdrawn.'); break;
    }
  }

  sendReply() {
    const text = this.replyText.trim();
    if (text.length < 3 || this.busy()) return;

    this.busy.set(true);

    // A selected file is not uploaded until the upload endpoint is called. Upload it
    // before completing the information request so the status change cannot hide an
    // unsubmitted attachment from the claimant.
    // Explicitly unify both branches so RxJS does not infer a union of
    // Observable<ClaimDocument> and Observable<null> (which breaks pipe/subscribe typing).
    const upload$: Observable<ClaimDocument | null> = this.selectedDocument
      ? this.api.uploadDocument(this.claimId, this.selectedDocument)
      : of(null);

    upload$.pipe(
      switchMap(() => this.api.provideInfo(this.claimId, text)),
    ).subscribe({
      next: d => {
        this.detail.set(d);
        this.replyText = '';
        this.selectedDocument = null;
        this.busy.set(false);
        this.toast.success('Thanks! Your reply has been sent.');
      },
      error: () => {
        // Keep the reply and selected file so the claimant can retry safely.
        this.busy.set(false);
      },
    });
  }

  selectDocument(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) { this.selectedDocument = null; return; }
    const allowed = /\.(pdf|jpe?g|docx?)$/i.test(file.name);
    if (!allowed) { this.toast.error('Choose a PDF, JPEG, DOC, or DOCX file.'); input.value = ''; this.selectedDocument = null; return; }
    if (file.size > 10 * 1024 * 1024) { this.toast.error('Files must be 10 MB or smaller.'); input.value = ''; this.selectedDocument = null; return; }
    this.selectedDocument = file;
  }

  uploadDocument() {
    if (!this.selectedDocument) return;
    this.busy.set(true);
    this.api.uploadDocument(this.claimId, this.selectedDocument).pipe(
      switchMap(() => this.api.claim(this.claimId)),
    ).subscribe({
      next: d => { this.detail.set(d); this.selectedDocument = null; this.busy.set(false); this.toast.success('Document submitted successfully.'); },
      error: () => this.busy.set(false),
    });
  }

  downloadDocument(documentId: number) {
    this.api.downloadDocument(this.claimId, documentId).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = this.detail()?.documents.find(d => d.id === documentId)?.fileName ?? 'claim-document';
        link.click(); URL.revokeObjectURL(url);
      },
    });
  }

  formatBytes(bytes: number): string {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  addNote() {
    if (!this.noteText.trim()) return;
    this.busy.set(true);
    this.api.addNote(this.claimId, this.noteText).subscribe({
      next: d => {
        this.detail.set(d);
        this.noteText = '';
        this.busy.set(false);
        this.toast.success('Note added.');
      },
      error: () => this.busy.set(false),
    });
  }
}
