// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import stack from '../objectstack.config.js';

/**
 * #3420 — the official examples must boot with ZERO warnings so users don't get
 * trained to ignore them. A generic (non-`better-auth`) `password` field trips a
 * non-fatal `ObjectSchema.create()` warning at author time (ADR-0100: plaintext
 * at rest, masked on read); the documented way to affirm intent is
 * `ackPlaintextMasking: true`. This guard fails if a new or edited object
 * reintroduces an un-acknowledged generic password field — keeping the showcase
 * boot log clean without silencing the diagnostic for real authors.
 *
 * The other two boot-noise sources from #3420 are framework-level and guarded in
 * their own packages: the better-auth `oauthAuthServerConfig` false positive
 * (@objectstack/plugin-auth auth-manager.mcp-oauth.test.ts) and the registry
 * re-register lines (@objectstack/objectql registry-log-level.test.ts).
 */
describe('showcase boots without ADR-0100 password warnings (#3420)', () => {
  it('every generic password field affirms ackPlaintextMasking', () => {
    const offenders: string[] = [];
    for (const obj of (stack.objects ?? []) as any[]) {
      if (obj?.managedBy === 'better-auth') continue;
      for (const [fieldName, def] of Object.entries((obj?.fields ?? {}) as Record<string, any>)) {
        if (def?.type === 'password' && def?.ackPlaintextMasking !== true) {
          offenders.push(`${obj.name}.${fieldName}`);
        }
      }
    }
    expect(offenders, `un-acknowledged generic password field(s): ${offenders.join(', ')}`).toEqual([]);
  });
});
