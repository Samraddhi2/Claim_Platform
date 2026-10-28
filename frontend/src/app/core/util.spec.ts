import {
  ALL_STATUSES, MARKETS, MARKET_NAME, STATUS_LABEL, avatarColor, initials, parseUtc, timeAgo,
} from './util';

describe('util', () => {
  describe('lookup tables (contract with the backend enums)', () => {
    it('has a label for each of the 8 backend claim statuses', () => {
      expect(Object.keys(STATUS_LABEL).sort()).toEqual(
        ['Approved', 'Assessed', 'InfoRequested', 'Rejected', 'Settled', 'Submitted', 'UnderReview', 'Withdrawn']);
    });

    it('lists statuses in lifecycle order', () => {
      expect(ALL_STATUSES).toEqual(
        ['Submitted', 'UnderReview', 'InfoRequested', 'Assessed', 'Approved', 'Rejected', 'Settled', 'Withdrawn']);
    });

    it('uses human readable labels', () => {
      expect(STATUS_LABEL.UnderReview).toBe('Under review');
      expect(STATUS_LABEL.InfoRequested).toBe('Info requested');
    });

    it('covers the 6 APAC markets', () => {
      expect(MARKETS).toEqual(['SG', 'HK', 'TH', 'MY', 'ID', 'AU']);
      expect(MARKET_NAME.SG).toBe('Singapore');
      expect(MARKET_NAME.AU).toBe('Australia');
    });
  });

  describe('parseUtc', () => {
    it('keeps an explicit Z', () => {
      expect(parseUtc('2026-03-07T10:00:00Z').toISOString()).toBe('2026-03-07T10:00:00.000Z');
    });

    it('honours explicit offsets', () => {
      expect(parseUtc('2026-03-07T10:00:00+05:30').toISOString()).toBe('2026-03-07T04:30:00.000Z');
      expect(parseUtc('2026-03-07T10:00:00-0800').toISOString()).toBe('2026-03-07T18:00:00.000Z');
    });

    it('treats a zone-less timestamp as UTC, not local time', () => {
      expect(parseUtc('2026-03-07T10:00:00').toISOString()).toBe('2026-03-07T10:00:00.000Z');
    });
  });

  describe('timeAgo', () => {
    const NOW = new Date('2026-10-28T12:00:00Z');
    const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

    beforeEach(() => { jasmine.clock().install(); jasmine.clock().mockDate(NOW); });
    afterEach(() => jasmine.clock().uninstall());

    it('returns an empty string for missing values', () => {
      expect(timeAgo(null)).toBe('');
      expect(timeAgo(undefined)).toBe('');
      expect(timeAgo('')).toBe('');
    });

    it('says "just now" under 45 seconds', () => {
      expect(timeAgo(ago(0))).toBe('just now');
      expect(timeAgo(ago(44))).toBe('just now');
    });

    it('switches to minutes at 45 seconds', () => {
      expect(timeAgo(ago(45))).toBe('1 min ago');
      expect(timeAgo(ago(30 * 60))).toBe('30 min ago');
    });

    it('rolls minutes over into hours', () => {
      expect(timeAgo(ago(59.5 * 60))).toBe('1 h ago');
      expect(timeAgo(ago(5 * 3600))).toBe('5 h ago');
      expect(timeAgo(ago(23 * 3600))).toBe('23 h ago');
    });

    it('says "yesterday" for roughly one day', () => {
      expect(timeAgo(ago(24 * 3600))).toBe('yesterday');
      expect(timeAgo(ago(35 * 3600))).toBe('yesterday');
    });

    it('counts days beyond that', () => {
      expect(timeAgo(ago(36 * 3600))).toBe('2 days ago');
      expect(timeAgo(ago(5 * 24 * 3600))).toBe('5 days ago');
    });

    it('accepts server timestamps without a zone designator', () => {
      expect(timeAgo('2026-10-28T11:00:00')).toBe('1 h ago');
    });
  });

  describe('initials', () => {
    it('takes the first letters of the first two words, upper-cased', () => {
      expect(initials('Aisha Rahman')).toBe('AR');
      expect(initials('wei lin tan')).toBe('WL');
    });

    it('handles single names, blanks and extra whitespace', () => {
      expect(initials('Priya')).toBe('P');
      expect(initials('')).toBe('');
      expect(initials('   ')).toBe('');
      expect(initials('  Sarah    Whitfield ')).toBe('SW');
    });
  });

  describe('avatarColor', () => {
    const PALETTE = ['#243bff', '#0b8f6b', '#6d3fd1', '#d9741a', '#0f8ba8', '#c2377b', '#4d6a2f'];

    it('is deterministic for the same seed', () => {
      expect(avatarColor('Aisha Rahman')).toBe(avatarColor('Aisha Rahman'));
    });

    it('always returns a colour from the palette', () => {
      for (const seed of ['a', 'Priya Sharma', 'x'.repeat(200), 42, '']) {
        expect(PALETTE).toContain(avatarColor(seed));
      }
    });

    it('treats numeric and string seeds alike', () => {
      expect(avatarColor(7)).toBe(avatarColor('7'));
    });

    it('spreads different names over several colours', () => {
      const colours = new Set(['Aisha', 'Wei Lin', 'Somchai', 'Daniel', 'Priya', 'Marcus', 'Linh', 'Sarah'].map(avatarColor));
      expect(colours.size).toBeGreaterThan(2);
    });
  });
});
