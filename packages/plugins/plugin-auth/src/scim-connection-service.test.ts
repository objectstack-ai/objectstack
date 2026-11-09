// Unit cases for the SCIM credential liveness check that both the bearer
// verifier and the group-mapping door read (#30959 review nit N3): no stored
// row reaches an expired or falsy-active credential through the suites today.
import { describe, it, expect } from 'vitest';
import { scimCredentialIsLive } from './scim-connection-service.js';

const NOW = Date.parse('2026-11-08T12:00:00.000Z');

describe('scimCredentialIsLive', () => {
  it.each([false, 0, null, undefined])('refuses a credential whose active is %s', (active) => {
    expect(scimCredentialIsLive({ active, expires_at: null }, NOW)).toBe(false);
  });
  it('accepts an active credential with no expiry', () => {
    expect(scimCredentialIsLive({ active: true, expires_at: null }, NOW)).toBe(true);
    expect(scimCredentialIsLive({ active: 1 }, NOW)).toBe(true);
  });
  it('refuses a credential that expired in the past', () => {
    expect(scimCredentialIsLive({ active: true, expires_at: '2026-11-08T11:59:59.999Z' }, NOW)).toBe(false);
  });
  it('refuses a credential that expires exactly now', () => {
    expect(scimCredentialIsLive({ active: true, expires_at: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });
  it('accepts a credential that expires in the future, and refuses an unreadable expiry', () => {
    expect(scimCredentialIsLive({ active: true, expires_at: '2026-11-08T12:00:00.001Z' }, NOW)).toBe(true);
    expect(scimCredentialIsLive({ active: true, expires_at: 'not a date' }, NOW)).toBe(false);
  });
});
