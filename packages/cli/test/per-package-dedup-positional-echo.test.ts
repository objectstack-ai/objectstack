// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18779 — the per-package de-duplication key was POSITIONAL, so an ECHO of a
 * union finding survived the filter that exists to remove it.
 *
 * `runPerPackageAuthoringRules` judges each `packages[]` entry as its own stack
 * and drops anything the union run already reported. A package body re-bases
 * every collection from 0, while the flattened union numbers that same entry
 * wherever `authoringRuleUnionStack` put it — so one finding arrived under two
 * paths, `findingKey` produced two keys, and the `Set` never matched them.
 *
 * ## What that cost, measured on `origin/main` 18cc3b1dfc
 *
 * On `examples/app-multi-package`, the repo's own two-package fixture:
 *
 *     os build --json   warnings 4   <- 3 union + 1 per-package survivor
 *     the survivor      field-no-consumers on crm_account.industry
 *                       union path objects[1].fields.industry
 *                       survivor path objects[0].fields.industry
 *                       => 1 of 1 an echo, 0 genuinely new
 *
 * So the pass's entire output on that fixture was a duplicate of a warning the
 * same command had already printed, and `compile.ts`' claim that the survivors
 * are "exactly the set the union could not see" was false in the one place
 * anyone could check it. ⛔ Two cards (#18677, #18778) and two review seats
 * quoted that sentence as authority; none opened `findingKey`.
 *
 * ## What this file pins
 *
 * The echo case ⇒ de-duplicated, and THREE controls that must still survive,
 * because a key that stopped discriminating would satisfy the echo case
 * trivially. The controls are what make a green here mean something:
 *
 *   - a union twin differing only in its NESTED INDEX — the coordinate the
 *     rewrite deliberately leaves alone;
 *   - a union twin differing in `where` — a different entity;
 *   - a union twin differing in `rule`.
 *
 * ⚠️ The first control is built on `unique/unscoped-declared-index`, ⛔ not on
 * the `field-no-consumers` finding the echo cases use, and the fixture carries
 * a bare `unique: true` index for no other reason. Measured, ⛔ not reasoned:
 * an ablation that widens the rewrite from the top-level index to EVERY index
 * left all six cases green while that control was written against a
 * `field-no-consumers` twin, because such a path ends in a field NAME and the
 * twin therefore differed in a name rather than in a position. A control that
 * cannot fail is decoration; re-run that ablation if this file is edited.
 *
 * `REAL_UNION` closes it end to end on a fixture shaped like the example: the
 * union run really does raise the twin at a different index, so the case is
 * not an artefact of hand-built `unionFindings`.
 *
 * ## Tier
 *
 * Spawns nothing and boots no kernel ⇒ UNIT tier by
 * `packages/cli/vitest-tiers.ts`' predicate, asserted in BOTH directions by the
 * last case rather than assumed from the filename.
 */

import { describe, it, expect } from 'vitest';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStackInput, ObjectStackDefinitionSchema } from '@objectstack/spec';
import { runAuthoringRules, type AuthoringFinding } from '@objectstack/lint';
import { authoringRuleUnionStack } from '../src/utils/stack-collections.js';
import { runPerPackageAuthoringRules } from '../src/utils/artifact-packages.js';
import { firedSignals, integrationTestFiles, isIntegration, tierOfFile } from '../vitest-tiers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const THIS_FILE = relative(PKG, fileURLToPath(import.meta.url));

const CORE_MANIFEST = {
  id: 'com.example.echo.core',
  name: 'echo core',
  namespace: 'pp',
  version: '1.0.0',
  type: 'app',
  engines: { protocol: '^17' },
};

const CORE_OBJECTS = [
  {
    name: 'pp_account',
    label: 'Account',
    pluralLabel: 'Accounts',
    sharingModel: 'private',
    fields: {
      name: { name: 'name', type: 'text', label: 'Account Name', required: true },
      industry: { name: 'industry', type: 'text', label: 'Industry' },
    },
  },
];

const CORE_APPS = [
  {
    name: 'pp_crm',
    label: 'PP CRM',
    navigation: [
      {
        id: 'sales_group',
        type: 'group',
        label: 'Sales',
        children: [{ id: 'nav_accounts', type: 'object', objectName: 'pp_account', label: 'Accounts' }],
      },
    ],
  },
];

const ORDERS_MANIFEST = {
  id: 'com.example.echo.orders',
  name: 'echo orders',
  namespace: 'pp',
  version: '1.0.0',
  type: 'module',
  engines: { protocol: '^17' },
  dependencies: { 'com.example.echo.core': '^1.0.0' },
};

