import { AgoPipe, DateOnlyPipe, MoneyPipe, StampPipe, StatusLabelPipe } from './pipes';

describe('pipes', () => {
  describe('MoneyPipe', () => {
    const pipe = new MoneyPipe();

    it('shows an em dash for missing amounts', () => {
      expect(pipe.transform(null)).toBe('—');
      expect(pipe.transform(undefined)).toBe('—');
    });

    it('formats whole dollars with thousands separators', () => {
      expect(pipe.transform(0)).toBe('$0');
      expect(pipe.transform(999)).toBe('$999');
      expect(pipe.transform(1234567)).toBe('$1,234,567');
    });

    it('rounds away the cents', () => {
      expect(pipe.transform(1234.56)).toBe('$1,235');
    });

    it('does not compact amounts below 1,000', () => {
      expect(pipe.transform(999, true)).toBe('$999');
    });

    it('compacts larger amounts when asked', () => {
      expect(pipe.transform(1000, true)).toBe('$1K');
      expect(pipe.transform(1500, true)).toBe('$1.5K');
      expect(pipe.transform(85000, true)).toBe('$85K');
      expect(pipe.transform(2_500_000, true)).toBe('$2.5M');
    });
  });

  describe('AgoPipe', () => {
    it('delegates to timeAgo', () => {
      expect(new AgoPipe().transform(null)).toBe('');
      expect(new AgoPipe().transform(new Date().toISOString())).toBe('just now');
    });
  });

  describe('StampPipe', () => {
    const pipe = new StampPipe();

    it('returns empty for missing values', () => {
      expect(pipe.transform(null)).toBe('');
      expect(pipe.transform(undefined)).toBe('');
    });

    it('renders day, month and time', () => {
      expect(pipe.transform('2026-03-07T10:15:00Z')).toMatch(/^\d{2} Mar,? \d{2}:\d{2}$/);
    });
  });

  describe('DateOnlyPipe', () => {
    const pipe = new DateOnlyPipe();

    it('returns empty for missing values', () => {
      expect(pipe.transform(null)).toBe('');
      expect(pipe.transform('')).toBe('');
    });

    it('formats a calendar date', () => {
      expect(pipe.transform('2026-03-07')).toBe('07 Mar 2026');
      expect(pipe.transform('2026-03-07T00:00:00')).toBe('07 Mar 2026');
    });

    it('never shifts the day because of the time zone', () => {
      expect(pipe.transform('2026-03-07T23:59:59Z')).toBe('07 Mar 2026');
      expect(pipe.transform('2026-12-31T00:00:00Z')).toBe('31 Dec 2026');
    });
  });

  describe('StatusLabelPipe', () => {
    const pipe = new StatusLabelPipe();

    it('maps known statuses to labels', () => {
      expect(pipe.transform('UnderReview')).toBe('Under review');
      expect(pipe.transform('Settled')).toBe('Settled');
    });

    it('falls back to the raw value for unknown statuses', () => {
      expect(pipe.transform('SomethingNew')).toBe('SomethingNew');
    });
  });
});
