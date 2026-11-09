// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31829] The bound on `scim_refused` rows, and the event a refusal becomes,
 * on their own clock (`scim-refusal-audit.ts`). The door suite
 * (`scim-refusal-audit.test.ts`) pins the same bound through real requests.
 */

import { describe, it, expect } from 'vitest';
import {
  SCIM_REFUSAL_AUDIT_ROWS_PER_KEY,
  SCIM_REFUSAL_AUDIT_WINDOW_MS,
  ScimRefusalAuditBound,
  presentedCredentialOf,
  scimRefusalEventFor,
  scimResourceOf,
} from './scim-refusal-audit.js';

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

describe('[#31829] ScimRefusalAuditBound', () => {
  it('ships 20 rows per key per 10-minute window', () => {
    expect(SCIM_REFUSAL_AUDIT_ROWS_PER_KEY).toBe(20);
    expect(SCIM_REFUSAL_AUDIT_WINDOW_MS).toBe(10 * 60_000);
  });

  it('admits the cap, counts the rest, and hands the count to the next row of the key', () => {
    const c = clock();
    const bound = new ScimRefusalAuditBound({ rowsPerKey: 3, now: c.now });
    const answers = Array.from({ length: 8 }, () => bound.admit('connection:okta'));
    expect(answers.map((a) => a?.suppressed)).toEqual([0, 0, 0, undefined, undefined, undefined, undefined, undefined]);
    c.advance(SCIM_REFUSAL_AUDIT_WINDOW_MS);
    expect(bound.admit('connection:okta')).toEqual({ suppressed: 5 });
    expect(bound.admit('connection:okta')).toEqual({ suppressed: 0 });
  });

  it('keys are counted apart', () => {
    const bound = new ScimRefusalAuditBound({ rowsPerKey: 1, now: clock().now });
    expect(bound.admit('connection:a')).toEqual({ suppressed: 0 });
    expect(bound.admit('connection:a')).toBeUndefined();
    expect(bound.admit('address:203.0.113.7')).toEqual({ suppressed: 0 });
  });

  it('the cross-key cap drops, counts on the key, and warns once per window', () => {
    const c = clock();
    const lines: string[] = [];
    const bound = new ScimRefusalAuditBound({ rowCap: 2, now: c.now });
    expect(bound.admit('connection:a', (l) => lines.push(l))).toEqual({ suppressed: 0 });
    expect(bound.admit('connection:b', (l) => lines.push(l))).toEqual({ suppressed: 0 });
    expect(bound.admit('connection:c', (l) => lines.push(l))).toBeUndefined();
    expect(bound.admit('connection:c', (l) => lines.push(l))).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('scim_refused');
    c.advance(SCIM_REFUSAL_AUDIT_WINDOW_MS);
    expect(bound.admit('connection:c', (l) => lines.push(l))).toEqual({ suppressed: 2 });
  });

  it('the tracked keys stay under their cap', () => {
    const bound = new ScimRefusalAuditBound({ trackedKeyCap: 4, now: clock().now });
    for (let i = 0; i < 50; i++) bound.admit(`address:10.0.0.${i}`);
    expect(bound.trackedKeys).toBeLessThanOrEqual(4);
  });
});

describe('[#31829] the event a refusal becomes', () => {
  it('records the resource type and never the resource id after it', () => {
    expect(scimResourceOf('/scim/v2/Users/8c1f-alice')).toBe('Users');
    expect(scimResourceOf('/scim/v2/Groups')).toBe('Groups');
    expect(scimResourceOf('/scim/v2/alice@example.com')).toBe('?');
    expect(scimResourceOf(undefined)).toBe('?');
  });

  it('reads only the SHAPE of the credential', () => {
    expect(presentedCredentialOf('Bearer oss_scim_abcdef')).toBe('scim_bearer');
    expect(presentedCredentialOf('Bearer someone-elses-token')).toBe('other');
    expect(presentedCredentialOf('Basic dXNlcjpwYXNz')).toBe('other');
    expect(presentedCredentialOf(null)).toBe('none');
  });

  it('takes only bounded tokens from the refusal body — never its detail', () => {
    const event = scimRefusalEventFor(
      { endpointPath: '/scim/v2/Users', method: 'post', status: 409, connectionId: 'okta', clientAddress: '203.0.113.7' },
      { scimType: 'uniqueness', detail: 'SCIM User userName alice@example.com already exists', code: 'not a code' },
      2,
    );
    expect(event).toEqual({
      connectionId: 'okta',
      resource: 'Users',
      method: 'POST',
      status: 409,
      scimType: 'uniqueness',
      ipAddress: '203.0.113.7',
      suppressed: 2,
    });
  });

  it('an unverified request names the credential kind instead of a connection', () => {
    const event = scimRefusalEventFor(
      { endpointPath: '/scim/v2/Users', method: 'GET', status: 401, authorization: 'Bearer oss_scim_XYZ' },
      { code: 'UNAUTHORIZED', scimType: 'a value with spaces' },
    );
    expect(event).toEqual({ presentedCredential: 'scim_bearer', resource: 'Users', method: 'GET', status: 401, errorCode: 'UNAUTHORIZED' });
    expect(JSON.stringify(event)).not.toContain('XYZ');
  });
});
