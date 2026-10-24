/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every `AnyComponentSchema` arm is a NAMED export of `./zod` — or it is
 * ledgered below with the reason it is not (objectui#8784).
 *
 * ## The defect this closes
 *
 * objectui#7917 found that 2 of the union's arms had no named export from
 * `@object-ui/types/zod`, so `breadcrumb` and `object-tree` could not be
 * validated on their own: the schemas existed, were maintained, and were
 * applied by the union, while no consumer could name them. PR #8777 repaired
 * both. Nothing kept it repaired.
 *
 * `./zod` is this package's ONLY zod subpath (`packages/types/package.json`
 * maps it to `dist/zod/index.zod.js`) and `index.zod.ts` carries no star
 * re-export — every name on that barrel is written out by hand. So an arm added
 * to a category module and not to the barrel is declared-and-unreachable, and
 * TWO of the three ways that has happened were silent:
 *
 *  - `BreadcrumbSchema` was on the barrel at creation and was dropped by
 *    `d908a82f4`, a "Fix schema duplication" dedup, as COLLATERAL — no
 *    decision, no diagnostic — and stayed gone for 41 commits while this
 *    directory's `README.md` kept advertising it;
 *  - `ObjectTreeSchema` was never added at all: PR #1892's file list omits the
 *    barrel.
 *
 * ⭐ The third way is neither of those, and it is the one live on this tree:
 * a DECLARED deferral. `507b61bf7` (PR #8763, objectui#8499, merged
 * 2026-09-09T08:11:20Z) armed four new arms in `layout.zod.ts` and
 * `form.zod.ts` and left the barrel alone ON PURPOSE. Its own changeset,
 * `.changeset/8499-node-slot-registered-arms.md`, declares the omission, the
 * metric it moves, and the reason: exporting a `SemanticElementSchema` /
 * `HtmlElementSchema` pair "would publish a NAMED authoring surface (`z.enum`
 * families, not per-tag schemas) that this card's ruling does not cover", so
 * "the metric is left to move and said out loud instead" and "whoever wants
 * the number back down should treat naming these families as its own
 * decision". objectui#8499's ceiling review raised the omission as blocking
 * F1 (`5597569641`), whose remedy NAMED "one additive commit on `90fcf4f2`
 * with the eight barrel lines" — ⛔ named, not prepared. `5598263402` recorded
 * the sha later offered for that commit, `b7af6b52`, as a phantom ("Option (a)
 * had nothing to lean on"), and the review PASSed the deferral "on the
 * surface-widening reason alone" instead. Re-derive by asking this repository's
 * commits endpoint for `b7af6b52`: it answers 422 "No commit found for SHA"
 * where the controls `90fcf4f2`, `fb010227` and `005409fc1` answer 200.
 *
 * ⛔ So this is NOT `d908a82f4` recurring: no
 * one forgot — the barrel was left alone on a reason, and the decision that
 * reason deferred has since been TAKEN.
 *
 * ⭐ objectui#9067 settled it and split the four (director seat, decision batch
 * #121 item 5, maintainer 2026-09-12). The barrel means one name, one node type:
 * `InputShorthandSchema` (two `type` literals) and `UiCalendarSchema` (one) fit
 * that meaning and are now exported by name; `SemanticElementSchema` and
 * `HtmlElementSchema` are `z.enum` families keyed by a tag, do not, and are the
 * two `ABSENT_BY_DECISION` rows below carrying the reason. Splitting the families
 * into per-tag schemas was ruled out in the same record as expansion for a
 * consumer nobody has measured. ⛔ So no row below says "a decision is owed" any
 * more, and the card's own framing — that these were unnamed by accident — is
 * corrected by that record: the omission was declared, reviewed and passed.
 *
 * ⚠️ It is still exactly what this pin is for, and the reason is where the
 * declaration LIVES. A `.changeset/*.md` is consumed and deleted at release —
 * measured, e.g. `59f61cfb8` "chore: release packages (#4655)" removes the
 * batch it versioned.
 *
 * ⛔ But the explanation does NOT die with the file, and this docblock used to
 * say it did. A changeset that declares a bump has its prose copied into the
 * bumped package's CHANGELOG by that same release commit; only one with EMPTY
 * frontmatter — this repository's "no release" declaration — is deleted with
 * nowhere for its reason to go. `.changeset/8499-node-slot-registered-arms.md`
 * declares `'@object-ui/types': minor`, so its reason lands in
 * `packages/types/CHANGELOG.md` at the next release. Re-derive on any release
 * commit by diffing its `.changeset/` deletions against the `*CHANGELOG.md`
 * lines it adds; ⛔ nothing in this repository re-derives it for you, so treat
 * this paragraph as the one-off reading it is.
 *
 * ⇒ The operative argument is narrower and survives intact: nothing in the tree
 * re-reads that CHANGELOG entry and nothing reddens when it stops being true, so
 * a deferred non-export and a collateral drop still read as the same two lines
 * of nothing in `index.zod.ts`. The rows below move the reason to where it IS
 * re-read on every run, and deleted only when it stops being true.
 *
 * ## Why the existing checks could not see it
 *
 *  - `zod-mirror-parity.test.ts` reads its export population with
 *    `/^export const NAME/m` over `src/zod/*.zod.ts`. That pattern matches a
 *    DECLARATION; a barrel line is `export { NAME } from './x.js'`, which it
 *    cannot match — so the census is structurally blind to a missing
 *    re-export even though `index.zod.ts` is one of the files it reads.
 *  - No test pinned an export list or a count on `index.zod.ts`. The per-name
 *    presence assertions that exist (`crud-retirement-5373.test.ts`,
 *    `block-family-retired-4895.test.ts`, `breadcrumb-object-tree-nameable-7917.test.ts`)
 *    each pin the names their own card was about, which is one arm at a time.
 *  - `scripts/measure-strict-authoring-face.mjs` does compute it, and is
 *    self-described `MEASUREMENT THROWAWAY`: no `package.json` script and no
 *    workflow runs it.
 *
 * ## The two properties this pin is built on
 *
 * 1. ⭐ **It reads the BARREL, not the modules.** The population is
 *    `Object.entries` of the `../zod/index.zod.js` module namespace — the
 *    runtime export surface itself, so a re-export counts and a declaration
 *    that never reached the barrel does not. A pin that read `^export const`
 *    from the same files as the parity census would have rebuilt the blind spot
 *    under a new filename. (The category modules ARE imported below, but only
 *    to turn a failing arm into a name a reader can act on; they never decide
 *    the verdict. `namesOn` is given ONE namespace and the real reading passes
 *    it the barrel.)
 *
 * 2. ⭐ **It matches by IDENTITY, not by name.** Adversarial probing of #8777's
 *    pin found that `export { NavigationSchema as BreadcrumbSchema }` — the
 *    PARENT sub-union re-exported under the arm's name — satisfies a name-based
 *    check and every behavioural leg of that pin. Only identity catches it, and
 *    the arm's identity chain deliberately starts at the union OPTION, so no
 *    containing union is ever a candidate. TWO controls below carry that
 *    property: `still reports the arm when the PARENT union carries the arm
 *    name`, on probe schemas, and `still reports the REAL arm when the barrel
 *    binds its name to the parent union`, on the real barrel — the leg that
 *    catches a `namesOn` weakened from identity to a name match, since a probe
 *    schema has no declaring name for such a check to match on. ⛔ Cited by
 *    title, not by line: the title this sentence used to give belonged to no
 *    `it()` in this file at any point, and a line number would have rotted the
 *    same way (the shape objectui#7853 established and objectui#8478 applied).
 *
 * ⛔ The arm list is DERIVED on every run and no count is hard-coded: arms land
 * (four did, mid-card), and a number stated in a comment that nothing checks is
 * objectui#8606. The only bound asserted against the real union is a floor read
 * off that union's own top-level option count, which is what proves the walk
 * recursed rather than stopping at those top-level members — the reviewer's
 * first census stopped there and reported a plausible, fully-populated,
 * entirely wrong "13 arms / 2 literals". ⚠️ Those 13 are 12 sub-unions plus one
 * object arm (`AppComponentSchema`, an arm at depth 1), not 13 sub-unions; the
 * floor holds either way, and the count is read off the union rather than
 * written down here.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// The population under test: the published barrel's own module namespace.
import * as barrel from '../zod/index.zod.js';

// Diagnostics only — see property 1 above. These give a failing arm a name.
import * as appZod from '../zod/app.zod.js';
import * as complexZod from '../zod/complex.zod.js';
import * as crudZod from '../zod/crud.zod.js';
import * as dataDisplayZod from '../zod/data-display.zod.js';
import * as disclosureZod from '../zod/disclosure.zod.js';
import * as feedbackZod from '../zod/feedback.zod.js';
import * as formZod from '../zod/form.zod.js';
import * as layoutZod from '../zod/layout.zod.js';
import * as navigationZod from '../zod/navigation.zod.js';
import * as objectqlZod from '../zod/objectql.zod.js';
import * as overlayZod from '../zod/overlay.zod.js';
import * as reportsZod from '../zod/reports.zod.js';
import * as viewsZod from '../zod/views.zod.js';

/* ── The ledger ──────────────────────────────────────────────────────────────
 *
 * ⛔ NOT a claim that every arm must be exported — only that the answer is
 * DECLARED, in the tree, where it is re-read on every run. ⛔ No row below
 * records a slip — every one is a decision taken, with its reason. A row is
 * keyed by ONE `type` literal of the
 * arm, because an arm with no barrel export has, by definition, no barrel name
 * to key on; `every ledger row still names an arm` below fails if that literal
 * stops existing, so the key cannot rot into a comment.
 */

/** Arms whose absence from the barrel is a decision someone took, with its reason. */
const ABSENT_BY_DECISION: Readonly<Record<string, string>> = {
  kanban:
    'complex.zod.ts#RetiredKanbanNodeSchema — an ADR-0049 refusal arm rather than a mirror. '
    + 'The decision is written on the barrel itself, beside the `complex.zod.js` block: '
    + '"it is deliberately NOT exported — nothing outside this package parses against a '
    + 'refusal arm" (objectui#8802, maintainer ruling 2026-09-09).',
  'cloud:plan-status':
    'cloud.zod.ts#RetiredCloudPlanStatusNodeSchema — the same ADR-0049 refusal arm, for the '
    + 'retired `cloud:plan-status` literal (objectui#12954), in the shape of the `kanban` row above. '
    + 'The decision is written on the barrel beside the `cloud.zod.js` export: "it is deliberately '
    + 'NOT exported — nothing outside this package parses against a refusal arm".',

  // ⭐ The two rows objectui#9067 moved here out of ABSENT_PENDING_DECISION. They
  // quote `.changeset/8499-node-slot-registered-arms.md` rather than cite it,
  // because that file is consumed and deleted at release and the reason has to
  // outlive it — which is the whole point of ledgering them (see the docblock
  // above). Both are FAMILY schemas keyed by a tag `z.enum`: a name bound to
  // either hands a consumer a schema accepting every tag in the family, not the
  // one node type every other name on this barrel stands for.
  aside:
    'layout.zod.ts#SemanticElementSchema — a `z.enum` family of HTML sectioning tags, not one '
    + 'node type. NOT named on the barrel by the objectui#9067 ruling (director seat, decision '
    + 'batch #121 item 5, maintainer 2026-09-12), on the reason objectui#8499 recorded when it '
    + 'armed the arm and deferred the naming: exporting a `SemanticElementSchema` / '
    + '`HtmlElementSchema` pair "would publish a NAMED authoring surface (`z.enum` families, not '
    + 'per-tag schemas) that this card\'s ruling does not cover". Splitting the family into '
    + 'per-tag schemas was ruled out in the same record as expansion for a consumer nobody has '
    + 'measured. The non-export is also written on the barrel, beside the `layout.zod.js` block.',
  h1:
    'layout.zod.ts#HtmlElementSchema — the same ruling, the same reason, the other family: a '
    + '`z.enum` of the safe flow/inline tags `renderers/basic/html-elements.tsx` registers. '
    + 'objectui#8499\'s changeset names this pair together — exporting them "would publish a '
    + 'NAMED authoring surface (`z.enum` families, not per-tag schemas)" — and objectui#9067 '
    + 'ruled the pair absent by decision rather than split into per-tag schemas.',
};

/**
 * Arms whose absence from the barrel is DEFERRED, with the decision still owed.
 *
 * ⭐ Empty on purpose, and kept rather than deleted: it is one of the three
 * answers the failure message below offers, so a card that arms an arm it has no
 * ruling to name has somewhere to say so instead of leaving the answer to be
 * inferred from an absence. ⛔ Do not repurpose it as a second
 * `ABSENT_BY_DECISION` — a row here means "nobody has decided yet", and `states
 * each absence once` below refuses a literal that claims to be both.
 *
 * It last held four rows, all four armed by `507b61bf7` (objectui#8499) and all
 * four settled by objectui#9067: two are exported by name from `index.zod.ts`
 * now, two moved to `ABSENT_BY_DECISION` above with the reason. See the file
 * docblock for that split and why the reason had to leave the changeset.
 */
const ABSENT_PENDING_DECISION: Readonly<Record<string, string>> = {};

const LEDGER: Readonly<Record<string, string>> = { ...ABSENT_BY_DECISION, ...ABSENT_PENDING_DECISION };

/**
 * Own-key test. ⛔ Not `key in ledger`: these are plain object literals, so `in`
 * answers `true` for every `Object.prototype` key and an arm declaring
 * `type: 'constructor'` or `'toString'` would ledger itself.
 *
 * `Object.hasOwn` is the modern spelling and does not compile here — measured:
 * `packages/types/tsconfig.json` sets `"lib": ["ES2020", "DOM"]`, and tsc says
 * `TS2550: Property 'hasOwn' does not exist on type 'ObjectConstructor'. …Try
 * changing the 'lib' compiler option to 'es2022' or later`. A lib bump is a
 * build-config change this pin does not own, so the `.call` form stands.
 * ⛔ Do not "modernise" it back without moving the lib first.
 */
function hasRow(ledger: Readonly<Record<string, string>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(ledger, key);
}

/* ── The census ──────────────────────────────────────────────────────────────*/

interface ZodDef {
  readonly type: string;
  readonly options?: readonly unknown[];
  readonly getter?: () => unknown;
  readonly shape?: Readonly<Record<string, unknown>>;
  readonly values?: readonly unknown[];
  readonly entries?: Readonly<Record<string, unknown>>;
}

/**
 * A schema's definition. Zod 4 stores it at `_zod.def` and ALSO exposes it
 * publicly as `.def` — the same object, not a copy. ⛔ This docblock used to say
 * "nothing public exposes it", which is false. Measured on the zod version
 * `packages/types/package.json` resolves today (4.4.3): `schema.def ===
 * schema._zod.def` holds for every shape this file walks — object, literal,
 * enum, union, discriminated union and lazy — and zod's own `ZodType`
 * interface declares `def` while carrying `_def` only as deprecated, with a
 * doc comment pointing at `.def` as the replacement.
 *
 * ⇒ The spelling below is therefore not load-bearing and reading `.def` would be
 * equally correct; it is kept because the cast is written against the internal
 * shape. ⚠️ That is a claim about a third-party runtime, which is the class
 * that goes stale in silence: re-measure it against the zod version
 * `packages/types/package.json` resolves, ⛔ never against this sentence.
 */
function defOf(schema: unknown): ZodDef | undefined {
  return (schema as { _zod?: { def?: ZodDef } } | null | undefined)?._zod?.def;
}

/** The `type` literals a member declares, or `[]` when it declares none. */
function typeLiterals(schema: unknown): string[] {
  const def = defOf(schema);
  if (!def) return [];
  if (def.type === 'literal') return (def.values ?? []).filter((v): v is string => typeof v === 'string');
  if (def.type === 'enum') return Object.values(def.entries ?? {}).filter((v): v is string => typeof v === 'string');
  if (def.type === 'union') return (def.options ?? []).flatMap((option) => typeLiterals(option));
  return [];
}

interface Arm {
  /**
   * Every schema object this arm is reachable AS: the union option, then each
   * `z.lazy` unwrapped along the way. ⛔ A containing union is never a member —
   * that is what makes a name on the parent union not a name on the arm.
   */
  readonly chain: readonly unknown[];
  readonly literals: readonly string[];
}

interface Census {
  readonly arms: readonly Arm[];
  /** Members that are neither union, `z.lazy` nor object — a finding, ⛔ never a silent skip. */
  readonly unresolved: readonly string[];
}

/**
 * Flatten a component union to its leaf object arms, recursively, through
 * nested unions and `z.lazy`.
 */
function censusOf(union: unknown): Census {
  const arms: Arm[] = [];
  const unresolved: string[] = [];
  const seen = new Set<unknown>();

  const walk = (schema: unknown, chain: readonly unknown[]): void => {
    if (seen.has(schema)) return;
    seen.add(schema);
    const def = defOf(schema);
    if (def === undefined) {
      // ⛔ Not a silent `return`: a member with no `_zod` is a shape this walk
      // does not understand, and dropping it would hide whatever arm it holds.
      unresolved.push('(member carries no zod definition)');
      return;
    }
    if (def.type === 'union') {
      // A union is a CONTAINER, so each option starts its own chain.
      for (const option of def.options ?? []) walk(option, [option]);
      return;
    }
    if (def.type === 'lazy') {
      const inner = def.getter?.();
      if (inner === undefined) {
        unresolved.push('lazy (getter returned nothing)');
        return;
      }
      walk(inner, [...chain, inner]);
      return;
    }
    if (def.type === 'object') {
      arms.push({ chain, literals: typeLiterals(def.shape?.type) });
      return;
    }
    unresolved.push(def.type);
  };

  walk(union, []);
  return { arms, unresolved };
}

/** Named exports of `namespace` whose VALUE is one of the schemas this arm is reachable as. */
function namesOn(namespace: Readonly<Record<string, unknown>>, arm: Arm): string[] {
  const reachableAs = new Set(arm.chain);
  return Object.entries(namespace)
    .filter(([, value]) => reachableAs.has(value))
    .map(([name]) => name);
}

/* ── The real reading ────────────────────────────────────────────────────────*/

const CENSUS = censusOf(barrel.AnyComponentSchema);
const BARREL = barrel as unknown as Readonly<Record<string, unknown>>;

/** `file#name` for every schema declared by a category module — diagnostics only. */
const MODULE_NAMES = new Map<unknown, string>();
for (const [file, namespace] of Object.entries({
  'app.zod.ts': appZod,
  'complex.zod.ts': complexZod,
  'crud.zod.ts': crudZod,
  'data-display.zod.ts': dataDisplayZod,
  'disclosure.zod.ts': disclosureZod,
  'feedback.zod.ts': feedbackZod,
  'form.zod.ts': formZod,
  'layout.zod.ts': layoutZod,
  'navigation.zod.ts': navigationZod,
  'objectql.zod.ts': objectqlZod,
  'overlay.zod.ts': overlayZod,
  'reports.zod.ts': reportsZod,
  'views.zod.ts': viewsZod,
} as Readonly<Record<string, Readonly<Record<string, unknown>>>>)) {
  for (const [name, value] of Object.entries(namespace)) {
    if (value !== null && typeof value === 'object' && !MODULE_NAMES.has(value)) {
      MODULE_NAMES.set(value, `${file}#${name}`);
    }
  }
}

/** What a failure prints: the declaring name, then the literals it owns. */
function describeArm(arm: Arm): string {
  const declared = arm.chain.map((schema) => MODULE_NAMES.get(schema)).find((name) => name !== undefined);
  const shown = arm.literals.slice(0, 6).join(', ');
  const rest = arm.literals.length > 6 ? `, and ${arm.literals.length - 6} more` : '';
  return `${declared ?? '(arm declared by no exported const)'} [type: ${shown}${rest}]`;
}

const UNNAMED = CENSUS.arms.filter((arm) => namesOn(BARREL, arm).length === 0);

describe('every AnyComponentSchema arm is nameable on `./zod` (objectui#8784)', () => {
  it('no arm is missing from the barrel without a ledger row saying why', () => {
    // `hasRow`, ⛔ not `in` — see its docblock for why, and why not `Object.hasOwn`.
    const undeclared = UNNAMED.filter((arm) => !arm.literals.some((literal) => hasRow(LEDGER, literal)));
    expect(
      undeclared.map(describeArm),
      'These `AnyComponentSchema` arms have no named export on `./zod`, so no consumer can '
      + 'validate one of these node types on its own — `AnyComponentSchema` only answers "is '
      + 'this SOME valid node". Three answers are acceptable and a fourth is not. Re-export '
      + 'each from packages/types/src/zod/index.zod.ts; or, if it is deliberately internal, '
      + 'add a row to ABSENT_BY_DECISION with the reason (the way RetiredKanbanNodeSchema '
      + 'carries one); or, if naming it is a decision your card does not cover, add a row to '
      + 'ABSENT_PENDING_DECISION naming the card that holds it. What is not acceptable is '
      + 'leaving the answer to be inferred from an absence.',
    ).toEqual([]);
  });

  it.each(Object.keys(LEDGER))('ledger row `%s` still names a live, still-absent arm', (literal) => {
    const arm = CENSUS.arms.find((candidate) => candidate.literals.includes(literal));
    expect(
      arm,
      `No arm of AnyComponentSchema declares type '${literal}' any more. The ledger row in this `
      + 'file outlived its arm — delete it, or key it on a literal the arm still declares.',
    ).toBeDefined();
    if (arm === undefined) return;
    expect(
      namesOn(BARREL, arm),
      `The arm declaring type '${literal}' IS exported by index.zod.ts now, so its ledger row is `
      + 'stale — delete the row. A ledger that keeps rows after their reason is gone stops being read.',
    ).toEqual([]);
  });

  it('states each absence once — the two ledgers do not overlap', () => {
    const both = Object.keys(ABSENT_BY_DECISION).filter((key) => hasRow(ABSENT_PENDING_DECISION, key));
    expect(both, 'A row cannot be both a decision taken and a decision owed.').toEqual([]);
  });
});

describe('the census reads the real union, and reads all of it', () => {
  it('recurses BELOW the top-level arms', () => {
    // Derived floor, ⛔ not a count: the reviewer's first census stopped at the
    // top-level sub-unions and reported one "arm" per union. Anything that does
    // that scores exactly `options.length` here.
    const topLevel = defOf(barrel.AnyComponentSchema)?.options ?? [];
    expect(topLevel.length).toBeGreaterThan(0);
    expect(CENSUS.arms.length).toBeGreaterThan(topLevel.length);
  });

  it('leaves no member unresolved', () => {
    // A member that is neither union, `z.lazy` nor object is a shape this walk
    // does not understand — it must be reported, never dropped, or the arm it
    // hides is invisible to the assertion above.
    expect(CENSUS.unresolved).toEqual([]);
  });

  it('every arm declares at least one `type` literal', () => {
    // An arm contributing zero literals would satisfy the ledger check
    // vacuously — `literals.some(...)` is false for an empty list, so it would
    // read as "undeclared" rather than sneak through; this states the stronger
    // property the discriminated union already rests on.
    expect(CENSUS.arms.filter((arm) => arm.literals.length === 0).map(describeArm)).toEqual([]);
  });

  it('resolves an arm reached through `z.lazy`', () => {
    // `crud.zod.ts`'s `ActionSchema` reaches its literal through a `z.lazy`. If
    // the unwrap silently failed, this arm would simply not be in the census
    // and the whole pin would go quiet by shrinking its population.
    const action = CENSUS.arms.find((arm) => arm.literals.includes('action'));
    expect(action).toBeDefined();
    if (action === undefined) return;
    expect(namesOn(BARREL, action)).not.toEqual([]);
  });

  it('matches a known arm to its barrel name BY IDENTITY', () => {
    const button = CENSUS.arms.find((arm) => arm.literals.includes('button'));
    expect(button).toBeDefined();
    if (button === undefined) return;
    expect(namesOn(BARREL, button)).toContain('ButtonSchema');
  });

  it('still reports the REAL arm when the barrel binds its name to the parent union', () => {
    // ⭐ Property 2 as a control ON THE REAL BARREL, and the leg this file was
    // missing. `still reports the arm when the PARENT union carries the arm
    // name` states the same property on probe schemas, and a probe schema has no
    // declaring name — so a `namesOn` weakened from identity to "identity OR the
    // arm's declaring name" leaves that control, and every other test here,
    // green: with the barrel intact AND with `export { NavigationSchema as
    // BreadcrumbSchema }` written to `index.zod.ts`. Only this leg reddens under
    // that weakening, because the arm below is declared as `BreadcrumbSchema` in
    // `navigation.zod.ts` and the namespace it is judged against carries that
    // very name — bound to the PARENT union, which is exactly the write
    // adversarial probing of #8777's pin found.
    const breadcrumb = CENSUS.arms.find((arm) => arm.literals.includes('breadcrumb'));
    expect(breadcrumb).toBeDefined();
    if (breadcrumb === undefined) return;
    // The intact barrel names it, so the substitution below is the only variable.
    expect(namesOn(BARREL, breadcrumb)).toContain('BreadcrumbSchema');
    expect(
      namesOn({ ...BARREL, BreadcrumbSchema: BARREL.NavigationSchema }, breadcrumb),
      'The barrel binds `BreadcrumbSchema` to the PARENT union rather than to the arm, so the '
      + 'arm has no name of its own and must read as unnamed. A `namesOn` that answers this by '
      + 'name instead of by identity reports `BreadcrumbSchema` here and the pin goes quiet.',
    ).toEqual([]);
  });
});

describe('the census fires — controls', () => {
  // Every control below is built on schemas the census has never seen, so each
  // one is free to be red: the arm under test is absent from the namespace it
  // is judged against, which is precisely the state the real reading must
  // detect. A census that reported nothing would leave every control in this
  // block green only if it reported nothing for the real union too, and the
  // `recurses BELOW` and `matches a known arm` legs above already refuse that.
  // ⛔ No count is written here: this block said "all four" while carrying five,
  // which is the objectui#8606 shape in the very file that names it.
  const armA = z.object({ type: z.literal('probe-a') });
  const armB = z.object({ type: z.literal('probe-b') });
  const armC = z.object({ type: z.literal('probe-c') });
  const pair = z.discriminatedUnion('type', [armA, armB]);

  it('reports an arm whose re-export was dropped', () => {
    // The historical break, in miniature: `d908a82f4` deleted one line from the
    // barrel and left the module untouched.
    const census = censusOf(pair);
    const unnamed = census.arms.filter((arm) => namesOn({ ProbeASchema: armA }, arm).length === 0);
    expect(unnamed.flatMap((arm) => [...arm.literals])).toEqual(['probe-b']);
  });

  it('reports nothing when every arm is on the namespace', () => {
    // The other direction, so the control above is not just "this always fails".
    const census = censusOf(pair);
    const unnamed = census.arms.filter(
      (arm) => namesOn({ ProbeASchema: armA, ProbeBSchema: armB }, arm).length === 0,
    );
    expect(unnamed).toEqual([]);
  });

  it('still reports the arm when the PARENT union carries the arm name', () => {
    // ⭐ `export { NavigationSchema as BreadcrumbSchema }` passes a name-based
    // check and every behavioural leg of #8777's pin. The namespace below is
    // that write: the name is present and it is bound to the union, not to the
    // arm.
    const namespace = { ProbeASchema: armA, ProbeBSchema: pair };
    expect('ProbeBSchema' in namespace).toBe(true);
    const census = censusOf(pair);
    const unnamed = census.arms.filter((arm) => namesOn(namespace, arm).length === 0);
    expect(unnamed.flatMap((arm) => [...arm.literals])).toEqual(['probe-b']);
  });

  it('counts the arms of a NESTED union, not the nested union', () => {
    // The "13 arms / 2 literals" failure. A walk that stops at the outer
    // options sees two members here and two literals; this one sees three arms.
    const nested = z.discriminatedUnion('type', [pair, armC]);
    const census = censusOf(nested);
    expect(census.arms.length).toBe(3);
    expect(census.arms.flatMap((arm) => [...arm.literals]).sort()).toEqual([
      'probe-a',
      'probe-b',
      'probe-c',
    ]);
  });

  it('accepts either side of a `z.lazy` as the arm name, and neither is still unnamed', () => {
    // `z.union`, and ⛔ nothing forbids a discriminated one here — this comment
    // used to say a bare `z.lazy` member "computes no `propValues`, which zod 4
    // refuses as a discriminated option", and all three parts of that are wrong
    // on the zod version `packages/types/package.json` resolves today (4.4.3),
    // and on this repo's tsc (6.0.3):
    //  - a bare `z.lazy` over an object schema DOES compute `propValues` — it
    //    inherits its member's;
    //  - `z.discriminatedUnion('type', [lazyArm])` both type-checks and parses,
    //    green for the declared literal and red for anything else;
    //  - what zod 4.4.3 refuses as a discriminated option is a plain `z.union`
    //    MEMBER, which computes no `propValues` — and it refuses at the first
    //    PARSE, not at construction (`Invalid discriminated union option at
    //    index "N"`). That is the refusal `any-component-union-fanout.test.ts`
    //    measures, in `lets both nested unions declare their literals too`; ⛔ it
    //    measures nothing about a lazy.
    // ⚠️ Nor is the real tree's cast owed to `z.lazy`: `crud.zod.ts`'s action arm
    // needs one because of its maintainer-ruled `z.ZodType<…>` annotation
    // (objectui#7760), whose internals type `propValues` as `PropValues |
    // undefined` — the annotation, not the lazy, is what `tsc` cannot see
    // through. `censusOf` reads `def.type === 'union'`, which a discriminated
    // union also is, so this choice changes nothing either way; what matters
    // here is only which objects count as the arm's identity.
    const lazyArm = z.lazy(() => armC);
    const lazyUnion = z.union([lazyArm]);
    const unnamedAgainst = (namespace: Readonly<Record<string, unknown>>) =>
      censusOf(lazyUnion).arms.filter((arm) => namesOn(namespace, arm).length === 0).length;
    expect(unnamedAgainst({ LazyProbeSchema: lazyArm })).toBe(0);
    expect(unnamedAgainst({ ProbeCSchema: armC })).toBe(0);
    expect(unnamedAgainst({ SomethingElseSchema: armA })).toBe(1);
  });
});
