// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6628] The `delegatable` JSDoc may name a lint rule only if that rule exists.
 *
 * That JSDoc is an authoring surface, not a comment: it is the TSDoc an author
 * (often an AI author, ADR-0033) hovers at the exact moment they type
 * `delegatable:`. For a whole major it closed with
 *
 *   "(enforced by the `security-delegatable-admin-position` lint rule and the
 *    D12 gate)"
 *
 * and the first of those two enforcers had never been written — the string
 * occurred exactly once in the repository, in that sentence. The runtime half
 * was real (`plugin-security`'s delegated-admin gate, step 6), so the invariant
 * held; what was false was WHEN it holds. The sentence promised an author-time
 * gate, so an author pairing `delegatable: true` with an `adminScope`-carrying
 * set believed `os lint` would stop them. It does not: the package publishes
 * clean and the mistake surfaces later, in a different package, as a runtime
 * deny phrased as a fact about the position rather than as a fix for the
 * authoring error.
 *
 * This is the `validate-security-posture.ts` header's own hazard one layer out.
 * That file records how alias tolerance "silently downgraded a NAMED rejection
 * into an inert branch — and an inert branch in a security linter reads, to the
 * next author, as a gate that is watching (#4984, #5009, #5017)". A rule that is
 * named but absent reads the same way, and is cheaper to write by accident:
 * prose costs nothing to add and no compiler checks it.
 *
 * So the authority here is machine-readable, never a hand-copied list — the
 * rule-id constants `packages/lint` actually exports, read off its `src/`
 * directory the way `rule-id-barrel-exports.test.ts` (#5648) reads it. A gate
 * name the rule table does not back turns this red.
 *
 * ⛔ Scope: the relation, not the wording. Rewording this JSDoc freely is fine —
 * what it may not do is name a `security-*` rule that no rule file declares, or
 * stop locating the containment check at runtime. The second half matters
 * because "no author-time rule" is only safe to say next to "the D12 gate does
 * enforce this, at delegation time"; drop that and the text overcorrects into
 * implying the invariant is unenforced, which is the opposite lie.
 *
 * Deliberately NOT asserted: that no author-time rule exists. Whether ADR-0091
 * D3 should grow one is a product decision (the finding left it open); if that
 * rule is ever written, this pin stays green the moment the JSDoc names it,
 * because the name will resolve against the same rule table.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/spec/src/identity → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');
const LINT_SRC = join(REPO_ROOT, 'packages', 'lint', 'src');
const POSITION_SOURCE = join(HERE, 'position.zod.ts');

/** `export const NAME = 'security-…';` — how every security rule id is declared. */
const EXPORTED_SECURITY_RULE_ID = /^export const [A-Z][A-Z0-9_]* = '(security-[a-z0-9-]+)';\s*$/;

/**
 * Every `security-*` rule id `packages/lint` declares, found by reading its
 * `src/` directory rather than by naming files. A new security rule in a new
 * file is therefore authoritative the moment it exists — the property a
 * hand-maintained list here would quietly lose.
 */
function declaredSecurityRuleIds(): Set<string> {
  const ids = new Set<string>();
  for (const file of readdirSync(LINT_SRC)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    for (const line of readFileSync(join(LINT_SRC, file), 'utf8').split('\n')) {
      const m = EXPORTED_SECURITY_RULE_ID.exec(line);
      if (m) ids.add(m[1]);
    }
  }
  return ids;
}

/** The JSDoc block attached to the authorable `delegatable` key. */
function delegatableDoc(): string {
  const source = readFileSync(POSITION_SOURCE, 'utf8');
  const key = source.indexOf('delegatable: z.boolean()');
  expect(key, 'the `delegatable` key declaration moved — re-anchor this pin').toBeGreaterThan(-1);
  const open = source.lastIndexOf('/**', key);
  const close = source.indexOf('*/', open);
  expect(open, 'no JSDoc block precedes `delegatable`').toBeGreaterThan(-1);
  expect(close, 'unterminated JSDoc block').toBeLessThan(key);
  return source.slice(open, close + 2);
}

/**
 * The `security-*` rule ids a piece of prose names, minus the ones the rule
 * table backs. Rule ids are matched by their backticked, multi-segment slug
 * shape: `security-owd-alias` is a rule id, while the cloud product name
 * `security-enterprise` (one segment, and never called a rule) is prose.
 */
function unbackedRuleIds(prose: string, backed: Set<string>): string[] {
  const named = [...prose.matchAll(/`(security-[a-z0-9]+(?:-[a-z0-9]+)+)`/g)].map((m) => m[1]);
  return [...new Set(named.filter((id) => !backed.has(id)))];
}

describe('`delegatable` JSDoc names only enforcers that exist (#6628)', () => {
  it('reads a real rule table off `packages/lint`', () => {
    const ids = declaredSecurityRuleIds();
    // A floor, not an exact count — new security rules are expected. Its only
    // job is to fail loudly if the extraction above stops finding anything,
    // which would turn the self-test below vacuously green.
    expect(ids.size).toBeGreaterThanOrEqual(12);
    // The control the finding itself used: an ADR-0091 D3 author-time rule that
    // DID land, proving the absence of the phantom was specific to that one
    // rule and not an artefact of the linter skipping ADR-0091.
    expect([...ids]).toContain('security-delegation-missing-reason');
  });

  it('would reject a gate name the rule table does not back (self-test)', () => {
    // The historical sentence's shape, proving the predicate has teeth
    // regardless of what the JSDoc currently says — without this, "no unbacked
    // ids" below could pass simply because the prose stopped naming rules.
    //
    // The rule name here is deliberately SYNTHETIC rather than #6628's literal
    // `security-delegatable-admin-position`. Whether ADR-0091 D3 should grow
    // that author-time rule is an open product decision the finding declined to
    // make; asserting its name is unbacked would quietly make this test the
    // thing that breaks when someone implements it. What needs pinning is the
    // predicate, not what any one unwritten rule would be called.
    const before =
      'so a delegatable position must never distribute an `adminScope`-carrying ' +
      'set (enforced by the `security-no-such-rule-exists` lint rule and the D12 gate).';
    expect(unbackedRuleIds(before, declaredSecurityRuleIds())).toEqual([
      'security-no-such-rule-exists',
    ]);
  });

  it('names no rule that `packages/lint` does not declare', () => {
    expect(unbackedRuleIds(delegatableDoc(), declaredSecurityRuleIds())).toEqual([]);
  });

  it('still locates the D12 containment check at runtime', () => {
    const doc = delegatableDoc();
    // Both halves, together: the gate that does enforce it, and WHEN. Naming
    // D12 without placing it at runtime is the sentence this pin was written
    // for; placing it at runtime without naming D12 reads as unenforced.
    expect(doc).toContain('D12');
    expect(doc).toMatch(/runtime/i);
  });
});
