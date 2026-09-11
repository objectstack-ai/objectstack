// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15423] The AUTHOR-VISIBLE message at every string-or-object union site that
 * has an unknown-key refusal to lose.
 *
 * ## Why this file exists
 *
 * #14722 asserted that a `devPlugins[]` refusal reaches the author keyless.
 * Measured, it does not — `formatZodIssue` descends `invalid_union`, ranks the
 * branches through `selectUnionBranches` (`./union-branch-policy.ts`, #8318),
 * drops the string arm as kind-mismatch-only and renders the object branch
 * verbatim. But **nothing pinned that**, so the rendered half was re-reported
 * as a defect, and rediscovering that the code was already correct cost a
 * grading, a dispatch and a whole PR. PR #14975 closed the gap for that ONE
 * site; every other site in the family was still in the state `devPlugins` was
 * in. This file is the rest of the family.
 *
 * ## The distinction the whole thing turns on
 *
 * **A pin on the raw issue shape and a pin on the rendered message measure
 * different halves, and only one of them is what an author experiences.**
 * `devPlugins` had the first and not the second, which is exactly why it read
 * as broken. Several sites below had the same split — `RecordHighlightsField`
 * and `ActionRef`/`GuardRef` each carry a careful raw-shape pin elsewhere in
 * the tree, and neither carried a rendered-message one. A raw-shape pin stays
 * green through a regression in the descent, because the descent is not what it
 * reads.
 *
 * ## The population, and how it was derived
 *
 * Mechanically, from the tree — never a hand-built list. Every `z.union([...])`
 * call in `packages/spec/src` was parsed with the TypeScript compiler API and
 * its arms classified, resolving named arms through the tree's own declarations
 * and through `lazySchema()` / `strictObject()`; a site qualifies when one arm
 * resolves to `z.string()` and another to an object schema. Anchored to
 * `origin/main` `ad715aca57` (this branch's point of departure) and re-derived
 * unchanged on each later merge of `main`: **166** `z.union([...])` sites, of
 * which **32 are string-or-object** (plus 7 in test fixtures, excluded).
 *
 * The scan's own control — sites with any arm it could not resolve, each of
 * which could hide a match — went **46 → 0** as the resolver learned
 * `lazySchema`, `strictObject` and function declarations. That is what makes
 * the final zero a measured absence rather than a scan that saw nothing: the
 * control was demonstrably lit before it was cleared.
 *
 * ⚠️ **A cleared control is not a complete scan, and this file learned that the
 * hard way.** The first pass of this scan read 31, not 32. It resolved
 * `lazySchema(() => …)` only when the arrow body was an EXPRESSION, so
 * `FormFieldBaseSchema` — whose `lazySchema` arrow has a BLOCK body — fell out
 * as unclassifiable rather than as an object, and `ui/view.zod.ts:2895` never
 * reached the population at all. Its unresolved-arm control was zero throughout,
 * because the arm resolved to *something*; it was just the wrong something. A
 * second, independent re-derivation by a different method (a brace-matching
 * scanner) found the site, and it was settled by BEHAVIOUR rather than by either
 * scanner's syntax: the door is refused and the refusal renders curated prose.
 * ⇒ Two lessons encoded here: the class of a site is decided by what it RENDERS,
 * and one scanner agreeing with itself across three merge bases is not
 * independent evidence.
 *
 * Those 32 split into three classes by what their OBJECT arm does with an
 * undeclared key, which is what decides whether there is curated prose to pin:
 *
 * - **A — closed AND curated arm (14 sites).** The refusal names the key, the
 *   surface and, where the site declares an alias or edit distance reaches, the
 *   rename. This is the shape PR #14975 pinned. All 14 are covered: 12 by the
 *   table below, `devPlugins` by #14975's own file
 *   (`kernel/manifest-unknown-keys.test.ts`), `ActionRef` by the CONTROL case
 *   in `automation/state-machine.test.ts`.
 *
 *   ⚠️ Curation and closure are INDEPENDENT, which is the trap. Thirteen of the
 *   14 spell both at once with `strictObject()`. `ui/view.zod.ts:2895` splits
 *   them: `FormFieldBaseSchema` takes a `strictObjectError({ surface: 'this
 *   form field', … })` map WITHOUT closing the shape (#6619), and
 *   `FormFieldSchema` closes it one level up with a plain `.strict()`. A
 *   classifier that reads `strictObject()` calls alone therefore files it as
 *   class B and under-states its message. `strictObjectError(` has exactly ONE
 *   call site in the tree, so this pair has exactly one member today.
 * - **B — closed but UNCURATED arm (1 site).** `lifecycleOnlyWhenSchema`
 *   (`data/object.zod.ts:855`) closes its two object arms with plain zod
 *   `.strict()` and carries no error map, so the refusal names the key and the
 *   path but no surface and no rename. It is pinned below on the half it has,
 *   because it rides the same descent.
 * - **C — open object arm (17 sites).** The arm is a non-strict `z.object` or
 *   an explicit `z.looseObject`, so an **undeclared key is stripped** and no
 *   unknown-key refusal is raised. Measured, not assumed: `GroupByNodeSchema`
 *   and `BookNodeSchema` both ACCEPT a bogus key and parse it away, against a
 *   lit control (`ChartGroupBySchema`, class A, same probe) that names the key
 *   and the surface.
 *
 *   ⛔ **What is NOT true of them — the narrower claim is the correct one.**
 *   A class-C site is not silent in general: a wrong-typed or bad-enum
 *   **declared** key IS refused there and IS rendered through this very
 *   descent. Measured — `GroupByNodeSchema.safeParse({ field: 123 })` renders
 *   `✗ (root): Invalid input` then `✗ field: Invalid input: expected string,
 *   received number`, with the string arm dropped; `{ dateGranularity:
 *   'fortnight' }` and `ExpressionInputSchema` `{ dialect: 'cel', source: 5 }`
 *   behave the same way. So what these 17 lack is **curated unknown-key prose
 *   to pin**, not an author-visible message. They are excluded on that narrower
 *   ground: there is no surface phrase and no rename at them, so the pin shape
 *   this file applies has nothing to assert. Their rendered half is covered
 *   GENERICALLY rather than per site, by `shared/error-map.test.ts` (`:226`
 *   nests a union inside a union with open `z.object` arms; `:307-329` walks
 *   four open-armed levels), which pins the same descent on the same arm shape.
 *   Whether that generic coverage is enough, or whether these want per-site
 *   pins, is a scope question this file does not settle.
 *
 *   The 17, so the exclusion set is auditable here without re-deriving it:
 *   `api/protocol.zod.ts:2853` · `data/data-engine.zod.ts:140` ·
 *   `data/field-value.zod.ts:459` · `data/field-value.zod.ts:555` ·
 *   `data/filter.zod.ts:405` · `data/query.zod.ts:200` · `data/query.zod.ts:537` ·
 *   `shared/expression.zod.ts:178` · `shared/expression.zod.ts:242` ·
 *   `shared/expression.zod.ts:349` · `shared/expression.zod.ts:384` ·
 *   `system/book.zod.ts:31` · `system/book.zod.ts:48` ·
 *   `system/metrics.zod.ts:430` · `system/tracing.zod.ts:347` ·
 *   `ui/action.zod.ts:825` · `ui/component.zod.ts:1593`.
 *
 *   If a class-C arm is ever closed AND curated, it becomes class A and belongs
 *   in the table.
 *
 * ⭐ **Every message asserted below was MEASURED before it was written**, and
 * every one of them was already correct. This file changes no behaviour: the
 * deliverable is COVERAGE, not repair.
 *
 * ## What each site is pinned for — the three pins, per #14975
 *
 * 1. **The rendered message names the key, the surface and the rename.** This
 *    is the half that was missing. It reads `formatZodError`, the real
 *    `defineStack`/CLI door, not the raw issue tree.
 * 2. **Branch selection is structural, not an accident of one fixture.** Every
 *    fixture gives the object branch MORE THAN ONE issue, so a descent that
 *    happened to surface a single issue cannot pass for a working one; and the
 *    string arm's `expected string, received object` — a kind mismatch, not a
 *    prescription — must NOT be rendered.
 * 3. **The accept side is unmoved.** A bare string entry and a legal object
 *    entry both still parse at every site.
 */

import { describe, expect, it } from 'vitest';

import { ApprovalNodeConfigSchema } from '../automation/approval.zod';
import { FlowFunctionEntrySchema } from '../automation/flow-function.zod';
import { GuardRefSchema, StateMachineSchema, StateNodeSchema } from '../automation/state-machine.zod';
import { FieldSchema } from '../data/field.zod';
import { ObjectSchema } from '../data/object.zod';
import { GroupByNodeSchema } from '../data/query.zod';
import { ChartGroupBySchema } from '../ui/chart.zod';
import { RecordHighlightsProps } from '../ui/component.zod';
import { FormSectionSchema, GanttConfigSchema, GanttQuickFilterSchema } from '../ui/view.zod';
import { formatZodError } from './error-map.zod';

/** A door that renders through `formatZodError` — every schema below is one. */
interface Door {
  safeParse(value: unknown): { success: boolean; error?: unknown; data?: unknown };
}

interface UnionMessageSite {
  /** `<file>:<line>` of the `z.union([...])` call this row pins. */
  readonly site: string;
  /** The exported schema an author's value actually arrives at. */
  readonly door: Door;
  /**
   * A body whose OBJECT arm carries more than one issue — pin 2's structural
   * requirement. `issues` is how many the object branch raises, asserted so a
   * fixture cannot silently decay into a single-issue one.
   */
  readonly reject: unknown;
  /** The undeclared key the fixture writes. */
  readonly key: string;
  /**
   * The key exactly as the message spells it. Curated `strictObject()` refusals
   * backtick it (`` `foo` ``); zod's own bare-`.strict()` message double-quotes
   * it (`Unrecognized key: "foo"`). Pinning the SPELLING and not just the
   * substring is what keeps this from passing on a message that merely happens
   * to contain the letters.
   */
  readonly keyInMessage: string;
  /** The curated surface phrase, or `null` for the one class-B site. */
  readonly surface: string | null;
  /**
   * The rename prescription exactly as the message renders it, or `null` where
   * the site declares none.
   *
   * ⚠️ Spelled out per row rather than built from a `` `key` → `target` ``
   * template on purpose. The template was the first version, and it silently
   * assumed one rendering: `strictObject()`'s alias/edit-distance line really
   * does render that arrow, but `ui/view.zod.ts:2895` prescribes its rename as
   * an ADR-0089 **bullet** (`• If this is the conditional-visibility
   * predicate, the canonical key is ...`) and carries no arrow at all. A
   * template would have forced that row to declare `rename: null` and drop a
   * real prescription out of the pin — the assertion would still be green and
   * would be measuring less than it claims.
   */
  readonly renameInMessage: string | null;
  /** The same slot, written with the STRING arm — must still parse. */
  readonly acceptString: unknown;
  /** The same slot, written with a legal OBJECT arm — must still parse. */
  readonly acceptObject: unknown;
}

/**
 * The class-A and class-B population minus the two sites already covered
 * (`devPlugins` by #14975, `ActionRef` by `state-machine.test.ts`).
 *
 * ⛔ Rows are not invented: each `site` is a coordinate the scan produced.
 *
 * ⚠️ Nothing MECHANICALLY holds this table equal to the tree — `toHaveLength`
 * below pins the snapshot, not the derivation, so a string-or-object union
 * added with a closed object arm tomorrow makes no test red. Re-deriving is a
 * manual step, and the header says how. A standing guard that re-scans and
 * fails on an unpinned new site is the real fix and is deliberately left to its
 * own card, not asserted here as though it existed.
 */
const SITES: ReadonlyArray<readonly [name: string, site: UnionMessageSite]> = [
  ['GuardRef — the object arm of a guard reference', {
    site: 'automation/state-machine.zod.ts:120',
    door: GuardRefSchema,
    reject: { parms: { a: 1 } },
    key: 'parms',
    keyInMessage: '`parms`',
    surface: 'this guard reference',
    renameInMessage: '`parms` → `params`',
    acceptString: 'isManager',
    acceptObject: { type: 'log', params: { a: 1 } },
  }],
  ['StateNode.on — a transition written inline on a state', {
    site: 'automation/state-machine.zod.ts:231',
    door: StateNodeSchema,
    reject: { on: { GO: { guard: 'isX', actions: 'not-an-array' } } },
    key: 'guard',
    keyInMessage: '`guard`',
    surface: 'this state transition',
    renameInMessage: '`guard` → `cond`',
    acceptString: { on: { GO: 'next' } },
    acceptObject: { on: { GO: { target: 'next' } } },
  }],
  ['StateMachine.on — the machine-level listener map', {
    site: 'automation/state-machine.zod.ts:292',
    door: StateMachineSchema,
    reject: { id: 'machine', initial: 'idle', states: { idle: { initial: 'a', states: {} } },
      on: { GO: { guard: 'isX', actions: 'not-an-array' } } },
    key: 'guard',
    keyInMessage: '`guard`',
    surface: 'this state transition',
    renameInMessage: '`guard` → `cond`',
    acceptString: { id: 'machine', initial: 'idle', states: { idle: { initial: 'a', states: {} } },
      on: { GO: 'idle' } },
    acceptObject: { id: 'machine', initial: 'idle', states: { idle: { initial: 'a', states: {} } },
      on: { GO: { target: 'idle' } } },
  }],
  ['Approval.decisionOutputs — a declared decision output', {
    site: 'automation/approval.zod.ts:791',
    door: ApprovalNodeConfigSchema,
    reject: { approvers: [{ type: 'user', value: 'u1' }], decisionOutputs: [{ widget: 'user' }] },
    key: 'widget',
    keyInMessage: '`widget`',
    surface: 'this decision-output declaration',
    renameInMessage: '`widget` → `type`',
    acceptString: { approvers: [{ type: 'user', value: 'u1' }], decisionOutputs: ['comment'] },
    acceptObject: { approvers: [{ type: 'user', value: 'u1' }],
      decisionOutputs: [{ key: 'comment', type: 'text' }] },
  }],
  ['FlowFunctionEntry — a `functions` map entry', {
    site: 'automation/flow-function.zod.ts:252',
    door: FlowFunctionEntrySchema,
    reject: { efect: 'pure' },
    key: 'efect',
    keyInMessage: '`efect`',
    surface: 'this `functions` entry',
    renameInMessage: '`efect` → `effect`',
    acceptString: 'scoreLead',
    acceptObject: { handler: () => undefined },
  }],
  ['Field.lookupColumns — an explicit record-picker column', {
    site: 'data/field.zod.ts:1438',
    door: FieldSchema,
    reject: { name: 'owner', type: 'lookup', reference: 'account', lookupColumns: [{ name: 'amount' }] },
    key: 'name',
    keyInMessage: '`name`',
    surface: 'this lookup column',
    renameInMessage: '`name` → `field`',
    acceptString: { name: 'owner', type: 'lookup', reference: 'account', lookupColumns: ['amount'] },
    acceptObject: { name: 'owner', type: 'lookup', reference: 'account', lookupColumns: [{ field: 'amount' }] },
  }],
  ['Field.dependsOn — a dependent-picker binding', {
    site: 'data/field.zod.ts:1464',
    door: FieldSchema,
    reject: { name: 'owner', type: 'lookup', reference: 'account', dependsOn: [{ local: 'account' }] },
    key: 'local',
    keyInMessage: '`local`',
    surface: 'this dependsOn entry',
    renameInMessage: '`local` → `field`',
    acceptString: { name: 'owner', type: 'lookup', reference: 'account', dependsOn: ['account'] },
    acceptObject: { name: 'owner', type: 'lookup', reference: 'account', dependsOn: [{ field: 'account' }] },
  }],
  ['ChartGroupBy — the structured category axis', {
    site: 'ui/chart.zod.ts:767',
    door: ChartGroupBySchema,
    reject: { granularity: 'day' },
    key: 'granularity',
    keyInMessage: '`granularity`',
    surface: 'this chart groupBy',
    renameInMessage: '`granularity` → `dateGranularity`',
    acceptString: 'created_at',
    acceptObject: { field: 'created_at', dateGranularity: 'day' },
  }],
  ['RecordHighlightsField — a `record:highlights` field entry', {
    site: 'ui/component.zod.ts:1181',
    door: RecordHighlightsProps,
    reject: { fields: [{ field: 'status' }] },
    key: 'field',
    keyInMessage: '`field`',
    surface: 'this `record:highlights` field',
    renameInMessage: '`field` → `name`',
    acceptString: { fields: ['status'] },
    acceptObject: { fields: [{ name: 'status' }] },
  }],
  ['GanttQuickFilter.options — a fixed-enum option override', {
    site: 'ui/view.zod.ts:1379',
    door: GanttQuickFilterSchema,
    reject: { field: 'stage', options: [{ title: 'Won' }] },
    key: 'title',
    keyInMessage: '`title`',
    surface: 'this gantt quick-filter option',
    renameInMessage: '`title` → `label`',
    acceptString: { field: 'stage', options: ['won'] },
    acceptObject: { field: 'stage', options: [{ value: 'won', label: 'Won' }] },
  }],
  ['GanttConfig.tooltipFields — a hover-tooltip field entry', {
    site: 'ui/view.zod.ts:1439',
    door: GanttConfigSchema,
    reject: { startDateField: 's', endDateField: 'e', titleField: 't',
      tooltipFields: [{ name: 'amount' }] },
    key: 'name',
    keyInMessage: '`name`',
    surface: 'this gantt tooltip field',
    renameInMessage: '`name` → `field`',
    acceptString: { startDateField: 's', endDateField: 'e', titleField: 't',
      tooltipFields: ['amount'] },
    acceptObject: { startDateField: 's', endDateField: 'e', titleField: 't',
      tooltipFields: [{ field: 'amount' }] },
  }],
  // ── class A, the site a `strictObject()`-shaped classifier files as class B.
  //    `FormFieldBaseSchema` carries the curated map (`strictObjectError`,
  //    #6619) and `FormFieldSchema` closes the shape one level up with a plain
  //    `.strict()`, so the message is fully curated — surface AND rename —
  //    while the syntax looks bare. ⚠️ Its rename is an ADR-0089 guidance
  //    BULLET, not the `key → target` arrow every other row renders; that is
  //    why `renameInMessage` is a literal per row rather than a template.
  ['FormSection.fields — a form field entry (curated map + separate `.strict()`)', {
    site: 'ui/view.zod.ts:2895',
    door: FormSectionSchema,
    reject: { label: 'S', fields: [{ field: 'x', visibleWhenn: 'a', bogus: 1 }] },
    key: 'visibleWhenn',
    keyInMessage: '`visibleWhenn`, `bogus`',
    surface: 'this form field',
    renameInMessage: 'the canonical key is `visibleWhen`',
    acceptString: { label: 'S', fields: ['x'] },
    acceptObject: { label: 'S', fields: [{ field: 'x' }] },
  }],
  // ── class B: the one closed-but-uncurated site. No surface, no rename — see
  //    the header. It is here because the KEY half rides the same union descent.
  ['lifecycle onlyWhen — a row-filter comparand (class B: bare `.strict()`)', {
    site: 'data/object.zod.ts:855',
    door: ObjectSchema,
    reject: { name: 'lead', label: 'Lead', fields: { a: { type: 'text', label: 'A' } },
      lifecycle: { class: 'audit', retention: { maxAge: '30d',
        onlyWhen: { status: { $in: ['closed'], bogusKey: 1 } } } } },
    key: 'bogusKey',
    keyInMessage: 'Unrecognized key: "bogusKey"',
    surface: null,
    renameInMessage: null,
    acceptString: { name: 'lead', label: 'Lead', fields: { a: { type: 'text', label: 'A' } },
      lifecycle: { class: 'audit', retention: { maxAge: '30d', onlyWhen: { status: 'closed' } } } },
    acceptObject: { name: 'lead', label: 'Lead', fields: { a: { type: 'text', label: 'A' } },
      lifecycle: { class: 'audit', retention: { maxAge: '30d',
        onlyWhen: { status: { $in: ['closed'] } } } } },
  }],
];

/** Render a body through the real author-facing door. */
function render(site: UnionMessageSite, body: unknown): string {
  const result = site.door.safeParse(body);
  expect(result.success, `${site.site}: the fixture must be REFUSED for the pin to mean anything`)
    .toBe(false);
  return formatZodError(result.error as Parameters<typeof formatZodError>[0]);
}

describe('[#15423] the AUTHOR-VISIBLE message at a string-or-object union site', () => {
  // ── Pin 1 ─────────────────────────────────────────────────────────────────
  describe('pin 1 — the rendered message names the key, the surface and the rename', () => {
    it.each(SITES)('%s', (_name, site) => {
      const rendered = render(site, site.reject);

      // The key the author actually mistyped. This is the assertion #14722
      // believed would fail — the "keyless `Invalid input`" claim.
      expect(rendered, `${site.site}: the undeclared key must reach the author`)
        .toContain(site.keyInMessage);

      // The named authoring surface, so the author knows WHICH shape refused.
      if (site.surface !== null) {
        expect(rendered, `${site.site}: the refusal must name its surface`)
          .toContain(site.surface);
      }

      // The rename, where the site declares an alias, edit distance reaches it,
      // or a guidance bullet prescribes it. This is the half a bare
      // `unrecognized_keys` code cannot carry, and the row supplies the exact
      // rendered text — ⛔ never a template, see `renameInMessage`.
      if (site.renameInMessage !== null) {
        expect(rendered, `${site.site}: the rename prescription must survive the union descent`)
          .toContain(site.renameInMessage);
      }

      // ⛔ And it is genuinely the union door, not a non-union bypass: zod folds
      // every branch into one `invalid_union` whose own message is the literal
      // `Invalid input`, so that wrapper line is present above the prescription.
      expect(rendered, `${site.site}: the union wrapper line is what makes this a union door`)
        .toContain('Invalid input');
    });
  });

  // ── Pin 2 ─────────────────────────────────────────────────────────────────
  describe('pin 2 — branch selection is structural, not an accident of one fixture', () => {
    it.each(SITES)('%s', (_name, site) => {
      // Every fixture gives the OBJECT branch more than one issue. A descent
      // that only ever surfaced a lone issue would pass a single-issue fixture
      // while dropping real diagnoses here.
      const result = site.door.safeParse(site.reject) as {
        error: { issues: ReadonlyArray<{ code: string; errors?: ReadonlyArray<ReadonlyArray<unknown>> }> };
      };
      type Nested = { code: string; errors?: ReadonlyArray<ReadonlyArray<Nested>> };
      const flatten = (issues: ReadonlyArray<Nested>): Nested[] =>
        issues.flatMap((i) => [i, ...(i.errors ?? []).flat().flatMap((n) => flatten([n]))]);
      const union = flatten(result.error.issues as ReadonlyArray<Nested>)
        .find((i) => i.code === 'invalid_union');
      expect(union, `${site.site}: the refusal really is a union collapse`).toBeDefined();
      const branchIssues = (union!.errors ?? []).flat();
      expect(branchIssues.length,
        `${site.site}: the fixture must give the object branch MORE THAN ONE issue`)
        .toBeGreaterThan(1);

      // …and the whole selected branch is rendered, not just its first issue.
      const rendered = formatZodError(
        (result as unknown as { error: Parameters<typeof formatZodError>[0] }).error,
      );
      expect(rendered).toContain(site.keyInMessage);

      // ⛔ The string arm's complaint is a KIND mismatch, never a prescription,
      // and `selectUnionBranches` drops it. Rendering it is the "N branches, N
      // times the noise" failure the policy exists to prevent.
      expect(rendered, `${site.site}: the string arm's kind mismatch must not be rendered`)
        .not.toContain('expected string, received object');
    });
  });

  // ── Pin 3 ─────────────────────────────────────────────────────────────────
  describe('pin 3 — the accept side is unmoved', () => {
    it.each(SITES)('%s', (_name, site) => {
      expect(site.door.safeParse(site.acceptString).success,
        `${site.site}: the STRING arm must still parse`).toBe(true);
      expect(site.door.safeParse(site.acceptObject).success,
        `${site.site}: a legal OBJECT arm must still parse`).toBe(true);
    });
  });

  // ── Anti-vacuity ──────────────────────────────────────────────────────────
  //
  // Every assertion above is a `toContain` on a rendered string, so a renderer
  // that returned one long string containing every phrase would satisfy them
  // all. These two guard the table itself rather than any one site.
  describe('the table is not vacuous', () => {
    it('covers every site the scan found outside the two already pinned elsewhere', () => {
      // 14 class-A sites + 1 class-B = 15 with a curated-or-bare unknown-key
      // refusal to lose; `devPlugins` (#14975) and `ActionRef`
      // (`state-machine.test.ts`) are pinned in their own files, so 13 belong
      // here. ⚠️ This number certifies the population COMPLETE, which is why
      // the first pass getting it wrong mattered: at 12 it asserted, forever
      // and greenly, that `ui/view.zod.ts:2895` was not a member.
      expect(SITES).toHaveLength(13);
      // Each row names a distinct `z.union` coordinate.
      expect(new Set(SITES.map(([, s]) => s.site)).size).toBe(SITES.length);
    });

    it('CONTROL — a class-C (open) arm raises no refusal at all, which is why it is excluded', () => {
      // The header's exclusion, asserted rather than asserted-about. The same
      // probe, one undeclared key, two classes:
      //
      //   class C (`data/query.zod.ts:200`, a non-strict `z.object` arm) —
      //     the key is STRIPPED and the body parses, so there is no
      //     author-visible message at that site to pin or to regress;
      //   class A (`ui/chart.zod.ts:767`, the same shape closed) — refused,
      //     naming the key and the surface.
      //
      // Without the second half the first is just a schema that happened to
      // accept something; together they are the boundary this file draws.
      const openArm = GroupByNodeSchema.safeParse({ field: 'created_at', bogusKey: 1 });
      expect(openArm.success, 'class C: an undeclared key is stripped, not refused').toBe(true);
      expect(openArm.data, 'class C: and it is gone from the parsed value')
        .toEqual({ field: 'created_at' });

      const closedArm = ChartGroupBySchema.safeParse({ field: 'created_at', bogusKey: 1 });
      expect(closedArm.success, 'the lit control: a class-A arm DOES refuse').toBe(false);
      expect(formatZodError(closedArm.error as Parameters<typeof formatZodError>[0]))
        .toContain('this chart groupBy');
    });
  });
});
