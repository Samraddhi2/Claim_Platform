import { ClaimStatus, Market } from './models';

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  Submitted: 'Submitted',
  UnderReview: 'Under review',
  InfoRequested: 'Info requested',
  Assessed: 'Assessed',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Settled: 'Settled',
  Withdrawn: 'Withdrawn',
};

export const ALL_STATUSES = Object.keys(STATUS_LABEL) as ClaimStatus[];

export const MARKET_NAME: Record<Market, string> = {
  SG: 'Singapore', HK: 'Hong Kong', TH: 'Thailand', MY: 'Malaysia', ID: 'Indonesia', AU: 'Australia',
};
export const MARKETS = Object.keys(MARKET_NAME) as Market[];

/** The server stores UTC. Anything without a zone designator is treated as UTC, not local time. */
export function parseUtc(value: string): Date {
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasZone ? value : value + 'Z');
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return '';
  const secs = Math.round((Date.now() - parseUtc(value).getTime()) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
}

const AVATAR_COLORS = ['#243bff', '#0b8f6b', '#6d3fd1', '#d9741a', '#0f8ba8', '#c2377b', '#4d6a2f'];
export function avatarColor(seed: string | number): string {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
