// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// `AuthoringFinding` declares two location slots with different jobs:
//
//   where — "Human-readable location, e.g. `object \"leave_request\"`"
//   path  — "Config path, e.g. `objects[3].sharingModel`"
//
// Every CLI command renders the FIRST as the line's prefix. `os validate`
// prints `• ${where}: ${message}` and then `rule: ${rule}  at ${path}`, and
// `os lint` prints `${where}: ${message}` with `path` as the machine slot — so
// the two slots print side by side and a `where` copied from `path` spends the
// human-readable one saying what the `at` clause already said.
//
// Scope, measured rather than assumed: all three of these rules are
// `surfaces: CLI_ONLY`, and `runtime-gate.ts` dispatches only rules whose
// `surfaces` include `runtime-publish`. They therefore do NOT reach
// `SaveMetaItemResponseSchema.advisories` and Studio does not render them
// today — the card that filed this predates the #4716 split, which crossed the
// five GATING object rules and deliberately left the six advisory-tier ones
// (these among them) behind the door. This is a CLI diagnostic defect now, and
// the guard below is what keeps it fixed if that door later opens.
//
// The three ADR-0120 uniqueness rules used to set `where: f.path`, so an author
// read the same positional string twice and the location slot carried nothing:
//
//   • objects[44].indexes[1]: "sys_account" declares index [provider_id, …
//         rule: unique/unscoped-declared-index  at objects[44].indexes[1]
//
// That index is a position in the MERGED object array (44 objects from
// `@objectstack/platform-objects` plus one from `@objectstack/metadata-core` in
// the measurement that filed this), which appears in no file the author wrote.
//
// This file pins BOTH halves, because pinning only the three would leave the
// class open: the second test runs the whole registry and fails on any rule
// that puts a bare config path in `where`. It is a guard on the shape of the
// corpus, not on these three rules — measured when this landed, the registry
// held 41 rules and exactly these 3 carried the shape, with no rule building a
// positional `where` in its own module.
//
// The fix changes the `where` STRING only, never which code a rule matches:
// over the same 45 shipped object declarations the card measured, the registry
// produced 1050 findings from 5 rules both before and after, and the count of
// findings whose `where` was a bare config path went 72 → 0.
import { describe, expect, it } from 'vitest';
import { AUTHORING_RULES, runAuthoringRules, type AuthoringFinding } from './authoring-rules.js';
import {
  lintLegacyOrganizationComposites,
  lintUniqueDeclarations,
  lintUnscopedDeclaredIndexes,
} from './data-model-rules.js';

/**
 * Filler so the object under test does NOT sit at `objects[0]`. The defect is
 * invisible at index 0 — `objects[0].indexes[0]` reads plausibly enough that a
 * fixture rooted there would pass a human review of the old spelling too.
 */
const filler = (n: number) =>
  Array.from({ length: n }, (_, k) => ({ name: `filler_${k}`, fields: { id: { type: 'text' } } }));

const SYS_ACCOUNT = {
  name: 'sys_account',
  fields: {
    email: { type: 'text', unique: true },
    provider_id: { type: 'text' },
    account_id: { type: 'text' },
    organization_id: { type: 'text' },
  },
  indexes: [
    // named + lists the organization column → R11 and R12
    { name: 'uniq_org_email', unique: true, fields: ['organization_id', 'email'] },
    // unnamed composite → R11, and exercises the column-list `where` label
    { unique: true, fields: ['provider_id', 'account_id'] },
    // single column that ALSO carries a field-level `unique` → R11 and R10
    { unique: true, fields: ['email'] },
  ],
};

const objects = [...filler(44), SYS_ACCOUNT];
const stack = { objects } as Record<string, unknown>;

const whereOf = (rule: string, findings: readonly AuthoringFinding[]) =>
  findings.filter((f) => f.rule === rule).map((f) => f.where);

