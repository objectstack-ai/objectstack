// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysApiKey } from './sys-api-key.object.js';
import * as specIdentity from '@objectstack/spec/identity';

// ─── [#8715] `sys_api_key` has exactly ONE declaration — this object ────────
//
// `@objectstack/spec/identity` used to publish an `ApiKeySchema` that
// documented better-auth's `apiKey` PLUGIN shape — a plugin this platform
// does not load — so the one table had two declarations and the published one
// was fiction (`enabled` vs the real `revoked`, four rate-limit keys with no
// implementation, `start`/`lastRefetchAt`/`permissions`/`metadata` columns
// that do not exist). ADR-0049 enforce-or-remove; maintainer ruling
// 2026-08-15, disposition B: the schema is DELETED and this ObjectSchema is
// the single declaration.
//
// The spec half of the pin (zero holders on every public entry) lives in
// `packages/spec/src/identity/api-key-retirement.test.ts`; this half pins the
// consumer side — spec's runtime namespace really lost the name — and the
// real column set, so a drifted re-declaration cannot come back quietly on
// either side.
describe('[#8715] sys_api_key single-declaration pin', () => {
  it('this object declares exactly the real column set', () => {
    const declared = Object.keys((SysApiKey as { fields: Record<string, unknown> }).fields).sort();
    expect(declared).toEqual([
      'active_organization_id',
      'created_at',
      'expires_at',
      'id',
      'key',
      'last_used_at',
      'name',
      'prefix',
      'revoked',
      'scopes',
      'updated_at',
      'user_id',
    ]);
    // The polarity the deleted schema inverted: the kill switch is `revoked`,
    // and there is no `enabled` column (asserted by the exact set above).
    expect(declared).toContain('revoked');
  });

  it('@objectstack/spec/identity no longer exports the fictional schema', () => {
    // Value export only, deliberately: `ApiKey` / `ApiKeyParsed` were
    // type-only and have no runtime footprint a namespace check could see —
    // asserting them here would be vacuous (green before the retirement too).
    // The types are covered by the spec-side pin, which reads the built
    // export-origins artifact and enumerates types as well as consts.
    expect('ApiKeySchema' in specIdentity, 'spec/identity must not export ApiKeySchema (#8715)').toBe(false);
    // Anti-vacuity: the namespace import is real and the survivors stand.
    expect('UserSchema' in specIdentity).toBe(true);
  });
});
