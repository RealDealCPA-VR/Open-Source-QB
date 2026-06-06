/**
 * Unit tests for statePayrollTax.ts — pure compute, no DB or filesystem required.
 *
 * Run with:  npx vitest run lib/services/statePayrollTax.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  computeStateWithholding,
  statePerPeriod,
  SUPPORTED_STATE_CODES,
  STATES,
} from './statePayrollTax';

// ---------------------------------------------------------------------------
// computeStateWithholding — annual
// ---------------------------------------------------------------------------

describe('computeStateWithholding', () => {
  // No-income-tax states (model: 'none') — all must return 0.00
  it('TX returns 0.00 (no state income tax)', () => {
    expect(computeStateWithholding({ state: 'TX', annualTaxable: 80000 })).toBe('0.00');
  });

  it('FL returns 0.00 (no state income tax)', () => {
    expect(computeStateWithholding({ state: 'FL', annualTaxable: 80000 })).toBe('0.00');
  });

  it('WA returns 0.00 (no state income tax)', () => {
    expect(computeStateWithholding({ state: 'WA', annualTaxable: 80000 })).toBe('0.00');
  });

  it('NV returns 0.00 (no state income tax)', () => {
    expect(computeStateWithholding({ state: 'NV', annualTaxable: 80000 })).toBe('0.00');
  });

  it('AK returns 0.00 (no state income tax)', () => {
    expect(computeStateWithholding({ state: 'AK', annualTaxable: 80000 })).toBe('0.00');
  });

  it('NH returns 0.00 (no wage withholding)', () => {
    expect(computeStateWithholding({ state: 'NH', annualTaxable: 80000 })).toBe('0.00');
  });

  it('SD returns 0.00 (no state income tax)', () => {
    expect(computeStateWithholding({ state: 'SD', annualTaxable: 80000 })).toBe('0.00');
  });

  it('TN returns 0.00 (no state income tax on wages)', () => {
    expect(computeStateWithholding({ state: 'TN', annualTaxable: 80000 })).toBe('0.00');
  });

  it('WY returns 0.00 (no state income tax)', () => {
    expect(computeStateWithholding({ state: 'WY', annualTaxable: 80000 })).toBe('0.00');
  });

  // Flat-rate states — exact computations
  it('IL flat 4.95%: $60,000 -> $2,970.00', () => {
    // 60000 * 0.0495 = 2970.00
    expect(computeStateWithholding({ state: 'IL', annualTaxable: 60000 })).toBe('2970.00');
  });

  it('PA flat 3.07%: $50,000 -> $1,535.00', () => {
    // 50000 * 0.0307 = 1535.00
    expect(computeStateWithholding({ state: 'PA', annualTaxable: 50000 })).toBe('1535.00');
  });

  it('CO flat 4.4%: $75,000 -> $3,300.00', () => {
    // 75000 * 0.044 = 3300.00
    expect(computeStateWithholding({ state: 'CO', annualTaxable: 75000 })).toBe('3300.00');
  });

  it('AZ flat 2.5%: $40,000 -> $1,000.00', () => {
    // 40000 * 0.025 = 1000.00
    expect(computeStateWithholding({ state: 'AZ', annualTaxable: 40000 })).toBe('1000.00');
  });

  it('GA flat 5.39%: $55,000 -> $2,964.50', () => {
    // 55000 * 0.0539 = 2964.50
    expect(computeStateWithholding({ state: 'GA', annualTaxable: 55000 })).toBe('2964.50');
  });

  it('NC flat 4.5%: $65,000 -> $2,925.00', () => {
    // 65000 * 0.045 = 2925.00
    expect(computeStateWithholding({ state: 'NC', annualTaxable: 65000 })).toBe('2925.00');
  });

  it('IN flat 3.05%: $50,000 -> $1,525.00', () => {
    // 50000 * 0.0305 = 1525.00
    expect(computeStateWithholding({ state: 'IN', annualTaxable: 50000 })).toBe('1525.00');
  });

  it('KY flat 4.0%: $60,000 -> $2,400.00', () => {
    // 60000 * 0.04 = 2400.00
    expect(computeStateWithholding({ state: 'KY', annualTaxable: 60000 })).toBe('2400.00');
  });

  it('MA flat 5.0%: $70,000 -> $3,500.00', () => {
    // 70000 * 0.05 = 3500.00
    expect(computeStateWithholding({ state: 'MA', annualTaxable: 70000 })).toBe('3500.00');
  });

  it('MI flat 4.25%: $80,000 -> $3,400.00', () => {
    // 80000 * 0.0425 = 3400.00
    expect(computeStateWithholding({ state: 'MI', annualTaxable: 80000 })).toBe('3400.00');
  });

  it('UT flat 4.55%: $60,000 -> $2,730.00', () => {
    // 60000 * 0.0455 = 2730.00
    expect(computeStateWithholding({ state: 'UT', annualTaxable: 60000 })).toBe('2730.00');
  });

  it('ID flat 5.695%: $50,000 -> $2,847.50', () => {
    // 50000 * 0.05695 = 2847.50
    expect(computeStateWithholding({ state: 'ID', annualTaxable: 50000 })).toBe('2847.50');
  });

  // Approximate-rate progressive states — just verify > 0
  it('CA (approx 6%) is > 0 for positive income', () => {
    const tax = computeStateWithholding({ state: 'CA', annualTaxable: 70000 });
    expect(parseFloat(tax)).toBeGreaterThan(0);
  });

  it('NY (approx 6%) is > 0 for positive income', () => {
    const tax = computeStateWithholding({ state: 'NY', annualTaxable: 70000 });
    expect(parseFloat(tax)).toBeGreaterThan(0);
  });

  it('OR (approx 8%) is > 0 for positive income', () => {
    const tax = computeStateWithholding({ state: 'OR', annualTaxable: 60000 });
    expect(parseFloat(tax)).toBeGreaterThan(0);
  });

  it('MN (approx 7%) is > 0 for positive income', () => {
    const tax = computeStateWithholding({ state: 'MN', annualTaxable: 65000 });
    expect(parseFloat(tax)).toBeGreaterThan(0);
  });

  it('DC (approx 8%) is > 0 for positive income', () => {
    const tax = computeStateWithholding({ state: 'DC', annualTaxable: 70000 });
    expect(parseFloat(tax)).toBeGreaterThan(0);
  });

  it('NJ (approx 6%) is > 0 for positive income', () => {
    const tax = computeStateWithholding({ state: 'NJ', annualTaxable: 70000 });
    expect(parseFloat(tax)).toBeGreaterThan(0);
  });

  // Edge cases
  it('returns 0.00 for zero taxable income', () => {
    expect(computeStateWithholding({ state: 'IL', annualTaxable: 0 })).toBe('0.00');
  });

  it('returns 0.00 for negative taxable income', () => {
    expect(computeStateWithholding({ state: 'PA', annualTaxable: -100 })).toBe('0.00');
  });

  it('throws for an unsupported state', () => {
    expect(() => computeStateWithholding({ state: 'XX', annualTaxable: 50000 })).toThrow();
  });

  it('is case-insensitive for state code', () => {
    expect(computeStateWithholding({ state: 'il', annualTaxable: 60000 })).toBe('2970.00');
  });
});

// ---------------------------------------------------------------------------
// statePerPeriod — per-period helper
// ---------------------------------------------------------------------------

describe('statePerPeriod', () => {
  it('TX biweekly: stateTax = 0.00', () => {
    const r = statePerPeriod({ grossPerPeriod: 3000, periodsPerYear: 26, state: 'TX' });
    expect(r.stateTax).toBe('0.00');
    expect(r.annualStateTax).toBe('0.00');
  });

  it('FL monthly: stateTax = 0.00', () => {
    const r = statePerPeriod({ grossPerPeriod: 5000, periodsPerYear: 12, state: 'FL' });
    expect(r.stateTax).toBe('0.00');
  });

  it('WA weekly: stateTax = 0.00', () => {
    const r = statePerPeriod({ grossPerPeriod: 1000, periodsPerYear: 52, state: 'WA' });
    expect(r.stateTax).toBe('0.00');
  });

  it('NV semimonthly: stateTax = 0.00', () => {
    const r = statePerPeriod({ grossPerPeriod: 2000, periodsPerYear: 24, state: 'NV' });
    expect(r.stateTax).toBe('0.00');
  });

  it('AK biweekly: stateTax = 0.00', () => {
    const r = statePerPeriod({ grossPerPeriod: 2500, periodsPerYear: 26, state: 'AK' });
    expect(r.stateTax).toBe('0.00');
  });

  it('NH monthly: stateTax = 0.00', () => {
    const r = statePerPeriod({ grossPerPeriod: 4000, periodsPerYear: 12, state: 'NH' });
    expect(r.stateTax).toBe('0.00');
  });

  it('SD weekly: stateTax = 0.00', () => {
    const r = statePerPeriod({ grossPerPeriod: 1500, periodsPerYear: 52, state: 'SD' });
    expect(r.stateTax).toBe('0.00');
  });

  it('TN monthly: stateTax = 0.00', () => {
    const r = statePerPeriod({ grossPerPeriod: 3500, periodsPerYear: 12, state: 'TN' });
    expect(r.stateTax).toBe('0.00');
  });

  it('WY biweekly: stateTax = 0.00', () => {
    const r = statePerPeriod({ grossPerPeriod: 2800, periodsPerYear: 26, state: 'WY' });
    expect(r.stateTax).toBe('0.00');
  });

  it('IL biweekly gross $3,000: annualTaxable $78,000, annual tax $3,861.00, per-period $148.50', () => {
    // 3000 * 26 = 78000; 78000 * 0.0495 = 3861.00; 3861.00 / 26 = 148.50
    const r = statePerPeriod({ grossPerPeriod: 3000, periodsPerYear: 26, state: 'IL' });
    expect(r.annualStateTax).toBe('3861.00');
    expect(r.stateTax).toBe('148.50');
  });

  it('PA monthly gross $5,000: annualTaxable $60,000, annual tax $1,842.00, per-period $153.50', () => {
    // 5000 * 12 = 60000; 60000 * 0.0307 = 1842.00; 1842.00 / 12 = 153.50
    const r = statePerPeriod({ grossPerPeriod: 5000, periodsPerYear: 12, state: 'PA' });
    expect(r.annualStateTax).toBe('1842.00');
    expect(r.stateTax).toBe('153.50');
  });

  it('KY biweekly gross $3,000: annualTaxable $78,000, annual tax $3,120.00, per-period $120.00', () => {
    // 3000 * 26 = 78000; 78000 * 0.04 = 3120.00; 3120.00 / 26 = 120.00
    const r = statePerPeriod({ grossPerPeriod: 3000, periodsPerYear: 26, state: 'KY' });
    expect(r.annualStateTax).toBe('3120.00');
    expect(r.stateTax).toBe('120.00');
  });

  it('IN monthly gross $4,000: annualTaxable $48,000, annual tax $1,464.00, per-period $122.00', () => {
    // 4000 * 12 = 48000; 48000 * 0.0305 = 1464.00; 1464.00 / 12 = 122.00
    const r = statePerPeriod({ grossPerPeriod: 4000, periodsPerYear: 12, state: 'IN' });
    expect(r.annualStateTax).toBe('1464.00');
    expect(r.stateTax).toBe('122.00');
  });

  it('CA per-period result is > 0 for positive gross', () => {
    const r = statePerPeriod({ grossPerPeriod: 4000, periodsPerYear: 24, state: 'CA' });
    expect(parseFloat(r.stateTax)).toBeGreaterThan(0);
  });

  it('returns stateInfo with correct code', () => {
    const r = statePerPeriod({ grossPerPeriod: 2500, periodsPerYear: 26, state: 'CO' });
    expect(r.stateInfo.code).toBe('CO');
    expect(r.stateInfo.model).toBe('flat');
  });

  it('DC per-period result is > 0 for positive gross', () => {
    const r = statePerPeriod({ grossPerPeriod: 5000, periodsPerYear: 26, state: 'DC' });
    expect(parseFloat(r.stateTax)).toBeGreaterThan(0);
  });

  it('throws for invalid periodsPerYear', () => {
    expect(() => statePerPeriod({ grossPerPeriod: 2000, periodsPerYear: 0, state: 'IL' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// STATES table integrity — all 50 states + DC
// ---------------------------------------------------------------------------

/** All 50 US state codes plus DC. */
const ALL_US_STATE_CODES = [
  'AK', 'AL', 'AR', 'AZ',
  'CA', 'CO', 'CT',
  'DC', 'DE',
  'FL',
  'GA',
  'HI',
  'IA', 'ID', 'IL', 'IN',
  'KS', 'KY',
  'LA',
  'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT',
  'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY',
  'OH', 'OK', 'OR',
  'PA',
  'RI',
  'SC', 'SD',
  'TN', 'TX',
  'UT',
  'VA', 'VT',
  'WA', 'WI', 'WV', 'WY',
]; // 51 entries (50 states + DC)

