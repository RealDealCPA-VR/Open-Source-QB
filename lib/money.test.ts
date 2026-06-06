import { describe, it, expect } from 'vitest';
import { Money, allocate, toAmountString, formatCurrency, formatAccounting } from './money';

describe('Money', () => {
  it('adds without float drift', () => {
    // classic 0.1 + 0.2 !== 0.3 float bug must not appear
    expect(Money.add('0.1', '0.2').toString()).toBe('0.3');
    expect(toAmountString(Money.add('0.1', '0.2'))).toBe('0.30');
  });

  it('handles a long sum exactly', () => {
    const cents = Array.from({ length: 100 }, () => '0.01');
    expect(toAmountString(Money.add(...cents))).toBe('1.00');
  });

  it('multiplies tax precisely and rounds to 2dp', () => {
    const tax = Money.mul('19.99', '0.0825'); // 1.649175
    expect(toAmountString(tax)).toBe('1.65');
  });

  it('comparisons work', () => {
    expect(Money.gt('100.01', '100.00')).toBe(true);
    expect(Money.equalWithinCent('100.001', '100.00')).toBe(true);
    expect(Money.isZero('0.00')).toBe(true);
  });

  it('treats null/empty as zero', () => {
    expect(toAmountString(null)).toBe('0.00');
    expect(toAmountString(undefined)).toBe('0.00');
    expect(toAmountString('')).toBe('0.00');
  });
});

describe('allocate', () => {
  it('splits a total without losing pennies (even split)', () => {
    const parts = allocate('100.00', [1, 1, 1]); // 33.34/33.33/33.33
    const sum = Money.add(...parts);
    expect(toAmountString(sum)).toBe('100.00');
    expect(parts.map((p) => p.toFixed(2)).sort()).toEqual(['33.33', '33.33', '33.34']);
  });

  it('splits proportionally by weights and reconciles to total', () => {
    const parts = allocate('10.00', [1, 2, 3]);
    expect(toAmountString(Money.add(...parts))).toBe('10.00');
  });
});

describe('formatting', () => {
  it('formats currency', () => {
    expect(formatCurrency('1234.5')).toBe('$1,234.50');
  });
  it('formats accounting negatives in parentheses', () => {
    expect(formatAccounting('-1234.56')).toBe('($1,234.56)');
    expect(formatAccounting('1234.56')).toBe('$1,234.56');
  });
});
