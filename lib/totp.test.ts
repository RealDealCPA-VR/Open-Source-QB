import { describe, it, expect } from 'vitest';
import { generateSecret, generateTotp, verifyTotp, otpauthUrl } from './totp';

describe('TOTP', () => {
  it('generates a base32 secret', () => {
    const s = generateSecret();
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(/^[A-Z2-7]+$/.test(s)).toBe(true);
  });

  it('produces a stable 6-digit code for a fixed time and verifies it', () => {
    const s = generateSecret();
    const t = 1_700_000_000_000;
    const code = generateTotp(s, t);
    expect(/^\d{6}$/.test(code)).toBe(true);
    expect(verifyTotp(s, code, t)).toBe(true);
  });

  it('accepts codes within the drift window and rejects outside', () => {
    const s = generateSecret();
    const t = 1_700_000_000_000;
    const prev = generateTotp(s, t - 30_000);
    expect(verifyTotp(s, prev, t, 1)).toBe(true); // within window
    const far = generateTotp(s, t - 5 * 30_000);
    expect(verifyTotp(s, far, t, 1)).toBe(false); // outside window
  });

  it('rejects malformed tokens', () => {
    const s = generateSecret();
    expect(verifyTotp(s, 'abc', Date.now())).toBe(false);
    expect(verifyTotp(s, '12345', Date.now())).toBe(false);
  });

  it('builds an otpauth url', () => {
    expect(otpauthUrl('ABC', 'user@x.com')).toContain('otpauth://totp/');
  });
});
