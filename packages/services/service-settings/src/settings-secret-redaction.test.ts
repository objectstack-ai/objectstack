// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7572] `SETTINGS_SECRET_MASK` is the ADR-0100 credential read mask under this
 * package's published name — the SAME declaration, not a copy of it.
 *
 * #7522 shipped it as a second byte-identical literal, bound to objectql's
 * `SECRET_MASK` by convention alone. Nothing compared them, and nothing could
 * have: each package asserted against its own constant, so an edit to either
 * literal would desynchronise the mask a console sees on the settings REST read
 * from the mask it sees on an encrypted FIELD read, with both suites still green.
 *
 * The hoist into `@objectstack/spec` removed the second declaration. This pin
 * holds what the hoist alone cannot: that this export still resolves to it. A
 * re-introduced local literal — the natural next edit for anyone who reads the
 * framework-agnostic note in the module header and stops there — passes every
 * behaviour test in `settings-routes.test.ts` (those compare a route response
 * against this very constant, so they move with it) and fails HERE the moment
 * its bytes differ.
 *
 * The literal is restated below for the same reason the spec-side pin restates
 * it: a check that imported the constant to describe the constant would be true
 * by construction. The bytes and the grep-findable spelling are pinned at the
 * declaration itself, in `spec/src/data/secret-mask.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import { SECRET_MASK } from '@objectstack/spec/data';

import { SETTINGS_SECRET_MASK, dropEchoedSecretMasks, redactSecretValues } from './settings-secret-redaction.js';

describe('SETTINGS_SECRET_MASK is the shared ADR-0100 mask (#7572)', () => {
  it('is the spec declaration, not a copy', () => {
    expect(SETTINGS_SECRET_MASK).toBe(SECRET_MASK);
  });

  it('is the eight-bullet mask', () => {
    expect(SETTINGS_SECRET_MASK).toBe('••••••••');
  });

  it('serves the shared mask on read — a client comparing against the FIELD mask recognises it', () => {
    const out = redactSecretValues(
      { smtp_password: { value: 'hunter2', source: 'global', locked: false } },
      new Set(['smtp_password']),
    );
    expect(out.smtp_password.value).toBe(SECRET_MASK);
  });

  it('reads an echo of the shared mask as "unchanged" — the write half of the same contract', () => {
    // What a console echoes back is whatever it was SERVED, which is the shared
    // constant; the drop has to key off that same string or the echo becomes a
    // real write of eight bullets over a live secret.
    const patch = dropEchoedSecretMasks({ smtp_password: SECRET_MASK }, new Set(['smtp_password']));
    expect(patch).toEqual({});
  });
});
