/**
 * Tests for lib/shortcuts.ts (QuickMath parser, QB date keys, shortcut tables)
 * and lib/nav-actions.ts (command-palette quick actions).
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateAmountExpression,
  isMathExpression,
  formatAmountResult,
  adjustDateForKey,
  GLOBAL_SHORTCUTS,
  isEditableTarget,
} from './shortcuts';
import { navActions, filterNavActions } from './nav-actions';
import { paletteDestinations } from './nav';

describe('evaluateAmountExpression (safe QuickMath parser)', () => {
  it('evaluates the canonical example 12.5*3+10', () => {
    expect(evaluateAmountExpression('12.5*3+10')).toBe(47.5);
  });

  it('handles the four operators with precedence', () => {
    expect(evaluateAmountExpression('2+3*4')).toBe(14);
    expect(evaluateAmountExpression('10-4/2')).toBe(8);
    expect(evaluateAmountExpression('100/4')).toBe(25);
    expect(evaluateAmountExpression('7*8')).toBe(56);
  });

  it('handles parentheses and nesting', () => {
    expect(evaluateAmountExpression('(2+3)*4')).toBe(20);
    expect(evaluateAmountExpression('((1+2)*(3+4))')).toBe(21);
  });

  it('handles unary signs', () => {
    expect(evaluateAmountExpression('-5+2')).toBe(-3);
    expect(evaluateAmountExpression('5*-2')).toBe(-10);
    expect(evaluateAmountExpression('+3')).toBe(3);
  });

  it('parses plain numbers and decimals', () => {
    expect(evaluateAmountExpression('42')).toBe(42);
    expect(evaluateAmountExpression('0.5')).toBe(0.5);
    expect(evaluateAmountExpression('.75')).toBe(0.75);
  });

  it('ignores currency adornments ($, commas, whitespace)', () => {
    expect(evaluateAmountExpression('$1,200 + 300')).toBe(1500);
    expect(evaluateAmountExpression(' 12.5 * 3 + 10 ')).toBe(47.5);
  });

  it('rejects invalid expressions with null (never throws)', () => {
    expect(evaluateAmountExpression('')).toBeNull();
    expect(evaluateAmountExpression('abc')).toBeNull();
    expect(evaluateAmountExpression('12..5')).toBeNull();
    expect(evaluateAmountExpression('5+')).toBeNull();
    expect(evaluateAmountExpression('(2+3')).toBeNull();
    expect(evaluateAmountExpression('2+3)')).toBeNull();
    expect(evaluateAmountExpression('2**3')).toBeNull();
    expect(evaluateAmountExpression('.')).toBeNull();
  });

  it('rejects division by zero', () => {
    expect(evaluateAmountExpression('1/0')).toBeNull();
    expect(evaluateAmountExpression('10/(5-5)')).toBeNull();
  });

  it('cannot execute code (no eval): function-call-shaped input is invalid', () => {
    expect(evaluateAmountExpression('alert(1)')).toBeNull();
    expect(evaluateAmountExpression('process.exit(1)')).toBeNull();
    expect(evaluateAmountExpression('1;2')).toBeNull();
  });
});

describe('isMathExpression', () => {
  it('detects operators and parens', () => {
    expect(isMathExpression('12.5*3+10')).toBe(true);
    expect(isMathExpression('(2+3)')).toBe(true);
    expect(isMathExpression('10/2')).toBe(true);
    expect(isMathExpression('5+5')).toBe(true);
    expect(isMathExpression('100-1')).toBe(true);
  });

  it('passes plain numbers through untouched (including signed and formatted)', () => {
    expect(isMathExpression('42')).toBe(false);
    expect(isMathExpression('12.50')).toBe(false);
    expect(isMathExpression('-12.50')).toBe(false);
    expect(isMathExpression('$1,200.00')).toBe(false);
    expect(isMathExpression('')).toBe(false);
  });
});

describe('formatAmountResult', () => {
  it('rounds to cents', () => {
    expect(formatAmountResult(47.5)).toBe('47.5');
    expect(formatAmountResult(10 / 3)).toBe('3.33');
    expect(formatAmountResult(1.005)).toBe('1.01');
    expect(formatAmountResult(-2.555)).toBe('-2.55'); // EPSILON rounding, half-up toward +inf
  });
});

describe('adjustDateForKey (QB date-entry keys)', () => {
  const base = '2026-06-09';

  it('+ / = advance a day, - goes back a day', () => {
    expect(adjustDateForKey('+', base)).toBe('2026-06-10');
    expect(adjustDateForKey('=', base)).toBe('2026-06-10');
    expect(adjustDateForKey('-', base)).toBe('2026-06-08');
  });

  it('crosses month/year boundaries', () => {
    expect(adjustDateForKey('+', '2026-06-30')).toBe('2026-07-01');
    expect(adjustDateForKey('-', '2026-01-01')).toBe('2025-12-31');
  });

  it('m / h jump to first / last of month (case-insensitive)', () => {
    expect(adjustDateForKey('m', base)).toBe('2026-06-01');
    expect(adjustDateForKey('M', base)).toBe('2026-06-01');
    expect(adjustDateForKey('h', base)).toBe('2026-06-30');
    expect(adjustDateForKey('H', '2026-02-10')).toBe('2026-02-28');
  });

  it('y / r jump to first / last of year', () => {
    expect(adjustDateForKey('y', base)).toBe('2026-01-01');
    expect(adjustDateForKey('r', base)).toBe('2026-12-31');
  });

  it('t returns today', () => {
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`;
    expect(adjustDateForKey('t', base)).toBe(expected);
  });

  it('falls back to today when the field is empty or invalid', () => {
    const plus = adjustDateForKey('+', undefined);
    expect(plus).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(adjustDateForKey('m', 'not-a-date')).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('returns null for non-date keys so events pass through', () => {
    expect(adjustDateForKey('a', base)).toBeNull();
    expect(adjustDateForKey('5', base)).toBeNull();
    expect(adjustDateForKey('Tab', base)).toBeNull();
    expect(adjustDateForKey('ArrowUp', base)).toBeNull();
    expect(adjustDateForKey('Enter', base)).toBeNull();
  });
});

describe('GLOBAL_SHORTCUTS table', () => {
  it('includes the QB navigation shortcuts with the expected destinations', () => {
    const byKey = Object.fromEntries(
      GLOBAL_SHORTCUTS.filter((s) => s.ctrlKey).map((s) => [s.ctrlKey, s.href]),
    );
    expect(byKey).toEqual({
      i: '/invoices?new=1',
      e: '/expenses?new=1',
      r: '/registers',
      j: '/journal',
      d: '/deposits',
    });
  });

  it('navigation shortcuts point at real sidebar destinations', () => {
    const paths = new Set(paletteDestinations.map((d) => d.href));
    for (const s of GLOBAL_SHORTCUTS) {
      if (!s.href) continue;
      const pathOnly = s.href.split('?')[0];
      expect(paths.has(pathOnly), `${s.keys} -> ${pathOnly}`).toBe(true);
    }
  });

  it('ctrl keys are unique', () => {
    const keys = GLOBAL_SHORTCUTS.filter((s) => s.ctrlKey).map((s) => s.ctrlKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('isEditableTarget', () => {
  function fakeEl(tagName: string, contentEditable = false) {
    return { tagName, isContentEditable: contentEditable } as unknown as EventTarget;
  }

  it('flags form fields and contentEditable', () => {
    expect(isEditableTarget(fakeEl('INPUT'))).toBe(true);
    expect(isEditableTarget(fakeEl('TEXTAREA'))).toBe(true);
    expect(isEditableTarget(fakeEl('SELECT'))).toBe(true);
    expect(isEditableTarget(fakeEl('DIV', true))).toBe(true);
  });

  it('passes ordinary elements and null', () => {
    expect(isEditableTarget(fakeEl('DIV'))).toBe(false);
    expect(isEditableTarget(fakeEl('BUTTON'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('nav-actions (command palette quick actions)', () => {
  it('exposes the seven QB quick actions', () => {
    expect(navActions.map((a) => a.label)).toEqual([
      'New Invoice',
      'Write Check',
      'Receive Payment',
      'Make Deposit',
      'New Journal Entry',
      'Reconcile',
      'Run Payroll',
    ]);
  });

  it('every action lands on a real page (path exists in nav)', () => {
    const paths = new Set(paletteDestinations.map((d) => d.href));
    for (const a of navActions) {
      const pathOnly = a.href.split('?')[0];
      expect(paths.has(pathOnly), `${a.label} -> ${pathOnly}`).toBe(true);
    }
  });

  it('create actions carry ?new=1 so pages can open their create modal', () => {
    const creators = navActions.filter((a) => a.label !== 'Reconcile');
    for (const a of creators) {
      expect(a.href, a.label).toContain('?new=1');
    }
  });

  it('filterNavActions matches labels and keywords, returns all on empty query', () => {
    expect(filterNavActions('')).toHaveLength(navActions.length);
    expect(filterNavActions('invoice').map((a) => a.label)).toContain('New Invoice');
    expect(filterNavActions('check').map((a) => a.label)).toContain('Write Check');
    expect(filterNavActions('paycheck').map((a) => a.label)).toContain('Run Payroll');
    expect(filterNavActions('zzz-no-match')).toHaveLength(0);
  });
});