const ORDERS_OBJECTS = [
  {
    name: 'pp_order',
    label: 'Order',
    pluralLabel: 'Orders',
    sharingModel: 'private',
    fields: {
      name: { name: 'name', type: 'text', label: 'Order Number', required: true },
      account: { name: 'account', type: 'lookup', label: 'Account', reference: 'pp_account' },
    },
    // ⛔ Not decoration. A bare `unique: true` trips
    // `unique/unscoped-declared-index`, whose path carries a NESTED index
    // (`objects[0].indexes[0]`) — and a finding with a nested index is the ONLY
    // thing the NESTED control below can discriminate on. Every other rule this
    // fixture raises produces `objects[N].fields.<name>`, where the sole index
    // is the top-level one, so a "nested position" control written against one
    // of those cannot fail and is not a control. Measured: without this, an
    // ablation that rewrites EVERY index instead of the top-level one keeps all
    // six cases green.
    indexes: [{ name: 'pp_order_name_uq', fields: ['name'], unique: true }],
  },
];

/**
 * The example's shape: `orders` is listed FIRST, so `pp_account` lands at
 * `objects[1]` in the flattened union and at `objects[0]` in `core`'s own body.
 * That index disagreement IS the defect — a fixture with one package, or with
 * the App package first, cannot exhibit it.
 */
function artifact(): Record<string, unknown> {
  return {
    manifest: CORE_MANIFEST,
    objects: [...ORDERS_OBJECTS, ...CORE_OBJECTS],
    apps: [...CORE_APPS],
    packages: [
      { manifest: { ...ORDERS_MANIFEST, objects: ORDERS_OBJECTS } },
      { manifest: { ...CORE_MANIFEST, objects: CORE_OBJECTS, apps: CORE_APPS } },
    ],
  } as Record<string, unknown>;
}

function parsedArtifact(): Record<string, unknown> {
  const normalized = normalizeStackInput(artifact(), {});
  const result = ObjectStackDefinitionSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(`fixture is not schema-valid: ${JSON.stringify(result.error.issues.slice(0, 3))}`);
  }
  return result.data as unknown as Record<string, unknown>;
}

/** The pass's own output with NO union run to de-duplicate against. */
function rawSurvivors(parsed: Record<string, unknown>): AuthoringFinding[] {
  return runPerPackageAuthoringRules({ command: 'build', parsed, unionFindings: [] }).findings;
}

/** `where` as the de-duplication sees it — the pass prefixes it on the way out. */
const unprefixed = (f: AuthoringFinding): AuthoringFinding => ({
  ...f,
  where: f.where.replace(/^package '[^']*' — /, ''),
});

const survivorsAgainst = (
  parsed: Record<string, unknown>,
  unionFindings: readonly AuthoringFinding[],
): AuthoringFinding[] => runPerPackageAuthoringRules({ command: 'build', parsed, unionFindings }).findings;

