// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6842] Prose may name a shipped permission set for a shape only if the set
 * still HAS that shape.
 *
 * #5491 (PR #6684) removed `member_default`'s plain `'*'` wildcard grant. Three
 * separate pieces of prose named that set as THE worked example of a plain
 * wildcard, and all three went stale without a single gate moving — the
 * `describeHighPrivilegeBits` JSDoc in `packages/spec` (#6696, fixed by PR
 * #6846), and two `it()` titles in this package's `audience-anchors.test.ts`
 * (#6842, fixed alongside this file). Nothing was red at any point, because
 * nothing mechanically related "prose names set X as having shape Y" to what
 * `defaultPermissionSets` actually ships. The drift is silent by construction.
 *
 * This pin supplies that relation, in the #6628 idiom
 * (`packages/spec/src/identity/position-delegatable-enforcer.pin.test.ts`,
 * "the JSDoc may name a lint rule only if that rule exists"). `plugin-security`
 * is the only possible home: the authority is the `defaultPermissionSets` array
 * itself, which `packages/spec` cannot import without inverting the dependency
 * graph — which is exactly why #6696 deliberately shipped without a pin.
 *
 * HOW IT CLOSES. The authority is machine-read (the real array, the real
 * predicates — never a transcription). The prose is machine-read too: shipped
 * set names are exact snake_case tokens, so scanning for them needs no
 * heuristics. What is hand-written is only the CLASSIFICATION — for each set the
 * prose names, whether it is being invoked as a wildcard carrier, and whether it
 * is claimed to stay anchor-bindable. Both directions of that table are closed:
 *
 *   - upward   — every shipped set name occurring in a watched surface MUST have
 *                a row, so newly-named sets cannot slip in unclassified;
 *   - downward — every row MUST be named in some watched surface, so rows cannot
 *                outlive the prose that motivated them.
 *
 * Replay of the drift it exists for: before #5491 the prose named
 * `member_default` as the wildcard carrier, so its row read `wildcard: true`.
 * #5491 empties `objects['*']` and this file turns red, forcing that PR to flip
 * the row — and to confront the three sentences that flip invalidates.
 *
 * ⛔ LIMIT, stated so it is not mistaken for more. This pins the classification
 * against the array, not the prose against the classification: a row that
 * MISDESCRIBES what its sentences claim is green. That hole cannot be closed
 * without reading intent out of English, and the two negative mentions below
 * show why a proximity heuristic would be worse than nothing — the spec JSDoc
 * names `member_default` two lines from the word "wildcard" precisely to say it
 * has none. What the pin buys is that a #5491-class change can no longer pass
 * in silence: it must now write a false row on purpose.
 *
 * ⛔ Scope: the relation, not the wording. Rewording either surface freely is
 * fine — including dropping a set name entirely, which just retires its row.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import { describeAnchorForbiddenBits } from '@objectstack/spec/security';

import { defaultPermissionSets } from './objects/default-permission-sets.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/plugins/plugin-security/src → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');
const SPEC_HIGH_PRIVILEGE = join(REPO_ROOT, 'packages', 'spec', 'src', 'security', 'high-privilege.ts');
const ANCHOR_TESTS = join(HERE, 'audience-anchors.test.ts');

/**
 * What a watched surface claims about a set it names.
 *
 * `wildcard`  — the set carries a plain `objects['*']` grant.
 * `anchorSafe` — the set may still be bound to the `everyone` anchor.
 *
 * Both are checked against the shipped array and the shipped predicate. There
 * is deliberately NO "just mentioned, do not check" verdict: both watched
 * surfaces are wholly about wildcard and anchor shapes, so for any set they
 * name, both facts are worth holding — and an escape hatch is the one thing
 * that would let this table be silenced instead of maintained.
 */
type SetClaim = { wildcard: boolean; anchorSafe: boolean };

const CLAIMS: Record<string, SetClaim> = {
  // Named by both surfaces for what it does NOT have: no wildcard since #5491,
  // and no `allowExport`, which is why it keeps binding to `everyone`.
  member_default: { wildcard: false, anchorSafe: true },
  // Named by both surfaces as the shipped set that still carries a plain `'*'`.
  // Its wildcard is read-only, so it is anchor-safe for `everyone` (D9's
  // stricter guest tier refuses it — asserted in `audience-anchors.test.ts`).
  viewer_readonly: { wildcard: true, anchorSafe: true },
};

/** Every permission-set name the platform actually ships. */
function shippedSetNames(): string[] {
  return defaultPermissionSets.map((s) => s.name);
}

/**
 * The `describeHighPrivilegeBits` JSDoc block — the surface #6696 had to repair.
 * Anchored on the declaration rather than on line numbers, which drift.
 */
function highPrivilegeDoc(): string {
  const source = readFileSync(SPEC_HIGH_PRIVILEGE, 'utf8');
  const decl = source.indexOf('export function describeHighPrivilegeBits');
  expect(decl, '`describeHighPrivilegeBits` moved — re-anchor this pin').toBeGreaterThan(-1);
  const open = source.lastIndexOf('/**', decl);
  const close = source.indexOf('*/', open);
  expect(open, 'no JSDoc block precedes `describeHighPrivilegeBits`').toBeGreaterThan(-1);
  expect(close, 'unterminated JSDoc block').toBeLessThan(decl);
  return source.slice(open, close + 2);
}

/** The prose surfaces this pin watches, by label. */
function watchedSurfaces(): Record<string, string> {
  return {
    'packages/spec describeHighPrivilegeBits JSDoc': highPrivilegeDoc(),
    'plugin-security audience-anchors.test.ts': readFileSync(ANCHOR_TESTS, 'utf8'),
  };
}

/**
 * Shipped set names occurring in `prose`, as exact tokens. The boundaries matter:
 * `organization_admin` is a prefix of `organization_admin_no_bypass`, and only a
 * non-word lookahead keeps the longer name from answering for the shorter one.
 */
function namedSets(prose: string, shipped: string[]): string[] {
  return shipped.filter((name) => new RegExp(`(?<![\\w])${name}(?![\\w])`).test(prose));
}

/** Rows whose claim the shipped array/predicate does not back. */
function unbackedClaims(claims: Record<string, SetClaim>): string[] {
  const findings: string[] = [];
  for (const [name, claim] of Object.entries(claims)) {
    const set = defaultPermissionSets.find((s) => s.name === name);
    if (!set) {
      findings.push(`${name}: no such shipped set`);
      continue;
    }
    const hasWildcard = (set.objects as Record<string, unknown> | undefined)?.['*'] !== undefined;
    if (hasWildcard !== claim.wildcard) {
      findings.push(`${name}: claimed wildcard=${claim.wildcard}, shipped wildcard=${hasWildcard}`);
    }
    const isAnchorSafe = describeAnchorForbiddenBits(set, 'everyone') === null;
    if (isAnchorSafe !== claim.anchorSafe) {
      findings.push(`${name}: claimed anchorSafe=${claim.anchorSafe}, shipped anchorSafe=${isAnchorSafe}`);
    }
  }
  return findings;
}

/** Set names a surface mentions that the table does not classify. */
function unclassifiedNames(prose: string, shipped: string[], claims: Record<string, SetClaim>): string[] {
  return namedSets(prose, shipped).filter((n) => !(n in claims));
}

describe('prose names a permission set only for a shape it still has (#6842)', () => {
  it('reads the real shipped array, not a transcription', () => {
    const shipped = shippedSetNames();
    // A floor, not an exact count — new default sets are expected. Its only job
    // is to fail loudly if the import stops yielding sets, which would turn
    // every check below vacuously green.
    expect(shipped.length).toBeGreaterThanOrEqual(6);
    expect(shipped).toEqual(expect.arrayContaining(['member_default', 'viewer_readonly']));
    // The #5491 fact this whole file exists for, read off the shipped array.
    const member = defaultPermissionSets.find((s) => s.name === 'member_default')!;
    expect((member.objects as Record<string, unknown>)['*']).toBeUndefined();
  });

  it('watches surfaces that actually name sets (anti-vacuity)', () => {
    const shipped = shippedSetNames();
    for (const [label, prose] of Object.entries(watchedSurfaces())) {
      expect(prose.length, `${label}: extracted empty prose`).toBeGreaterThan(200);
      expect(namedSets(prose, shipped), `${label}: names no shipped set`).not.toEqual([]);
    }
  });

  it('would reject a claim the shipped array does not back (self-test)', () => {
    // The pre-#5491 table, verbatim in shape: the prose then named
    // `member_default` as the wildcard carrier, so its row read `wildcard: true`.
    // This is the row #5491 would have had to flip — and the reason it would
    // have had to read the three sentences it invalidated.
    expect(unbackedClaims({ member_default: { wildcard: true, anchorSafe: true } })).toEqual([
      'member_default: claimed wildcard=true, shipped wildcard=false',
    ]);
    // A set name that no longer ships at all.
    expect(unbackedClaims({ retired_set: { wildcard: false, anchorSafe: true } })).toEqual([
      'retired_set: no such shipped set',
    ]);
  });

  it('would reject a named set the table does not classify (self-test)', () => {
    // Without this direction, "no unclassified names" below could pass simply
    // because a surface stopped naming sets.
    const synthetic = "it('admin_full_access is the wildcard example', () => {});";
    expect(unclassifiedNames(synthetic, shippedSetNames(), CLAIMS)).toEqual(['admin_full_access']);
    // Prefix discipline: the longer name must not answer for the shorter one.
    expect(unclassifiedNames('see organization_admin_no_bypass', shippedSetNames(), CLAIMS)).toEqual([
      'organization_admin_no_bypass',
    ]);
  });

  it('every classified set matches what the platform ships', () => {
    expect(unbackedClaims(CLAIMS)).toEqual([]);
  });

  it('every set the watched prose names is classified (upward closure)', () => {
    const shipped = shippedSetNames();
    for (const [label, prose] of Object.entries(watchedSurfaces())) {
      expect(unclassifiedNames(prose, shipped, CLAIMS), `${label}: unclassified set name`).toEqual([]);
    }
  });

  it('every classified set is still named by some watched surface (downward closure)', () => {
    const shipped = shippedSetNames();
    const named = new Set(Object.values(watchedSurfaces()).flatMap((p) => namedSets(p, shipped)));
    expect([...Object.keys(CLAIMS)].filter((n) => !named.has(n))).toEqual([]);
  });
});