describe('the three ADR-0120 uniqueness rules name the object in `where`', () => {
  // Through the REGISTRY, not the rule functions: the defect lived in the
  // registry adapter (`where: f.path`), so a test that called the rule directly
  // would have stayed green through the whole bug.
  const findings = runAuthoringRules('validate', { normalized: stack, parsed: stack });

  it('R11 `unique/unscoped-declared-index` names the object and the index', () => {
    expect(whereOf('unique/unscoped-declared-index', findings)).toEqual([
      `object "sys_account" · index 'uniq_org_email'`,
      'object "sys_account" · index [provider_id, account_id]',
      'object "sys_account" · index [email]',
    ]);
  });

  it('R10 `unique/double-declaration` names the object and the column', () => {
    expect(whereOf('unique/double-declaration', findings)).toEqual([
      `object "sys_account" · field 'email'`,
    ]);
  });

  it('R12 `unique/legacy-organization-composite` names the object and the index', () => {
    expect(whereOf('unique/legacy-organization-composite', findings)).toEqual([
      `object "sys_account" · index 'uniq_org_email'`,
    ]);
  });

  // The card that filed this asked for `where` only. `path` is the slot that is
  // SUPPOSED to be positional, `os validate` prints it after `at`, and the
  // runtime gate's `fingerprint` reads `where` and `path` together — so a
  // consumer diffing findings across two stack shapes still sees the index
  // move. Pinned so a later "clean up the indexes" pass has to be deliberate.
  it('leaves `path` positional', () => {
    expect(findings.filter((f) => f.rule === 'unique/double-declaration').map((f) => f.path)).toEqual([
      'objects[44]',
    ]);
    expect(
      findings.filter((f) => f.rule === 'unique/legacy-organization-composite').map((f) => f.path),
    ).toEqual(['objects[44].indexes[0]']);
  });

  // The rules' own return type carries `where`, so a fourth rule joining this
  // family cannot reach the adapter without one. Reading it off the direct call
  // proves the producer states it — not the adapter reconstructing it.
  it('the rule functions themselves state `where`', () => {
    for (const issue of [
      ...lintUnscopedDeclaredIndexes(objects),
      ...lintUniqueDeclarations(objects),
      ...lintLegacyOrganizationComposites(objects),
    ]) {
      expect(issue.where).toMatch(/^object "sys_account" /);
      expect(issue.path).toMatch(/^objects\[44\]/);
    }
  });
});

describe('no authoring rule puts a bare config path in the `where` slot', () => {
  /** `objects[3]`, `flows[0].nodes[2].config` — a config path, not a location. */
  const BARE_CONFIG_PATH = /^[A-Za-z_$][\w$]*\[\d+\]/;

  it('holds across every rule the violating stack triggers', () => {
    const findings = runAuthoringRules('validate', { normalized: stack, parsed: stack });

    // Non-vacuous: the stack must actually trip the three rules this guard was
    // written for, or the sweep below is asserting over an empty list.
    const rules = new Set(findings.map((f) => f.rule));
    expect(rules).toContain('unique/unscoped-declared-index');
    expect(rules).toContain('unique/double-declaration');
    expect(rules).toContain('unique/legacy-organization-composite');

    const offenders = findings
      .filter((f) => BARE_CONFIG_PATH.test(f.where))
      .map((f) => `${f.rule}: where = ${f.where}`);
    expect(
      offenders,
      '`where` is the slot every CLI command prints as the line prefix. A config path ' +
        'belongs in `path`, which the same commands print separately — putting one here ' +
        'spends the only human-readable slot on a number the `at` clause already carries.',
    ).toEqual([]);
  });

  // The sweep above only sees rules this one stack happens to trip. This second
  // assertion is static and covers all 41 entries: no registry adapter may map
  // the `where` slot from a source finding's `path`.
  it('holds for every registry adapter, including rules this stack does not trip', () => {
    const source = AUTHORING_RULES.map((r) => r.run.toString()).join('\n');
    expect(
      source.match(/where:\s*\w+\.path\b/g) ?? [],
      'a registry adapter is mapping `where` from a positional config path again',
    ).toEqual([]);
  });
});
