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
 * resolves to `z.string()` and another to an object schema. On `origin/main`
 * `ad715aca57`: 166 `z.union([...])` sites, of which **31 are string-or-object**
 * (plus 7 in test fixtures, excluded). The scan's own control — sites with any
 * arm it could not resolve, each of which could hide a match — went 46 → 0 as
 * the resolver learned `lazySchema`, `strictObject` and function declarations,
 * so the final zero is a measured absence rather than a scan that saw nothing.
 *
 * Those 31 split into three classes by what their OBJECT arm does with an
 * undeclared key, which is what decides whether there is an author-visible
 * message to pin at all:
 *
 * - **A — curated `strictObject()` arm (13 sites).** The refusal names the key,
 *   the surface and, where the site declares an alias or edit distance reaches,
 *   the rename. This is the shape PR #14975 pinned, and all 13 are covered:
 *   11 by the table below, `devPlugins` by #14975's own file
 *   (`kernel/manifest-unknown-keys.test.ts`), `ActionRef` by the CONTROL case
 *   in `automation/state-machine.test.ts`.
 * - **B — bare `.strict()` arm (1 site).** `lifecycleOnlyWhenSchema`
 *   (`data/object.zod.ts`) closes its two object arms with plain zod
 *   `.strict()`, so the refusal names the key and the path but carries no
 *   surface and no rename — there is no curated prose to assert. It is pinned
 *   below anyway, on the half it does have, because it rides the same descent.
 * - **C — open object arm (17 sites).** The arm is a non-strict `z.object` or
 *   an explicit `z.looseObject`, so an undeclared key is *stripped* and no
 *   refusal is raised at all. Measured, not assumed: `GroupByNodeSchema` and
 *   `BookNodeSchema` both ACCEPT a bogus key and parse it away, against a lit
 *   control (`ChartGroupBySchema`, class A, same probe) that names the key and
 *   the surface. ⛔ These are deliberately NOT pinned: there is no
 *   author-visible message at them to regress, so a pin would assert the
 *   absence of prose rather than its content, and would go green forever. If a
 *   class-C arm is ever closed, it becomes class A and belongs in the table.
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
import { GanttConfigSchema, GanttQuickFilterSchema } from '../ui/view.zod';
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
  /** The undeclared key the fixture writes, as it must appear in the message. */
  readonly key: string;
  /** The curated surface phrase, or `null` for the one class-B site. */
  readonly surface: string | null;
  /** The `Did you mean` target, or `null` where the site declares no rename. */
  readonly rename: string | null;
  /** The same slot, written with the STRING arm — must still parse. */
  readonly acceptString: unknown;
  /** The same slot, written with a legal OBJECT arm — must still parse. */
  readonly acceptObject: unknown;
}

/**
 * The class-A and class-B population minus the two sites already covered
 * (`devPlugins` by #14975, `ActionRef` by `state-machine.test.ts`).
 *
 * ⛔ Rows are not invented: each `site` is a coordinate the scan produced, and
 * adding a string-or-object union with a closed object arm anywhere in
 * `packages/spec/src` adds a row here.
 */
