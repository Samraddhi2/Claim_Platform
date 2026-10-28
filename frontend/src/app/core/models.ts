export type Role = 'Claimant' | 'Officer' | 'Manager';
export type ClaimType = 'Motor' | 'Property';
export type Market = 'SG' | 'HK' | 'TH' | 'MY' | 'ID' | 'AU';
export type ClaimStatus =
  | 'Submitted' | 'UnderReview' | 'InfoRequested' | 'Assessed'
  | 'Approved' | 'Rejected' | 'Settled' | 'Withdrawn';

export interface User { id: number; name: string; email: string; role: Role; market: Market | null; }

export interface ClaimSummary {
  id: number; claimNumber: string; type: ClaimType; market: Market; status: ClaimStatus; policyNumber: string;
  claimedAmount: number; assessedAmount: number | null; approvedAmount: number | null;
  claimantId: number; claimantName: string; assignedOfficerId: number | null; assignedOfficerName: string | null;
  incidentDate: string; createdAt: string; updatedAt: string;
}
export interface HistoryItem { fromStatus: ClaimStatus | null; toStatus: ClaimStatus; action: string; comment: string | null; actorName: string; at: string; }
export interface InfoRequestItem { id: number; message: string; requestedByName: string; requestedAt: string; response: string | null; respondedAt: string | null; }
export interface NoteItem { id: number; text: string; authorName: string; at: string; }
export interface ClaimDocument { id: number; fileName: string; contentType: string; sizeBytes: number; uploadedByName: string; uploadedAt: string; }
export interface ClaimDetail {
  summary: ClaimSummary; location: string; description: string; decisionReason: string | null; version: number;
  history: HistoryItem[]; infoRequests: InfoRequestItem[]; notes: NoteItem[]; availableActions: string[]; documents: ClaimDocument[];
}
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; }

export interface ClaimFilter {
  status?: ClaimStatus | ''; type?: ClaimType | ''; market?: Market | '';
  assignedTo?: number | null; unassigned?: boolean; openOnly?: boolean;
  search?: string; sort?: 'newest' | 'oldest'; page?: number; pageSize?: number;
}

export interface CreateClaimBody {
  type: ClaimType; market: Market; policyNumber: string; incidentDate: string;
  location: string; description: string; claimedAmount: number;
}

export interface NotificationItem { id: number; claimId: number | null; claimNumber: string; message: string; isRead: boolean; createdAt: string; }

export interface Workload {
  openClaims: number; awaitingMyAction: number; awaitingClaimant: number; myExposure: number;
  decidedLast30Days: number; avgDaysToDecision: number; queueSize: number; oldestQueueDays: number | null;
  byStatus: Record<string, number>;
}
export interface ExposureRow { key: string; openClaims: number; outstandingAmount: number; }
export interface TeamMember { officerId: number; name: string; openClaims: number; exposure: number; decidedLast30Days: number; avgDaysToDecision: number; }
export interface Dashboard {
  totalClaims: number; openClaims: number; queueSize: number; approvalRatePct: number; avgDaysToDecision: number;
  totalOutstanding: number; exposureUpdatedAt: string | null;
  exposureByMarket: ExposureRow[]; exposureByType: ExposureRow[]; byStatus: Record<string, number>;
  team: TeamMember[]; highValueOpen: ClaimSummary[];
}
export interface SystemInfo { messagingProvider: string; topic: string; pendingOutbox: number; approvalThreshold: number; }
