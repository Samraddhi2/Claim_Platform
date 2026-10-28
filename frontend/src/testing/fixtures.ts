// Shared test data builders + an ApiService spy factory. Only imported by *.spec.ts files.
import { Provider } from '@angular/core';
import { of } from 'rxjs';
import { ApiService } from '../app/core/api.service';
import {
  ClaimDetail, ClaimSummary, Dashboard, NotificationItem, Paged, SystemInfo, User, Workload,
} from '../app/core/models';

export const CLAIMANT: User = { id: 1, name: 'Aisha Rahman', email: 'aisha@demo.com', role: 'Claimant', market: 'MY' };
export const OFFICER: User = { id: 5, name: 'Priya Sharma', email: 'priya@demo.com', role: 'Officer', market: null };
export const OFFICER_2: User = { id: 6, name: 'Marcus Tan', email: 'marcus@demo.com', role: 'Officer', market: null };
export const MANAGER: User = { id: 8, name: 'Sarah Whitfield', email: 'sarah@demo.com', role: 'Manager', market: null };

export function makeSummary(over: Partial<ClaimSummary> = {}): ClaimSummary {
  return {
    id: 101, claimNumber: 'CLM-2026-000101', type: 'Motor', market: 'SG', status: 'Submitted',
    policyNumber: 'MTR-SG-482913', claimedAmount: 4200, assessedAmount: null, approvedAmount: null,
    claimantId: 1, claimantName: 'Aisha Rahman', assignedOfficerId: null, assignedOfficerName: null,
    incidentDate: '2026-10-01T00:00:00Z', createdAt: '2026-10-02T08:00:00Z', updatedAt: '2026-10-02T08:00:00Z',
    ...over,
  };
}

export function makeDetail(over: Partial<ClaimDetail> = {}, summary: Partial<ClaimSummary> = {}): ClaimDetail {
  return {
    summary: makeSummary(summary),
    location: 'PIE, Singapore',
    description: 'Rear-ended at a traffic light; bumper damaged.',
    decisionReason: null,
    version: 1,
    history: [
      { fromStatus: null, toStatus: 'Submitted', action: 'Claim submitted', comment: null, actorName: 'Aisha Rahman', at: '2026-10-02T08:00:00Z' },
    ],
    infoRequests: [],
    notes: [],
    availableActions: [],
    ...over,
  };
}

export function paged<T>(items: T[], total = items.length, page = 1, pageSize = 10): Paged<T> {
  return { items, total, page, pageSize };
}

export function makeWorkload(over: Partial<Workload> = {}): Workload {
  return {
    openClaims: 4, awaitingMyAction: 2, awaitingClaimant: 1, myExposure: 62000, decidedLast30Days: 3,
    avgDaysToDecision: 5.5, queueSize: 3, oldestQueueDays: 6.2,
    byStatus: { UnderReview: 2, InfoRequested: 1, Assessed: 1 },
    ...over,
  };
}

export function makeDashboard(over: Partial<Dashboard> = {}): Dashboard {
  return {
    totalClaims: 30, openClaims: 20, queueSize: 5, approvalRatePct: 72.5, avgDaysToDecision: 8.4,
    totalOutstanding: 312000, exposureUpdatedAt: '2026-10-28T08:00:00Z',
    exposureByMarket: [
      { key: 'SG', openClaims: 4, outstandingAmount: 50000 },
      { key: 'MY', openClaims: 6, outstandingAmount: 200000 },
      { key: 'HK', openClaims: 0, outstandingAmount: 0 },
    ],
    exposureByType: [
      { key: 'Motor', openClaims: 12, outstandingAmount: 100000 },
      { key: 'Property', openClaims: 8, outstandingAmount: 300000 },
    ],
    byStatus: { Submitted: 5, UnderReview: 6, Settled: 4 },
    team: [
      { officerId: 5, name: 'Priya Sharma', openClaims: 7, exposure: 90000, decidedLast30Days: 3, avgDaysToDecision: 4.2 },
      { officerId: 6, name: 'Marcus Tan', openClaims: 2, exposure: 12000, decidedLast30Days: 5, avgDaysToDecision: 3.1 },
    ],
    highValueOpen: [
      makeSummary({ id: 7, claimNumber: 'CLM-2026-000007', claimedAmount: 90000, assessedAmount: 85000, status: 'Assessed', market: 'MY', claimantName: 'Wei Lin Tan' }),
    ],
    ...over,
  };
}

export function makeNotification(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 1, claimId: 101, claimNumber: 'CLM-2026-000101', message: 'We received your claim.',
    isRead: false, createdAt: '2026-10-28T08:00:00Z', ...over,
  };
}

export const SYSTEM_INFO: SystemInfo = { messagingProvider: 'In-Memory', topic: 'claims.events', pendingOutbox: 0, approvalThreshold: 50000 };

const API_METHODS = [
  'users', 'login', 'systemInfo', 'officers', 'listClaims', 'myClaims', 'claim', 'createClaim', 'assign',
  'requestInfo', 'provideInfo', 'uploadDocument', 'downloadDocument', 'assess', 'approve', 'reject', 'reopen', 'settle', 'withdraw', 'addNote',
  'notifications', 'markRead', 'markAllRead', 'workload', 'dashboard',
] as const;

export type ApiSpy = jasmine.SpyObj<ApiService>;

/** An ApiService whose every method returns an empty-ish observable until a spec overrides it. */
export function createApiSpy(): ApiSpy {
  const spy = jasmine.createSpyObj<ApiService>('ApiService', [...API_METHODS]);
  spy.users.and.returnValue(of([CLAIMANT, OFFICER, MANAGER]));
  spy.officers.and.returnValue(of([OFFICER, OFFICER_2]));
  spy.systemInfo.and.returnValue(of(SYSTEM_INFO));
  spy.notifications.and.returnValue(of([]));
  spy.listClaims.and.returnValue(of(paged<ClaimSummary>([])));
  spy.myClaims.and.returnValue(of(paged<ClaimSummary>([])));
  return spy;
}

export function provideApiSpy(spy: ApiSpy): Provider {
  return { provide: ApiService, useValue: spy };
}
