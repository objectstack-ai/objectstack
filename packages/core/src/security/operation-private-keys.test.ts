// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7284] Behaviour of the `__` operation-private-key convention at its home.
 *
 * The three packages that hand-copied this helper each covered it only through
 * their own gates — `sys_comment`'s access hooks, `sys_attachment`'s, the report
 * runner's — so the RULE itself was never asserted anywhere, only its effect on
 * three particular call sites. These are the assertions that belong to the rule.
 */

import { describe, it, expect } from 'vitest';

import {
  OPERATION_PRIVATE_KEY_PREFIX,
  withoutOperationPrivateKeys,
} from './operation-private-keys.js';

describe('withoutOperationPrivateKeys', () => {
  it('drops every key carrying the operation-private prefix', () => {
    const out = withoutOperationPrivateKeys({
      userId: 'u1',
      tenantId: 't1',
      __readScope: 'org',
      __writeScope: 'org',
      __delegatorReadScope: 'unit',
      __delegatorWriteScope: 'unit',
      __expandRead: true,
      __referentialFieldClear: true,
    });

    expect(out).toEqual({ userId: 'u1', tenantId: 't1' });
  });

  it('preserves every principal field — it strips, it does not project', () => {
    // The defect half of the five-field projections this helper replaced
    // (#7141 / #7145 / #7204): these decide the verdict the gate then trusts.
    const envelope = {
      userId: 'u1',
      tenantId: 't1',
      positions: ['p1'],
      permissions: ['read'],
      isSystem: false,
      onBehalfOf: { userId: 'agent-owner' },
      principalKind: 'agent',
      systemPermissions: ['x'],
      accessible_org_ids: ['o1', 'o2'],
      org_user_ids: ['u1'],
      posture: 'group',
      audience: 'api',
      rlsMembership: { unit: 'u' },
      timezone: 'Asia/Shanghai',
      __readScope: 'org',
    };

    const out = withoutOperationPrivateKeys(envelope) as Record<string, unknown>;

    const { __readScope: _dropped, ...everythingElse } = envelope;
    expect(out).toEqual(everythingElse);
  });

  it('returns a FRESH object even when there is nothing to strip', () => {
    // ⛔ The copy is the point, not an optimisation to skip on a clean envelope:
    // a callee that stamps its own `__writeScope` onto what it receives must not
    // be able to write back into the caller's operation context.
    const envelope = { userId: 'u1' };
    const out = withoutOperationPrivateKeys(envelope) as Record<string, unknown>;

    expect(out).not.toBe(envelope);
    expect(out).toEqual(envelope);

    out.__writeScope = 'org';
    expect(envelope).toEqual({ userId: 'u1' });
  });

  it('is a SHALLOW copy — nested values are forwarded by reference', () => {
    // Stated so the boundary is a decision rather than an accident: the hazard
    // this closes is a callee stamping TOP-LEVEL keys, which is all the
    // middleware ever does.
    const nested = { userId: 'agent-owner' };
    const out = withoutOperationPrivateKeys({ onBehalfOf: nested }) as Record<string, unknown>;

    expect(out.onBehalfOf).toBe(nested);
  });

  it('drops a key the middleware has not stamped yet, by prefix alone', () => {
    // The whole reason the rule is a prefix and not a name list: a seventh
    // operation-private key must be dropped by every consumer on the day it is
    // stamped, with no consumer edited.
    const out = withoutOperationPrivateKeys({ userId: 'u1', __someFutureMarker: true });

    expect(out).toEqual({ userId: 'u1' });
  });

  it('leaves keys that merely CONTAIN the prefix, and single-underscore keys', () => {
    const out = withoutOperationPrivateKeys({
      _private: 1,
      'field__with__dunders': 2,
      org_user_ids: ['o1'],
    });

    expect(out).toEqual({ _private: 1, 'field__with__dunders': 2, org_user_ids: ['o1'] });
  });

  it('tolerates an empty envelope', () => {
    expect(withoutOperationPrivateKeys({})).toEqual({});
  });

  it('pins the prefix itself — consumers and the middleware agree on `__`', () => {
    expect(OPERATION_PRIVATE_KEY_PREFIX).toBe('__');
  });
});