describe('STATES table', () => {
  it('contains all 50 US states + DC (51 entries total)', () => {
    expect(STATES.length).toBe(51);
  });

  it('SUPPORTED_STATE_CODES has 51 entries (50 states + DC)', () => {
    expect(SUPPORTED_STATE_CODES.length).toBe(51);
  });

  it('SUPPORTED_STATE_CODES length matches STATES array length', () => {
    expect(SUPPORTED_STATE_CODES.length).toBe(STATES.length);
  });

  it('contains every US state code and DC', () => {
    const codes = new Set(SUPPORTED_STATE_CODES);
    for (const required of ALL_US_STATE_CODES) {
      expect(codes.has(required), `Missing state: ${required}`).toBe(true);
    }
  });

  it('contains all original 12 states from wave-17', () => {
    const codes = new Set(SUPPORTED_STATE_CODES);
    for (const required of ['CA', 'NY', 'TX', 'FL', 'IL', 'PA', 'CO', 'AZ', 'GA', 'NC', 'WA', 'NV']) {
      expect(codes.has(required), `Missing original state: ${required}`).toBe(true);
    }
  });

  it('no-income-tax states (AK, FL, NH, NV, SD, TN, TX, WA, WY) all have model "none" and rate 0', () => {
    const noTaxStates = ['AK', 'FL', 'NH', 'NV', 'SD', 'TN', 'TX', 'WA', 'WY'];
    const codeMap = new Map(STATES.map((s) => [s.code, s]));
    for (const code of noTaxStates) {
      const s = codeMap.get(code);
      expect(s, `${code} not found`).toBeDefined();
      expect(s!.model, `${code} model`).toBe('none');
      expect(s!.rate, `${code} rate`).toBe(0);
    }
  });

  it('all "none" model states have rate exactly 0', () => {
    for (const s of STATES) {
      if (s.model === 'none') {
        expect(s.rate, `${s.code} 'none' model should have rate 0`).toBe(0);
      }
    }
  });

  it('all "flat" model states have rate > 0', () => {
    for (const s of STATES) {
      if (s.model === 'flat') {
        expect(s.rate, `${s.code} 'flat' model should have rate > 0`).toBeGreaterThan(0);
      }
    }
  });

  it('all "flat" model states have rate < 0.15 (sanity: no obviously wrong values)', () => {
    for (const s of STATES) {
      if (s.model === 'flat') {
        expect(s.rate, `${s.code} rate suspiciously high`).toBeLessThan(0.15);
      }
    }
  });

  it('all states have non-empty name and code', () => {
    for (const s of STATES) {
      expect(s.code.length, `${s.code} code length`).toBeGreaterThanOrEqual(2);
      expect(s.name.length, `${s.code} name length`).toBeGreaterThan(0);
      expect(s.rateLabel.length, `${s.code} rateLabel length`).toBeGreaterThan(0);
    }
  });

  it('no duplicate state codes in STATES', () => {
    const codes = STATES.map((s) => s.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  // Spot-check a no-tax state returns 0 via computeStateWithholding
  it('AK computeStateWithholding returns 0.00', () => {
    expect(computeStateWithholding({ state: 'AK', annualTaxable: 100000 })).toBe('0.00');
  });

  it('WY computeStateWithholding returns 0.00', () => {
    expect(computeStateWithholding({ state: 'WY', annualTaxable: 100000 })).toBe('0.00');
  });

  // Spot-check a few flat rates
  it('MA flat 5%: $100,000 -> $5,000.00', () => {
    expect(computeStateWithholding({ state: 'MA', annualTaxable: 100000 })).toBe('5000.00');
  });

  it('MI flat 4.25%: $40,000 -> $1,700.00', () => {
    expect(computeStateWithholding({ state: 'MI', annualTaxable: 40000 })).toBe('1700.00');
  });

  it('UT flat 4.55%: $80,000 -> $3,640.00', () => {
    expect(computeStateWithholding({ state: 'UT', annualTaxable: 80000 })).toBe('3640.00');
  });
});
