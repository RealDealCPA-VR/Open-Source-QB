/**
 * Unit tests for numberToWords — the check amount-in-words helper.
 * These are pure synchronous tests with no DB dependency.
 */

import { describe, it, expect } from 'vitest';
import { numberToWords } from './check';

describe('numberToWords', () => {
  it('handles zero', () => {
    expect(numberToWords(0)).toBe('Zero and 00/100');
    expect(numberToWords('0')).toBe('Zero and 00/100');
    expect(numberToWords('0.00')).toBe('Zero and 00/100');
  });

  it('handles whole dollar amounts', () => {
    expect(numberToWords(1)).toBe('One and 00/100');
    expect(numberToWords(10)).toBe('Ten and 00/100');
    expect(numberToWords(20)).toBe('Twenty and 00/100');
    expect(numberToWords(100)).toBe('One Hundred and 00/100');
  });

  it('handles cents', () => {
    expect(numberToWords('0.01')).toBe('Zero and 01/100');
    expect(numberToWords('0.99')).toBe('Zero and 99/100');
    expect(numberToWords('1.50')).toBe('One and 50/100');
    expect(numberToWords('10.05')).toBe('Ten and 05/100');
  });

  it('handles two-digit amounts', () => {
    expect(numberToWords(15)).toBe('Fifteen and 00/100');
    expect(numberToWords(21)).toBe('Twenty-One and 00/100');
    expect(numberToWords(99)).toBe('Ninety-Nine and 00/100');
  });

  it('handles three-digit amounts', () => {
    expect(numberToWords(100)).toBe('One Hundred and 00/100');
    expect(numberToWords(115)).toBe('One Hundred Fifteen and 00/100');
    expect(numberToWords(999)).toBe('Nine Hundred Ninety-Nine and 00/100');
  });

  it('handles thousands', () => {
    expect(numberToWords(1000)).toBe('One Thousand and 00/100');
    expect(numberToWords(1001)).toBe('One Thousand One and 00/100');
    expect(numberToWords(1500)).toBe('One Thousand Five Hundred and 00/100');
    expect(numberToWords(12345)).toBe('Twelve Thousand Three Hundred Forty-Five and 00/100');
  });

  it('handles a typical check amount', () => {
    expect(numberToWords('1234.56')).toBe('One Thousand Two Hundred Thirty-Four and 56/100');
  });

  it('handles large amounts', () => {
    expect(numberToWords(1_000_000)).toBe('One Million and 00/100');
    expect(numberToWords(2_500_000)).toBe('Two Million Five Hundred Thousand and 00/100');
  });

  it('accepts string input', () => {
    expect(numberToWords('500.25')).toBe('Five Hundred and 25/100');
  });

  it('returns Zero for invalid input', () => {
    expect(numberToWords('abc')).toBe('Zero and 00/100');
    expect(numberToWords(NaN)).toBe('Zero and 00/100');
    expect(numberToWords(-1)).toBe('Zero and 00/100');
  });
});
