import { Location } from '@angular/common';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import {
  ApiSpy, CLAIMANT, MANAGER, OFFICER, OFFICER_2, createApiSpy, makeDetail, provideApiSpy,
} from '../../testing/fixtures';
import { AuthService } from '../core/auth.service';
import { ClaimDetail, ClaimStatus, User } from '../core/models';
import { ToastService } from '../core/toast.service';
import { ClaimDetailComponent } from './claim-detail.component';

describe('ClaimDetailComponent', () => {
  let api: ApiSpy;
  let toast: ToastService;
  let location: jasmine.SpyObj<Location>;
  let fixture: ComponentFixture<ClaimDetailComponent>;
  let cmp: ClaimDetailComponent;

  function setup(detail: ClaimDetail, user: User = OFFICER) {
    TestBed.resetTestingModule();
    localStorage.removeItem('claims.user');
    api = createApiSpy();
    api.claim.and.returnValue(of(detail));
    location = jasmine.createSpyObj<Location>('Location', ['back']);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideApiSpy(api), { provide: Location, useValue: location }],
    });
    TestBed.inject(AuthService).signIn(user);
    toast = TestBed.inject(ToastService);
    spyOn(toast, 'success');
    fixture = TestBed.createComponent(ClaimDetailComponent);
    cmp = fixture.componentInstance;
    fixture.componentRef.setInput('id', String(detail.summary.id));
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent!.replace(/\s+/g, ' ');
  const buttonTexts = () => Array.from(el().querySelectorAll('.actions button')).map(b => b.textContent!.trim());
  const modalTitle = () => el().querySelector('app-modal h2')?.textContent;
  const click = (selector: string) => (el().querySelector(selector) as HTMLElement).click();

  /** A detail view in a given status as seen by a given user. */
  const detail = (status: ClaimStatus, actions: string[], extra: Partial<ClaimDetail> = {}, summary = {}) =>
    makeDetail({ availableActions: actions, ...extra }, { status, ...summary });

  afterEach(() => localStorage.removeItem('claims.user'));

  describe('loading', () => {
    it('fetches the claim named by the route id (loudly)', () => {
      setup(detail('Submitted', []));
      expect(api.claim).toHaveBeenCalledOnceWith(101, false);
    });

    it('shows a spinner until the claim arrives', () => {
      setup(detail('Submitted', []));
      api.claim.and.returnValue(new Subject<ClaimDetail>());
      fixture.componentRef.setInput('id', '202');
      fixture.detectChanges();
      expect(cmp.detail()).toBeNull();
      expect(el().querySelector('.loading .spinner')).toBeTruthy();
    });

    it('reloads when the id changes', () => {
      setup(detail('Submitted', []));
      fixture.componentRef.setInput('id', '202');
      expect(api.claim).toHaveBeenCalledWith(202, false);
      expect(cmp.claimId).toBe(202);
    });

    it('goes back if the claim cannot be loaded (e.g. 404 for someone else\'s claim)', () => {
      setup(detail('Submitted', []));
      api.claim.and.returnValue(throwError(() => ({ status: 404 })));
      fixture.componentRef.setInput('id', '999');
      expect(location.back).toHaveBeenCalled();
    });

    it('has a Back button', () => {
      setup(detail('Submitted', []));
      click('button.back');
      expect(location.back).toHaveBeenCalled();
    });
  });

  describe('header and facts', () => {
    beforeEach(() => setup(detail('UnderReview', [], { location: 'Tampines, Singapore' }, { claimNumber: 'CLM-2026-000555', type: 'Property', market: 'HK' })));

    it('shows the claim number, status and context', () => {
      expect(el().querySelector('h1')!.textContent).toBe('CLM-2026-000555');
      expect(el().querySelector('.head .chip')!.textContent!.trim()).toBe('Under review');
      expect(text()).toContain('Property claim · Hong Kong');
      expect(text()).toContain('by Aisha Rahman');
    });

    it('uses a house icon for property and a car for motor', () => {
      expect(el().querySelector('.type-ico')!.classList).toContain('property');
    });

    it('shows what happened and where', () => {
      expect(text()).toContain('Rear-ended at a traffic light; bumper damaged.');
      expect(text()).toContain('Tampines, Singapore');
      expect(text()).toContain('MTR-SG-482913');
      expect(text()).toContain('01 Oct 2026');
    });

    it('shows the decision reason when there is one', () => {
      setup(detail('Rejected', [], { decisionReason: 'Policy had lapsed.' }));
      expect(text()).toContain('Decision reason');
      expect(text()).toContain('Policy had lapsed.');
    });

    it('hides the decision-reason block otherwise', () => {
      expect(text()).not.toContain('Decision reason');
    });
  });

  describe('amounts card', () => {
    it('shows "Current exposure" (claimed) before assessment', () => {
      setup(detail('Submitted', [], {}, { claimedAmount: 4200 }));
      expect(text()).toContain('Claimed$4,200');
      expect(text()).toContain('Assessed—');
      expect(text()).toContain('Current exposure$4,200');
      expect(text()).toContain('Not assigned yet');
    });

    it('switches to the assessed amount, then the approved amount', () => {
      setup(detail('Assessed', [], {}, { claimedAmount: 4200, assessedAmount: 3900, assignedOfficerName: 'Priya Sharma', assignedOfficerId: 5 }));
      expect(text()).toContain('Current exposure$3,900');
      expect(text()).toContain('Priya Sharma');
      setup(detail('Approved', [], {}, { claimedAmount: 4200, assessedAmount: 3900, approvedAmount: 3500 }));
      expect(text()).toContain('Approved$3,500');
      expect(text()).not.toContain('Current exposure');
    });
  });

  describe('lifecycle rail', () => {
    const states = (status: ClaimStatus, history: ClaimStatus[] = []) => {
      setup(detail(status, [], {
        history: history.map(s => ({ fromStatus: null, toStatus: s, action: s, comment: null, actorName: 'x', at: '2026-10-02T08:00:00Z' })),
      }));
      return cmp.rail().map(s => s.state);
    };

    it('highlights the current step and ticks the earlier ones', () => {
      expect(states('Submitted')).toEqual(['current', 'todo', 'todo', 'todo', 'todo']);
      expect(states('UnderReview')).toEqual(['done', 'current', 'todo', 'todo', 'todo']);
      expect(states('Assessed')).toEqual(['done', 'done', 'current', 'todo', 'todo']);
      expect(states('Approved')).toEqual(['done', 'done', 'done', 'current', 'todo']);
    });

    it('treats "Info requested" as part of the review step', () => {
      expect(states('InfoRequested')).toEqual(['done', 'current', 'todo', 'todo', 'todo']);
    });

    it('says who we are waiting for while info is requested', () => {
      setup(detail('InfoRequested', []));
      expect(el().querySelector('.wait')!.textContent).toBe('Waiting for claimant');
    });

    it('ticks every step once settled', () => {
      expect(states('Settled')).toEqual(['done', 'done', 'done', 'done', 'done']);
    });

    it('for a rejected claim, ticks only the steps it actually passed through', () => {
      expect(states('Rejected', ['Submitted', 'UnderReview', 'Assessed', 'Rejected']))
        .toEqual(['done', 'done', 'done', 'todo', 'todo']);
      expect(text()).toContain('This claim was rejected.');
    });

    it('for a withdrawn claim, stops where the claimant stopped', () => {
      expect(states('Withdrawn', ['Submitted', 'Withdrawn'])).toEqual(['done', 'todo', 'todo', 'todo', 'todo']);
      expect(text()).toContain('This claim was withdrawn.');
    });

    it('labels the five steps', () => {
      setup(detail('Submitted', []));
      expect(cmp.rail().map(s => s.label)).toEqual(['Submitted', 'Under review', 'Assessed', 'Approved', 'Settled']);
      expect(el().querySelectorAll('.rail li').length).toBe(5);
    });

    it('is empty until the claim loads', () => {
      setup(detail('Submitted', []));
      cmp.detail.set(null);
      expect(cmp.rail()).toEqual([]);
    });
  });

  describe('timeline', () => {
    it('is empty before the claim has loaded', () => {
      setup(detail('Submitted', []));
      cmp.detail.set(null);
      expect(cmp.historyDesc()).toEqual([]);
    });

    it('lists the audit trail newest-first', () => {
      setup(detail('UnderReview', [], {
        history: [
          { fromStatus: null, toStatus: 'Submitted', action: 'Claim submitted', comment: null, actorName: 'Aisha Rahman', at: '2026-10-02T08:00:00Z' },
          { fromStatus: 'Submitted', toStatus: 'UnderReview', action: 'Picked up for review', comment: 'On it', actorName: 'Priya Sharma', at: '2026-10-03T08:00:00Z' },
        ],
      }));
      expect(cmp.historyDesc().map(h => h.action)).toEqual(['Picked up for review', 'Claim submitted']);
      const items = el().querySelectorAll('.timeline li');
      expect(items[0].textContent).toContain('Picked up for review');
      expect(items[0].textContent).toContain('On it');
      expect(items[0].textContent).toContain('Priya Sharma');
    });
  });

  describe('action buttons mirror the server\'s availableActions', () => {
    const expectations: [string, string, Partial<ClaimDetail>?, object?][] = [
      ['assignToMe', 'Pick up this claim'],
      ['assess', 'Record assessment'],
      ['approve', 'Approve claim'],
      ['settle', 'Mark as settled'],
      ['requestInfo', 'Request information'],
      ['assign', 'Assign to officer'],
      ['assign', 'Reassign officer', {}, { assignedOfficerId: 5 }],
      ['reopen', 'Send back for review'],
      ['reject', 'Reject claim'],
      ['withdraw', 'Withdraw claim'],
    ];
    expectations.forEach(([action, label, extra, summary]) => {
      it(`"${action}" -> "${label}"`, () => {
        setup(detail('UnderReview', [action], extra, summary));
        expect(buttonTexts()).toEqual([label]);
      });
    });

    it('shows no buttons for actions the server did not offer', () => {
      setup(detail('UnderReview', ['addNote', 'assess']));
      expect(buttonTexts()).toEqual(['Record assessment']);
    });

    it('explains when there is nothing the user can do', () => {
      setup(detail('Settled', []));
      expect(el().querySelector('.actions p')!.textContent).toContain('No actions are available');
    });

    it('also explains it when the only action is adding a note', () => {
      setup(detail('Approved', ['addNote']));
      expect(el().querySelector('.actions p')!.textContent).toContain('No actions are available');
      expect(cmp.onlyNotes(['addNote'])).toBeTrue();
      expect(cmp.onlyNotes(['addNote', 'settle'])).toBeFalse();
    });

    it('has() reads from the loaded claim', () => {
      setup(detail('UnderReview', ['assess']));
      expect(cmp.has('assess')).toBeTrue();
      expect(cmp.has('approve')).toBeFalse();
    });
  });

  describe('commands (each one is a real backend call)', () => {
    const after = (status: ClaimStatus) => detail(status, [], {}, { status });

    it('"Pick up this claim" assigns to me and confirms', () => {
      setup(detail('Submitted', ['assignToMe']));
      api.assign.and.returnValue(of(after('UnderReview')));
      click('.actions button');
      expect(api.assign).toHaveBeenCalledWith(101, OFFICER.id);
      expect(toast.success).toHaveBeenCalledWith('Claim assigned to you.');
      expect(cmp.detail()!.summary.status).toBe('UnderReview');
    });

    it('records an assessment (amount defaults to the claimed amount)', () => {
      setup(detail('UnderReview', ['assess'], {}, { claimedAmount: 4200 }));
      click('.actions button');
      fixture.detectChanges();
      expect(modalTitle()).toBe('Record assessment');
      expect(cmp.assessAmount).toBe(4200);
      api.assess.and.returnValue(of(after('Assessed')));
      cmp.assessAmount = 3900;
      cmp.comment = 'Repair estimate verified';
      cmp.submitAssess();
      expect(api.assess).toHaveBeenCalledOnceWith(101, 3900, 'Repair estimate verified');
      expect(toast.success).toHaveBeenCalledWith('Assessment recorded.');
      expect(cmp.modal()).toBeNull();
      expect(cmp.detail()!.summary.status).toBe('Assessed');
    });

    it('re-assessing defaults to the previous assessment', () => {
      setup(detail('UnderReview', ['assess'], {}, { claimedAmount: 4200, assessedAmount: 3000 }));
      cmp.openModal('assess');
      expect(cmp.assessAmount).toBe(3000);
    });

    it('approves with the amount and comment', () => {
      setup(detail('Assessed', ['approve'], {}, { claimedAmount: 4200, assessedAmount: 3900 }));
      cmp.openModal('approve');
      expect(cmp.approveAmount).toBe(3900);
      api.approve.and.returnValue(of(after('Approved')));
      cmp.comment = 'Good to pay';
      cmp.submitApprove();
      expect(api.approve).toHaveBeenCalledOnceWith(101, 3900, 'Good to pay');
      expect(toast.success).toHaveBeenCalledWith('Claim approved.');
    });

    it('rejects with a reason', () => {
      setup(detail('UnderReview', ['reject']));
      cmp.openModal('reject');
      api.reject.and.returnValue(of(after('Rejected')));
      cmp.reason = 'Not covered under this policy.';
      cmp.submitReject();
      expect(api.reject).toHaveBeenCalledOnceWith(101, 'Not covered under this policy.');
      expect(toast.success).toHaveBeenCalledWith('Claim rejected. The claimant has been notified.');
    });

    it('requests information', () => {
      setup(detail('UnderReview', ['requestInfo']));
      cmp.openModal('requestInfo');
      api.requestInfo.and.returnValue(of(after('InfoRequested')));
      cmp.message = 'Please upload the police report.';
      cmp.submitRequestInfo();
      expect(api.requestInfo).toHaveBeenCalledOnceWith(101, 'Please upload the police report.');
      expect(toast.success).toHaveBeenCalledWith('Request sent to the claimant.');
    });

    it('opens each dialog with a clean slate (no leftover text from the last one)', () => {
      setup(detail('UnderReview', ['reject', 'requestInfo']));
      cmp.reason = 'old'; cmp.message = 'old'; cmp.comment = 'old';
      cmp.openModal('reject');
      expect([cmp.reason, cmp.message, cmp.comment]).toEqual(['', '', '']);
    });

    const simple: [string, 'reopen' | 'settle' | 'withdraw', () => jasmine.Spy, string, ClaimStatus][] = [
      ['reopen', 'reopen', () => api.reopen, 'Sent back for review.', 'UnderReview'],
      ['settle', 'settle', () => api.settle, 'Claim settled.', 'Settled'],
      ['withdraw', 'withdraw', () => api.withdraw, 'Claim withdrawn.', 'Withdrawn'],
    ];
    simple.forEach(([name, kind, spy, message, status]) => {
      it(`${name}: calls the API, toasts, closes the dialog`, () => {
        setup(detail('Assessed', [name]));
        cmp.openModal(name as 'reopen');
        spy().and.returnValue(of(after(status)));
        cmp.submitSimple(kind);
        expect(spy()).toHaveBeenCalledOnceWith(101);
        expect(toast.success).toHaveBeenCalledWith(message);
        expect(cmp.modal()).toBeNull();
      });
    });

    it('assign: loads officers once, pre-selects the current one, and assigns', () => {
      setup(detail('UnderReview', ['assign'], {}, { assignedOfficerId: 5 }), MANAGER);
      cmp.openModal('assign');
      expect(api.officers).toHaveBeenCalledTimes(1);
      expect(cmp.officers().map(o => o.id)).toEqual([OFFICER.id, OFFICER_2.id]);
      expect(cmp.assignOfficerId).toBe(5);
      cmp.openModal('assign'); // second time: no refetch
      expect(api.officers).toHaveBeenCalledTimes(1);
      api.assign.and.returnValue(of(after('UnderReview')));
      cmp.assignOfficerId = 6;
      cmp.submitAssign();
      expect(api.assign).toHaveBeenCalledWith(101, 6);
      expect(toast.success).toHaveBeenCalledWith('Claim assigned.');
    });

    it('the dialog is a real DOM modal that can be cancelled', () => {
      setup(detail('UnderReview', ['reject']));
      click('.actions button');
      fixture.detectChanges();
      expect(modalTitle()).toBe('Reject claim');
      click('app-modal footer .btn.secondary');
      fixture.detectChanges();
      expect(el().querySelector('app-modal')).toBeNull();
      expect(api.reject).not.toHaveBeenCalled();
    });

    it('Escape closes the dialog', () => {
      setup(detail('UnderReview', ['reject']));
      cmp.openModal('reject');
      fixture.detectChanges();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(cmp.modal()).toBeNull();
    });

    it('keeps the dialog open and re-enables the buttons when the server says no', () => {
      setup(detail('UnderReview', ['assess']));
      cmp.openModal('assess');
      api.assess.and.returnValue(throwError(() => ({ status: 409 })));
      cmp.submitAssess();
      expect(cmp.busy()).toBeFalse();
      expect(cmp.modal()).toBe('assess');
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('is busy while a command runs, which blocks the submit button', () => {
      setup(detail('UnderReview', ['reject']));
      cmp.openModal('reject');
      cmp.reason = 'A perfectly clear reason.';
      fixture.detectChanges();
      api.reject.and.returnValue(new Subject<ClaimDetail>());
      click('app-modal footer .btn.danger');
      fixture.detectChanges();
      expect(cmp.busy()).toBeTrue();
      expect((el().querySelector('app-modal footer .btn.danger') as HTMLButtonElement).disabled).toBeTrue();
    });
  });

  describe('dialog validation', () => {
    const disabled = (sel: string) => (el().querySelector(sel) as HTMLButtonElement).disabled;
    const open = (kind: 'assess' | 'approve' | 'reject' | 'requestInfo' | 'assign', d = detail('UnderReview', []), user: User = OFFICER) => {
      setup(d, user);
      cmp.openModal(kind);
      fixture.detectChanges();
    };

    it('assessment needs a positive amount', () => {
      open('assess');
      expect(disabled('app-modal footer .btn:not(.secondary)')).toBeFalse();
      cmp.assessAmount = 0; fixture.detectChanges();
      expect(disabled('app-modal footer .btn:not(.secondary)')).toBeTrue();
    });

    it('rejection needs a reason of at least 10 characters, with a live counter', () => {
      open('reject');
      cmp.reason = 'too short'; fixture.detectChanges();
      expect(text()).toContain('9 / 10 characters minimum');
      expect(disabled('app-modal footer .btn.danger')).toBeTrue();
      cmp.reason = 'long enough reason'; fixture.detectChanges();
      expect(disabled('app-modal footer .btn.danger')).toBeFalse();
    });

    it('a rejection reason of only spaces does not count', () => {
      open('reject');
      cmp.reason = '            '; fixture.detectChanges();
      expect(disabled('app-modal footer .btn.danger')).toBeTrue();
    });

    it('an information request needs at least 5 characters', () => {
      open('requestInfo');
      cmp.message = 'abcd'; fixture.detectChanges();
      expect(disabled('app-modal footer .btn:not(.secondary)')).toBeTrue();
      cmp.message = 'abcde'; fixture.detectChanges();
      expect(disabled('app-modal footer .btn:not(.secondary)')).toBeFalse();
    });

    it('assignment needs an officer chosen', () => {
      open('assign', detail('Submitted', ['assign']), MANAGER);
      cmp.assignOfficerId = null; fixture.detectChanges();
      expect(disabled('app-modal footer .btn:not(.secondary)')).toBeTrue();
      cmp.assignOfficerId = 5; fixture.detectChanges();
      expect(disabled('app-modal footer .btn:not(.secondary)')).toBeFalse();
    });

    describe('four-eyes rule: approvals above $50,000 need a manager', () => {
      const assessed = () => detail('Assessed', ['approve'], {}, { claimedAmount: 90000, assessedAmount: 85000 });

      it('warns an officer and blocks the Approve button', () => {
        open('approve', assessed(), OFFICER);
        expect(cmp.approveAmount).toBe(85000);
        expect(el().querySelector('app-modal .banner.warn')!.textContent).toContain('need a manager');
        expect(disabled('app-modal footer .btn.success')).toBeTrue();
      });

      it('lets a manager through, noting they are signing off', () => {
        open('approve', assessed(), MANAGER);
        expect(el().querySelector('app-modal .banner.warn')!.textContent).toContain('you are signing off as a manager');
        expect(disabled('app-modal footer .btn.success')).toBeFalse();
      });

      it('lets an officer approve exactly $50,000 (the rule is "above")', () => {
        open('approve', assessed(), OFFICER);
        cmp.approveAmount = 50000; fixture.detectChanges();
        expect(el().querySelector('app-modal .banner.warn')).toBeNull();
        expect(disabled('app-modal footer .btn.success')).toBeFalse();
      });

      it('lets an officer approve a smaller amount than assessed', () => {
        open('approve', assessed(), OFFICER);
        cmp.approveAmount = 40000; fixture.detectChanges();
        expect(disabled('app-modal footer .btn.success')).toBeFalse();
      });

      it('blocks a zero or negative approval', () => {
        open('approve', assessed(), MANAGER);
        cmp.approveAmount = 0; fixture.detectChanges();
        expect(disabled('app-modal footer .btn.success')).toBeTrue();
      });
    });
  });

  describe('claimant view', () => {
    const asked = detail('InfoRequested', ['withdraw', 'provideInfo'], {
      infoRequests: [{ id: 1, message: 'Please upload the police report.', requestedByName: 'Priya Sharma', requestedAt: '2026-10-03T08:00:00Z', response: null, respondedAt: null }],
    });

    it('is nudged with a banner when we are waiting on them', () => {
      setup(asked, CLAIMANT);
      expect(el().querySelector('.banner.warn')!.textContent).toContain('We need something from you');
    });

    it('does not show that banner to staff', () => {
      setup(asked, OFFICER);
      expect(text()).not.toContain('We need something from you');
    });

    it('sees the request and a reply form', () => {
      setup(asked, CLAIMANT);
      expect(el().querySelector('.bubble.ask')!.textContent).toContain('Please upload the police report.');
      expect(el().querySelector('textarea#reply')).toBeTruthy();
    });

    it('cannot send an empty or tiny reply', () => {
      setup(asked, CLAIMANT);
      const send = () => el().querySelector('.reply-form .btn') as HTMLButtonElement;
      expect(send().disabled).toBeTrue();
      cmp.replyText = 'ok'; fixture.detectChanges();
      expect(send().disabled).toBeTrue();
      cmp.replyText = 'Attached.'; fixture.detectChanges();
      expect(send().disabled).toBeFalse();
    });

    it('sends the reply, clears the box and thanks them', () => {
      setup(asked, CLAIMANT);
      api.provideInfo.and.returnValue(of(detail('UnderReview', ['withdraw'])));
      cmp.replyText = 'Police report attached.';
      cmp.sendReply();
      expect(api.provideInfo).toHaveBeenCalledOnceWith(101, 'Police report attached.');
      expect(cmp.replyText).toBe('');
      expect(toast.success).toHaveBeenCalledWith('Thanks! Your reply has been sent.');
      expect(cmp.busy()).toBeFalse();
    });

    it('uploads a selected document before sending the information reply', () => {
      setup(asked, CLAIMANT);
      const file = new File(['police report'], 'police-report.pdf', { type: 'application/pdf' });
      api.uploadDocument.and.returnValue(of({ id: 9, fileName: file.name, contentType: file.type, sizeBytes: file.size, uploadedByName: CLAIMANT.name, uploadedAt: '2026-10-28T12:00:00Z' }));
      api.provideInfo.and.returnValue(of(detail('UnderReview', ['withdraw'])));
      cmp.selectedDocument = file;
      cmp.replyText = 'Police report attached.';

      cmp.sendReply();

      expect(api.uploadDocument).toHaveBeenCalledOnceWith(101, file);
      expect(api.provideInfo).toHaveBeenCalledOnceWith(101, 'Police report attached.');
      expect(cmp.selectedDocument).toBeNull();
      expect(cmp.replyText).toBe('');
    });

    it('keeps their text if sending fails', () => {
      setup(asked, CLAIMANT);
      api.provideInfo.and.returnValue(throwError(() => ({ status: 500 })));
      cmp.replyText = 'Police report attached.';
      cmp.sendReply();
      expect(cmp.replyText).toBe('Police report attached.');
      expect(cmp.busy()).toBeFalse();
    });

    it('sees an answered request as a conversation', () => {
      setup(detail('UnderReview', [], {
        infoRequests: [{ id: 1, message: 'Photos please', requestedByName: 'Priya Sharma', requestedAt: '2026-10-03T08:00:00Z', response: 'Sent them.', respondedAt: '2026-10-04T08:00:00Z' }],
      }), CLAIMANT);
      expect(el().querySelector('.bubble.reply')!.textContent).toContain('Sent them.');
      expect(el().querySelector('textarea#reply')).toBeNull();
    });

    it('does not see internal notes', () => {
      setup(detail('UnderReview', ['withdraw']), CLAIMANT);
      expect(text()).not.toContain('Internal notes');
    });

    it('can withdraw (with a confirmation dialog)', () => {
      setup(detail('Submitted', ['withdraw']), CLAIMANT);
      click('.actions button');
      fixture.detectChanges();
      expect(modalTitle()).toBe('Withdraw this claim?');
    });
  });

  describe('staff view of information requests', () => {
    it('shows "Awaiting the claimant\'s reply" for an open request', () => {
      setup(detail('InfoRequested', ['addNote'], {
        infoRequests: [{ id: 1, message: 'Photos please', requestedByName: 'Priya Sharma', requestedAt: '2026-10-03T08:00:00Z', response: null, respondedAt: null }],
      }));
      expect(el().querySelector('.awaiting')!.textContent).toContain("Awaiting the claimant's reply");
      expect(el().querySelector('textarea#reply')).toBeNull();
    });

    it('hides the section entirely when there are no requests', () => {
      setup(detail('UnderReview', []));
      expect(text()).not.toContain('Information requests');
    });
  });

  describe('internal notes (staff only)', () => {
    const withNotes = () => detail('UnderReview', ['addNote'], {
      notes: [{ id: 1, text: 'Called the garage', authorName: 'Priya Sharma', at: '2026-10-03T08:00:00Z' }],
    });

    it('lists existing notes', () => {
      setup(withNotes());
      expect(el().querySelector('.note-item')!.textContent).toContain('Called the garage');
    });

    it('says when there are none', () => {
      setup(detail('UnderReview', ['addNote']));
      expect(text()).toContain('No notes yet.');
    });

    it('hides the input when the server did not offer addNote (closed claim)', () => {
      setup(detail('Settled', []));
      expect(el().querySelector('.note-form')).toBeNull();
    });

    it('adds a note, clears the field and confirms', () => {
      setup(withNotes());
      api.addNote.and.returnValue(of(withNotes()));
      cmp.noteText = 'Spoke to the claimant';
      cmp.addNote();
      expect(api.addNote).toHaveBeenCalledOnceWith(101, 'Spoke to the claimant');
      expect(cmp.noteText).toBe('');
      expect(toast.success).toHaveBeenCalledWith('Note added.');
    });

    it('ignores a blank note', () => {
      setup(withNotes());
      cmp.noteText = '    ';
      cmp.addNote();
      expect(api.addNote).not.toHaveBeenCalled();
    });

    it('disables the button for a blank note', () => {
      setup(withNotes());
      const btn = el().querySelector('.note-form .btn') as HTMLButtonElement;
      expect(btn.disabled).toBeTrue();
      cmp.noteText = 'hello'; fixture.detectChanges();
      expect(btn.disabled).toBeFalse();
    });

    it('submits with the Enter key', () => {
      setup(withNotes());
      api.addNote.and.returnValue(of(withNotes()));
      cmp.noteText = 'via enter';
      el().querySelector('.note-form input')!.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
      expect(api.addNote).toHaveBeenCalledWith(101, 'via enter');
    });

    it('keeps the text when the server rejects it', () => {
      setup(withNotes());
      api.addNote.and.returnValue(throwError(() => ({ status: 400 })));
      cmp.noteText = 'keep me';
      cmp.addNote();
      expect(cmp.noteText).toBe('keep me');
      expect(cmp.busy()).toBeFalse();
    });
  });

  describe('background refresh (changes made by others show up)', () => {
    it('quietly re-fetches every 6 seconds and shows the new state', fakeAsync(() => {
      setup(detail('UnderReview', []));
      api.claim.and.returnValue(of(detail('Assessed', [])));
      tick(6000);
      expect(api.claim).toHaveBeenCalledWith(101, true);
      expect(cmp.detail()!.summary.status).toBe('Assessed');
      fixture.destroy();
    }));

    it('only starts one poller even if the id changes', fakeAsync(() => {
      setup(detail('UnderReview', []));
      fixture.componentRef.setInput('id', '202');
      fixture.componentRef.setInput('id', '303');
      api.claim.calls.reset();
      tick(6000);
      expect(api.claim).toHaveBeenCalledTimes(1);
      expect(api.claim).toHaveBeenCalledWith(303, true);
      fixture.destroy();
    }));

    it('does not refresh underneath an open dialog (it would wipe the user\'s input)', fakeAsync(() => {
      setup(detail('UnderReview', ['reject']));
      cmp.openModal('reject');
      api.claim.calls.reset();
      tick(12000);
      expect(api.claim).not.toHaveBeenCalled();
      cmp.closeModal();
      tick(6000);
      expect(api.claim).toHaveBeenCalledTimes(1);
      fixture.destroy();
    }));

    it('does not refresh while a command is running', fakeAsync(() => {
      setup(detail('UnderReview', []));
      cmp.busy.set(true);
      api.claim.calls.reset();
      tick(6000);
      expect(api.claim).not.toHaveBeenCalled();
      fixture.destroy();
    }));

    it('keeps the current view if a refresh fails', fakeAsync(() => {
      setup(detail('UnderReview', []));
      api.claim.and.returnValue(throwError(() => new Error('blip')));
      tick(6000);
      expect(cmp.detail()!.summary.status).toBe('UnderReview');
      fixture.destroy();
    }));

    it('stops when the page is left', fakeAsync(() => {
      setup(detail('UnderReview', []));
      fixture.destroy();
      api.claim.calls.reset();
      tick(30000);
      expect(api.claim).not.toHaveBeenCalled();
    }));
  });
});
