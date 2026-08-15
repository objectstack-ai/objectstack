// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';

// ─── [#8715] `ApiKeySchema` is RETIRED ──────────────────────────────────────
//
// ADR-0049 enforce-or-remove; maintainer ruling 2026-08-15 (disposition B:
// delete). `identity/identity.zod.ts` no longer declares `ApiKeySchema` /
// `ApiKey` / `ApiKeyParsed` — 1 emitted def (`identity/ApiKey`), 3 exported
// names, 19 authorable-surface keys, the reference page's `ApiKey` section
// with them.
//
// The measurement that decided it (issue #8715, dev report 2026-08-14;
// re-verified at this retirement's base commit, 7901b2d):
//
//   1. STATIC — zero imports of any of the three names outside
//      `packages/spec` repo-wide; in-package, only its own unit test. The
//      export snapshots, the generated reference page and one prose mention
//      in `cloud/developer-portal.zod.ts` (corrected in the same PR) were the
//      only other occurrences.
//   2. DOORS — no metadata-type binding, no stack collection, no object/field
//      embedding: no authored document could ever carry the shape.
//   3. The fiction face: the schema documented better-auth's `apiKey` PLUGIN
//      shape, a plugin this platform does not load — `start`/`lastRefetchAt`
//      (no such columns), `enabled` (the real column is `revoked`, opposite
//      polarity), four per-key rate-limit keys (no such surface exists
//      anywhere), `permissions`/`metadata` (no columns), camelCase
//      `organizationId` next to the real snake_case `active_organization_id`.
//      One table, two declarations, and the published one was fiction —
//      AGENTS.md PD #10.
//
// ## Why route 3, and why there is nothing to tombstone
//
// With no carrier key there is no shape on which a `retiredKey()` tombstone
// could sit, and no authored document for an ADR-0087 D2 conversion to
// rewrite — a prescription nobody can receive is noise. The declared record
// is the D3 `SemanticMigration` `identity-api-key-schema-retired` plus the
// `RETIRED_DEFS_BY_MAJOR[18]` entry `identity/ApiKey` the manifest-deletion
// gate reads.
//
// The single declaration of the `sys_api_key` table is the ObjectSchema in
// `@objectstack/platform-objects` (`identity/sys-api-key.object.ts`) — its
// column pin lives next to that object
// (`sys-api-key-single-declaration.test.ts`), because spec cannot import its
// own consumer.
//
// Form follows #4988 / #5055 / #8075: resolved symbol identity over every
// public entry via the build-time `export-origins/` artifact.
describe('[#8715] identity/ ApiKeySchema retirement', () => {
  /** The 3 names the retired def exported (1 schema const + 2 types). */
  const RETIRED_NAMES = ['ApiKeySchema', 'ApiKey', 'ApiKeyParsed'] as const;

  /**
   * Names that must SURVIVE on `./identity`. The ruling accepts the sibling
   * asymmetry deliberately (User/Account/VerificationToken and the
   * organization module stay) — exactly what a too-wide "tidy the identity
   * module" sweep would take.
   */
  const MUST_SURVIVE_IDENTITY = [
    'UserSchema',
    'AccountSchema',
    'VerificationTokenSchema',
    'OrganizationSchema',
    'MemberSchema',
  ] as const;

  it('every retired name has ZERO holders on any public entry; the survivors still stand', () => {
    // Anti-vacuity: the baseline must cover the real surface.
    for (const needed of ['.', './identity', './api']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(exportNamesOf('./identity').length, './identity must export a non-trivial surface').toBeGreaterThan(20);

    // ── ABSENCE (every entry, not just ./identity) ────────────────────────
    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders after #8715`).toEqual([]);
    }

    // ── SURVIVAL ──────────────────────────────────────────────────────────
    const identityNames = exportNamesOf('./identity');
    for (const name of MUST_SURVIVE_IDENTITY) {
      expect(identityNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('runtime namespace agrees with the compiler view', async () => {
    const identity = await import('./index');
    expect('ApiKeySchema' in identity, 'identity must not export ApiKeySchema').toBe(false);
    for (const name of ['UserSchema', 'AccountSchema', 'VerificationTokenSchema']) {
      expect(name in identity, `${name} must SURVIVE at runtime`).toBe(true);
    }
  });

  it('the module file no longer spells any of the fictional keys', async () => {
    // The schema was deleted in place (the module survives — unlike #8075 this
    // is not a whole-file retirement), so the pin is textual: none of the
    // plugin-shaped keys the card called fictional may reappear in
    // identity.zod.ts as declarations. `lastRefetchAt` / `rateLimit*` /
    // `remaining` never had another legitimate use in this module.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'identity.zod.ts'),
      'utf-8',
    );
    for (const key of ['lastRefetchAt:', 'rateLimitEnabled:', 'rateLimitTimeWindow:', 'rateLimitMax:', 'remaining:']) {
      expect(src.includes(key), `identity.zod.ts must not re-declare \`${key.slice(0, -1)}\``).toBe(false);
    }
    // Anti-vacuity: the explanatory block this retirement left behind is
    // present, so "false" above cannot mean "wrong file".
    expect(src).toContain('are NOT declared here (#8715');
  });
});