describe('#18779 — the per-package de-duplication key is position-insensitive', () => {
  it('the fixture reaches the pass and raises the finding the rest of this file is about', () => {
    // Asserted first: every case below is vacuous if the pass produces nothing,
    // which is how this defect survived two cards' worth of parity pins.
    const raw = rawSurvivors(parsedArtifact());
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.some((f) => f.rule === 'field-no-consumers' && /industry/.test(f.path))).toBe(true);
    // The carrier the NESTED control needs — asserted here so its absence reads
    // as "the fixture stopped raising it" rather than as a silently weakened
    // control further down.
    expect(raw.some((f) => /^objects\[\d+\]\.indexes\[\d+\]$/.test(f.path))).toBe(true);
    expect(raw.every((f) => /^package '/.test(f.where))).toBe(true);
  });

  it('ECHO: a union twin at a different TOP-LEVEL index de-duplicates the survivor', () => {
    const parsed = parsedArtifact();
    const raw = rawSurvivors(parsed);
    const target = raw.find((f) => f.rule === 'field-no-consumers' && /industry/.test(f.path));
    expect(target, 'fixture no longer raises the finding this case is built on').toBeTruthy();

    const local = unprefixed(target!);
    // The SAME finding as the flattened union numbers it: `pp_account` sits at
    // `objects[1]` there and at `objects[0]` in `core`'s body. Only that one
    // coordinate differs — which is exactly what an echo is.
    expect(local.path).toMatch(/^objects\[0\]\./);
    const twin: AuthoringFinding = { ...local, path: local.path.replace(/^objects\[0\]/, 'objects[1]') };
    expect(twin.path).not.toBe(local.path);

    const survived = survivorsAgainst(parsed, [twin]);
    expect(
      survived.filter((f) => f.rule === target!.rule && f.where === target!.where),
      'an echo of a union finding must not survive the de-duplication that exists to remove it',
    ).toEqual([]);
  });

  it('CONTROL: a union twin differing only in its NESTED index still lets the survivor through', () => {
    // The rewrite is the top-level index ONLY. Nested positions address the
    // author's own document and read the same in both views, so widening the
    // rewrite to every index would swallow genuinely different findings — this
    // case is what goes red if someone does.
    //
    // ⚠️ It has to be built on a finding whose path ACTUALLY carries a nested
    // index. `unique/unscoped-declared-index` is that finding here
    // (`objects[0].indexes[0]`); `field-no-consumers` is not — its path ends in
    // a field NAME, so a twin built from it differs in a name rather than in a
    // position and stays distinct under any index rewrite at all. Measured: the
    // over-wide ablation keeps a `field-no-consumers` twin green and turns this
    // one red, which is the whole difference between a control and a decoration.
    const parsed = parsedArtifact();
    const target = rawSurvivors(parsed).find((f) => f.rule === 'unique/unscoped-declared-index');
    expect(target, 'fixture no longer raises a finding with a NESTED index in its path').toBeTruthy();
    const local = unprefixed(target!);
    expect(local.path).toMatch(/^objects\[\d+\]\.indexes\[\d+\]$/);

    // Same top-level index, DIFFERENT nested one — the coordinate the rewrite
    // must leave alone.
    const twin: AuthoringFinding = { ...local, path: local.path.replace(/\.indexes\[0\]$/, '.indexes[1]') };
    expect(twin.path).not.toBe(local.path);
    expect(twin.path.replace(/^objects\[\d+\]/, '')).not.toBe(local.path.replace(/^objects\[\d+\]/, ''));

    expect(survivorsAgainst(parsed, [twin]).map((f) => f.where)).toContain(target!.where);
  });

  it('CONTROL: a union twin differing in `where` or `rule` still lets the survivor through', () => {
    const parsed = parsedArtifact();
    const target = rawSurvivors(parsed).find((f) => f.rule === 'field-no-consumers')!;
    const local = unprefixed(target);
    const otherWhere: AuthoringFinding = {
      ...local,
      where: 'object "pp_order" · field "industry"',
      path: local.path.replace(/^objects\[0\]/, 'objects[1]'),
    };
    const otherRule: AuthoringFinding = {
      ...local,
      rule: 'some-other-rule',
      path: local.path.replace(/^objects\[0\]/, 'objects[1]'),
    };
    expect(survivorsAgainst(parsed, [otherWhere]).map((f) => f.where)).toContain(target.where);
    expect(survivorsAgainst(parsed, [otherRule]).map((f) => f.where)).toContain(target.where);
  });

  it('REAL_UNION: the union run really does raise the twin, at a different index, and it is filtered', () => {
    // End to end, with no hand-built finding anywhere: the union run over the
    // folded stack produces the twin itself. Before #18779 this fixture
    // reported the same warning twice.
    const parsed = parsedArtifact();
    const normalized = normalizeStackInput(artifact(), {});
    const unionFindings = runAuthoringRules('build', {
      normalized: authoringRuleUnionStack(normalized as Record<string, unknown>),
      parsed: authoringRuleUnionStack(parsed),
    });

    const raw = rawSurvivors(parsed);
    const target = unprefixed(raw.find((f) => f.rule === 'field-no-consumers' && /industry/.test(f.path))!);
    const twin = unionFindings.find(
      (u) => u.rule === target.rule && u.where === target.where && u.message === target.message,
    );
    // Non-vacuity: the union MUST carry the twin, or "it was filtered" says
    // nothing. And it must carry it at a DIFFERENT path, or the old key would
    // have matched it too and this fixture would not exhibit the defect.
    expect(twin, 'the union run no longer raises the twin — this fixture no longer exhibits the defect').toBeTruthy();
    expect(twin!.path).not.toBe(target.path);

    const survived = survivorsAgainst(parsed, unionFindings);
    expect(survived.filter((f) => f.rule === target.rule && f.where.endsWith(target.where))).toEqual([]);
  });

  it('is a UNIT-tier file, asserted in BOTH directions from the predicate itself', () => {
    // A pin in the wrong tier runs where the merge queue does not look, and a
    // pin that MOVES its file between tiers takes its neighbours with it. Both
    // directions, read from the predicate rather than from the filename: no
    // integration signal fires, and the derived integration population does
    // not contain this file.
    const signals = tierOfFile(PKG, THIS_FILE);
    expect(isIntegration(signals), `fired: ${firedSignals(signals)}`).toBe(false);
    expect(integrationTestFiles(PKG)).not.toContain(THIS_FILE);
  });
});
