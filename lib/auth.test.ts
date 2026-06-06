import { describe, it, expect, beforeAll } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  hashPassword,
  verifyPassword,
} from './auth';

beforeAll(() => {
  process.env.BKA_AUTH_SECRET = 'test-secret-fixed';
});

describe('auth sessions', () => {
  it('round-trips a valid session token', () => {
    const token = createSessionToken('user-123');
    expect(verifySessionToken(token)).toEqual({ userId: 'user-123' });
  });

  it('rejects a tampered token', () => {
    const token = createSessionToken('user-123');
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it('rejects garbage / empty', () => {
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken('not-a-token')).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
  });
});

describe('passwords', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('hunter2!');
    expect(hash).not.toBe('hunter2!');
    expect(await verifyPassword('hunter2!', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('never accepts the seed/demo passwordHash', async () => {
    expect(await verifyPassword('dev', 'dev')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});
