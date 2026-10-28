import { Pipe, PipeTransform } from '@angular/core';
import { ClaimStatus } from './models';
import { STATUS_LABEL, parseUtc, timeAgo } from './util';

@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(v: number | null | undefined, compact = false): string {
    if (v === null || v === undefined) return '—';
    if (compact && Math.abs(v) >= 1000) {
      return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
    }
    return '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v);
  }
}

@Pipe({ name: 'ago', standalone: true })
export class AgoPipe implements PipeTransform {
  transform(v: string | null | undefined): string { return timeAgo(v); }
}

@Pipe({ name: 'stamp', standalone: true })
export class StampPipe implements PipeTransform {
  transform(v: string | null | undefined): string {
    if (!v) return '';
    return parseUtc(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}

/** Incident dates are calendar dates - slice the string so time zones can't shift the day. */
@Pipe({ name: 'dateOnly', standalone: true })
export class DateOnlyPipe implements PipeTransform {
  transform(v: string | null | undefined): string {
    if (!v) return '';
    const [y, m, d] = v.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}

@Pipe({ name: 'statusLabel', standalone: true })
export class StatusLabelPipe implements PipeTransform {
  transform(v: ClaimStatus | string): string { return STATUS_LABEL[v as ClaimStatus] ?? v; }
}