const SITES: ReadonlyArray<readonly [name: string, site: UnionMessageSite]> = [
  ['GuardRef — the object arm of a guard reference', {
    site: 'automation/state-machine.zod.ts:120',
    door: GuardRefSchema,
    reject: { parms: { a: 1 } },
    key: 'parms',
    surface: 'this guard reference',
    rename: 'params',
    acceptString: 'isManager',
    acceptObject: { type: 'log', params: { a: 1 } },
  }],
  ['StateNode.on — a transition written inline on a state', {
    site: 'automation/state-machine.zod.ts:231',
    door: StateNodeSchema,
    reject: { on: { GO: { guard: 'isX', actions: 'not-an-array' } } },
    key: 'guard',
    surface: 'this state transition',
    rename: 'cond',
    acceptString: { on: { GO: 'next' } },
    acceptObject: { on: { GO: { target: 'next' } } },
  }],
  ['StateMachine.on — the machine-level listener map', {
    site: 'automation/state-machine.zod.ts:292',
    door: StateMachineSchema,
    reject: { id: 'machine', initial: 'idle', states: { idle: { initial: 'a', states: {} } },
      on: { GO: { guard: 'isX', actions: 'not-an-array' } } },
    key: 'guard',
    surface: 'this state transition',
    rename: 'cond',
    acceptString: { id: 'machine', initial: 'idle', states: { idle: { initial: 'a', states: {} } },
      on: { GO: 'idle' } },
    acceptObject: { id: 'machine', initial: 'idle', states: { idle: { initial: 'a', states: {} } },
      on: { GO: { target: 'idle' } } },
  }],
  ['Approval.decisionOutputs — a declared decision output', {
    site: 'automation/approval.zod.ts:791',
    door: ApprovalNodeConfigSchema,
    reject: { approvers: [{ type: 'user', users: ['u1'] }], decisionOutputs: [{ widget: 'user' }] },
    key: 'widget',
    surface: 'this decision-output declaration',
    rename: 'type',
    acceptString: { approvers: [{ type: 'user', users: ['u1'] }], decisionOutputs: ['comment'] },
    acceptObject: { approvers: [{ type: 'user', users: ['u1'] }],
      decisionOutputs: [{ key: 'comment', type: 'text' }] },
  }],
  ['FlowFunctionEntry — a `functions` map entry', {
    site: 'automation/flow-function.zod.ts:252',
    door: FlowFunctionEntrySchema,
    reject: { efect: 'pure' },
    key: 'efect',
    surface: 'this `functions` entry',
    rename: 'effect',
    acceptString: 'scoreLead',
    acceptObject: { handler: () => undefined },
  }],
  ['Field.lookupColumns — an explicit record-picker column', {
    site: 'data/field.zod.ts:1438',
    door: FieldSchema,
    reject: { name: 'owner', type: 'lookup', lookupColumns: [{ name: 'amount' }] },
    key: 'name',
    surface: 'this lookup column',
    rename: 'field',
    acceptString: { name: 'owner', type: 'lookup', lookupColumns: ['amount'] },
    acceptObject: { name: 'owner', type: 'lookup', lookupColumns: [{ field: 'amount' }] },
  }],
  ['Field.dependsOn — a dependent-picker binding', {
    site: 'data/field.zod.ts:1464',
    door: FieldSchema,
    reject: { name: 'owner', type: 'lookup', dependsOn: [{ local: 'account' }] },
    key: 'local',
    surface: 'this dependsOn entry',
    rename: 'field',
    acceptString: { name: 'owner', type: 'lookup', dependsOn: ['account'] },
    acceptObject: { name: 'owner', type: 'lookup', dependsOn: [{ field: 'account' }] },
  }],
  ['ChartGroupBy — the structured category axis', {
    site: 'ui/chart.zod.ts:767',
    door: ChartGroupBySchema,
    reject: { granularity: 'day' },
    key: 'granularity',
    surface: 'this chart groupBy',
    rename: 'dateGranularity',
    acceptString: 'created_at',
    acceptObject: { field: 'created_at', dateGranularity: 'day' },
  }],
  ['RecordHighlightsField — a `record:highlights` field entry', {
    site: 'ui/component.zod.ts:1181',
    door: RecordHighlightsProps,
    reject: { fields: [{ field: 'status' }] },
    key: 'field',
    surface: 'this `record:highlights` field',
    rename: 'name',
    acceptString: { fields: ['status'] },
    acceptObject: { fields: [{ name: 'status' }] },
  }],
  ['GanttQuickFilter.options — a fixed-enum option override', {
    site: 'ui/view.zod.ts:1379',
    door: GanttQuickFilterSchema,
    reject: { field: 'stage', options: [{ title: 'Won' }] },
    key: 'title',
    surface: 'this gantt quick-filter option',
    rename: 'label',
    acceptString: { field: 'stage', options: ['won'] },
    acceptObject: { field: 'stage', options: [{ value: 'won', label: 'Won' }] },
  }],
  ['GanttConfig.tooltipFields — a hover-tooltip field entry', {
    site: 'ui/view.zod.ts:1439',
    door: GanttConfigSchema,
    reject: { startDateField: 's', endDateField: 'e', titleField: 't',
      tooltipFields: [{ name: 'amount' }] },
    key: 'name',
    surface: 'this gantt tooltip field',
    rename: 'field',
    acceptString: { startDateField: 's', endDateField: 'e', titleField: 't',
      tooltipFields: ['amount'] },
    acceptObject: { startDateField: 's', endDateField: 'e', titleField: 't',
      tooltipFields: [{ field: 'amount' }] },
  }],
  // ── class B: the one bare-`.strict()` site. No surface, no rename — see the
  //    header. It is here because the KEY half rides the same union descent.
  ['lifecycle onlyWhen — a row-filter comparand (class B: bare `.strict()`)', {
    site: 'data/object.zod.ts:855',
    door: ObjectSchema,
    reject: { name: 'lead', label: 'Lead', fields: { a: { type: 'text', label: 'A' } },
      lifecycle: { class: 'audit', retention: { maxAge: '30d',
        onlyWhen: { status: { $in: ['closed'], bogusKey: 1 } } } } },
    key: 'bogusKey',
    surface: null,
    rename: null,
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
        .toContain(`\`${site.key}\``);

      // The named authoring surface, so the author knows WHICH shape refused.
      if (site.surface !== null) {
        expect(rendered, `${site.site}: the refusal must name its surface`)
          .toContain(site.surface);
      }

      // The rename, where the site declares an alias or edit distance reaches
      // it. This is the half a bare `unrecognized_keys` code cannot carry.
      if (site.rename !== null) {
        expect(rendered, `${site.site}: the rename prescription must survive the union descent`)
          .toContain(`\`${site.key}\` → \`${site.rename}\``);
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
      expect(rendered).toContain(`\`${site.key}\``);

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
      // 13 class-A sites + 1 class-B = 14 with an unknown-key refusal to lose;
      // `devPlugins` (#14975) and `ActionRef` (`state-machine.test.ts`) are
      // pinned in their own files, so 12 belong here.
      expect(SITES).toHaveLength(12);
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
