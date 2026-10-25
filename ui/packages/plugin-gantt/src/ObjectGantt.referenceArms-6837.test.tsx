/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6837 (second slice) — the gantt quick-filter's relationship-target
 * chain drops the arm NO CONTRACT DECLARES, and keeps the two that carry the
 * value.
 *
 * Before:  `fd?.reference_to ?? fd?.reference ?? fd?.referenceTo`
 * After:   `fd?.reference_to ?? fd?.reference`
 *
 * Form copied from `RecordDetailDrawer.referenceArms-6837.test.tsx` (PR #6920),
 * which copied it from PR #6916 / card #6840. ⛔ Do not invent a second form.
 *
 * ## 1. The measurement this pin stands on (not just its conclusion)
 *
 * THE CELL: a value inside an object schema's `fields` container — literally
 * what this component reads, `objectSchema.fields[name]`. Producer census by
 * STRUCTURE WALK (TypeScript compiler API over every tracked `.ts`/`.tsx`, plus
 * parsed JSON), recording each hit's ancestor property chain; EMIT positions
 * only (`PropertyAssignment` / `ShorthandPropertyAssignment`), so `fd.referenceTo`
 * — a `PropertyAccessExpression`, i.e. a READ — is never counted as a producer,
 * and a `PropertySignature` is bucketed as a DECLARATION, never as one either.
 * Subject and control were extracted BY THE SAME PASS, FROM THE SAME CELLS, IN
 * THE SAME UNITS, so the control sits on the JOIN and not merely on the terms.
 *
 *   | term           | role    | repo-wide emits  | IN THE CELL |
 *   |----------------|---------|------------------|-------------|
 *   | `referenceTo`  | SUBJECT |  81 /  42 files  | **2** / 2   |
 *   | `reference`    | CONTROL | 195 /  76 files  |  92 / 36    |
 *   | `reference_to` | CONTROL | 137 /  88 files  |  52 / 36    |
 *
 * Both halves of the control discipline. (1) THE QUERY RAN: the controls are
 * hot — 92 and 52 — in the very cells where the subject collapses to 2, from
 * the same pass. (2) THE QUESTION WAS RIGHT: a mis-posed cell would have moved
 * subject and control together; instead it separates 92-to-2. Third check, the
 * one only this key affords: `referenceTo` is not a term the scanner cannot
 * see — it is hot repo-wide at 81 emits across 42 files, and collapses to 2
 * only under the cell restriction. The zero-ish is produced by the RESTRICTION,
 * not by scanner blindness.
 *
 * The two surviving in-cell hits are NEGATIVE fixtures of the retirement
 * machinery itself (`object-fields-io.spec-keys.test.ts:235`,
 * `MetadataFieldsPage.specKeyReference.test.tsx:75`): they poison a draft with
 * the retired key precisely to assert the read door STRIPS it before
 * `ObjectSchema.safeParse` sees it. A fixture asserting removal is not a
 * producer.
 *
 * SEAM-LOCAL control, the one this file owes over and above the repo-wide pass:
 * `plugin-gantt` contains **zero** `referenceTo` emits at any position, in any
 * cell — while its own fixture corpus is hot on both surviving spellings
 * (`ObjectGantt.quickfilter.test.tsx:251` emits `reference_to`, `:306` emits
 * `reference`, `demo/main.tsx:334-335` emit `reference_to`). So the corpus that
 * actually feeds THIS reader is hot on what survives and empty on what goes.
 *
 * ## 2. Why refusal is correct, not merely unused-today
 *
 * `@objectstack/spec` 17.2.0's `FieldSchema` (`@objectstack/spec/data`), probed
 * two-directionally on this branch's installed copy:
 *
 *   - `reference: 'crm_account'`     → ACCEPT
 *   - `reference_to: 'crm_account'`  → REFUSE, `unrecognized_keys`
 *   - `referenceTo: 'crm_account'`   → REFUSE, `unrecognized_keys`,
 *     "Did you mean `referenceTo` → `reference`?"
 *
 * The alias entry is a RENAME HINT ATTACHED TO A REFUSAL, not an acceptance:
 * the spec names `referenceTo` explicitly in order to refuse it. `referenceTo`
 * is additionally a tombstone in `RETIRED_FIELD_KEY_TOMBSTONES`
 * (`@object-ui/types/internal/retired-field-keys`, `retiredBy: 'objectui#6041'`,
 * `specEquivalent: 'reference'`) at all three strip sites, so the designer read
 * door removes it before a draft round-trips. So this arm was not a "redundant"
 * fallback: it was INVENTED tolerance surface — a silent absorption point for a
 * producer that ought to fail visibly (AGENTS.md #0.1).
 *
 * ⚠️ What this does NOT rest on: any claim that no production producer of
 * `reference_to` exists. That question cannot be answered from inside this repo
 * — restricting the cell to production files collapses the CONTROL too, and
 * this repo is a UI library, not a metadata-app repo. `reference_to` and
 * `reference` are therefore deliberately untouched here; see §4.
 *
 * ## 3. No precedence inversion exists here — stated rather than fabricated
 *
 * The deleted arm sat at the END of the chain
 * (`reference_to ?? reference ?? referenceTo`), so it could never preempt a
 * contract-carrying spelling. There is therefore NO inversion case to pin, and
 * this file deliberately does not invent one: a
 * `{ reference: 'projects', referenceTo: 'other' }` case resolves to
 * `'projects'` both before and after the change and would measure nothing.
 * (Same call, for the same reason, as PR #6916 and PR #6920.)
 *
 * ## 4. THE FLOOR, restated where someone would try to re-widen it
 *
 * ⛔ Do not re-add a spelling arm to this chain. A producer emitting a refused
 * spelling is fixed AT THE PRODUCER, or canonicalised ONCE at the ingestion
 * choke point — `normalizeSchemaReferenceKeys`, which folds a legacy spelling
 * onto `reference`. Never a renderer-side alias: that is how ~20 per-consumer
 * dual-key fallbacks got written under a normalizer whose own docstring said
 * it existed "so per-consumer dual-key fallbacks can't drift".
 *
 * ⭐ THAT OPEN SCOPE IS NOW CLOSED FOR THIS READER — objectui#6837 half 2.
 * Maintainer ruling 2026-08-31 (第 6 场总监席决裁批 #14), 原文照录:
 * "objectui不是前端的项目吗?后端的元数据只要对,前端按协议执行就行了呀".
 * Protocol normalization belongs on the SERVER. objectstack#13847 landed that
 * half — a `field-reference-to-alias` conversion rewrites stored
 * `reference_to` -> `reference` on the serve path and in `os migrate meta` —
 * so this reader keeps ONE arm, `reference`, and the `reference_to` case below
 * moved from the live group to the refusal group.
 *
 * ⭐ The tier-boundary caveat this paragraph used to carry is now CLOSED too
 * (objectui#11070 round 4, the seat's answer A under the same ruling). It was
 * about ObjectUI's OWN contracts — `LookupFieldMetadata`,
 * `DetailViewFieldSchema` and the `FieldMetadata` bag — which declared
 * `reference_to`, so the three widget-seam readers of that bag
 * (`fields/src/index.tsx#LookupCellRenderer`, `widgets/LookupField.tsx`,
 * `widgets/UserField.tsx`) were not narrowed by half 2. Round 4 moved those
 * contracts, their in-repo producers and those readers to `reference` in one
 * step, and `plugin-grid`'s `relationalMetaCopySet.derivation.test.ts` gate
 * dropped its `reference_to` row with them.
 *
 * ## 5. Ablation direction, predicted before running
 *
 * Restore the deleted arm on the committed tree and the refusal below goes RED
 * while every live-arm control stays GREEN — that contrast is what makes the
 * controls controls rather than duplicates of the pins. MODULE RESOLUTION: this
 * file imports the component by RELATIVE SOURCE PATH (`./ObjectGantt`) and
 * `@object-ui/core` is aliased by the root `vitest.config.mts` to
 * `packages/core/src`, so both legs resolve to SOURCE — no package `exports`
 * hop, no `dist`, and therefore NO REBUILD LEG to get wrong.
 */
import React from 'react';
import { render, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';
import { ObjectGantt } from './ObjectGantt';

afterEach(cleanup);

/**
 * GanttView is mocked to a thin shell that surfaces the task count, exactly as
 * `ObjectGantt.quickfilter.test.tsx` does — the resolved target is a property
 * of the option fetch, not of how GanttView paints bars.
 */
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view" data-count={tasks.length} />
  ),
}));

/** Both loaded rows point at `p1`, so `p2`/`p3` can only come from the lookup domain. */
const TASKS = [
  { id: '1', name: 'Alpha', start: '2024-01-01', end: '2024-01-05', project: 'p1' },
  { id: '2', name: 'Beta', start: '2024-02-01', end: '2024-02-10', project: 'p1' },
];

/** The referenced object's full domain — reachable ONLY by resolving the target. */
const PROJECTS = [
  { id: 'p1', name: 'Apollo' },
  { id: 'p2', name: 'Borealis' },
  { id: 'p3', name: 'Cygnus' },
];

/** Every probe is a `lookup`, so only the target SPELLING varies between them. */
const FIELD_DEFS: Record<string, Record<string, unknown>> = {
  // Live arm — the ONE spelling the protocol declares. objectui#6837 half 2
  // deleted the `reference_to` arm too, so this is now the whole accept set.
  spec_spelling: { type: 'lookup', reference: 'projects' },
  // Deleted arms — both refused by `FieldSchema` by NAME, each with its own
  // "did you mean -> `reference`?" rename.
  legacy_snake: { type: 'lookup', reference_to: 'projects' },
  legacy_camel: { type: 'lookup', referenceTo: 'projects' },
};

function makeDataSource(projectDef: Record<string, unknown>) {
  return {
    find: vi.fn(async (object: string) =>
      object === 'projects' ? { data: PROJECTS } : { data: TASKS },
    ),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'task',
      fields: {
        name: { type: 'text' },
        start: { type: 'date' },
        end: { type: 'date' },
        project: projectDef,
      },
    }),
  } as any;
}

const GANTT_SCHEMA = {
  type: 'gantt',
  objectName: 'task',
  startDateField: 'start',
  endDateField: 'end',
  titleField: 'name',
  quickFilters: [{ field: 'project', label: 'Project' }],
} as any;

/**
 * Mount over one field def and wait for the SCHEMA-DEPENDENT commit to happen.
 *
 * The settle signal is deliberately spelling-INDEPENDENT: once `objectSchema`
 * lands, the record query is re-issued carrying `$expand`, and
 * `buildExpandFields` decides that from the field's `type` alone ("the
 * `reference` / `reference_to` target is irrelevant to the decision"). So a
 * `find('task', { $expand: [...] })` call proves the component consumed this
 * schema — for the refusal probe just as much as for the live-arm ones. The
 * option-fetch effect shares that commit and runs synchronously up to its own
 * `find`, so by the time this resolves, a resolving arm has ALREADY recorded
 * `find('projects', …)`.
 */
async function mount(projectDef: Record<string, unknown>) {
  const ds = makeDataSource(projectDef);
  const view = render(<ObjectGantt schema={GANTT_SCHEMA} dataSource={ds} />);
  await waitFor(() =>
    expect(
      ds.find.mock.calls.some((c: any[]) => c[0] === 'task' && c[1]?.$expand?.includes('project')),
    ).toBe(true),
  );
  return { ds, view };
}

/** Did the component resolve a target, i.e. fetch the referenced object's domain? */
const fetchedDomain = (ds: any) =>
  ds.find.mock.calls.some((c: any[]) => c[0] === 'projects');

describe('ObjectGantt resolves only contract-declared target spellings (objectui#6837)', () => {
  describe('live arms — the value still arrives (without these, a gantt that stopped resolving anything would pass the refusal too)', () => {
    it('resolves `reference`, the spelling `FieldSchema` accepts', async () => {
      const { ds } = await mount(FIELD_DEFS.spec_spelling);
      await waitFor(() => expect(fetchedDomain(ds)).toBe(true));
    });

    it('a resolved target widens the dropdown to the FULL domain, past the loaded rows', async () => {
      // The user-visible half: `p2`/`p3` exist only on the referenced object.
      const { ds, view } = await mount(FIELD_DEFS.spec_spelling);
      await waitFor(() => expect(fetchedDomain(ds)).toBe(true));
      await waitFor(() => {
        fireEvent.click(view.getByTestId('quick-filter-trigger-project'));
        const panel = view.getByTestId('quick-filter-panel-project');
        expect(within(panel).getByTestId('quick-filter-option-project-p3')).toBeTruthy();
      });
    });
  });

  describe('refusals — one named case per deleted key', () => {
    it('does NOT read `reference_to` (objectui#6837 half 2: `FieldSchema` refuses it by name with its own rename hint; objectstack#13847 normalizes it away on the serve path)', async () => {
      const { ds } = await mount(FIELD_DEFS.legacy_snake);
      expect(fetchedDomain(ds)).toBe(false);
    });

    it('does NOT read `referenceTo` (RETIRED_FIELD_KEY_TOMBSTONES, objectui#6041/#6519; `FieldSchema` refuses it by name)', async () => {
      const { ds } = await mount(FIELD_DEFS.legacy_camel);
      expect(fetchedDomain(ds)).toBe(false);
    });

    it('and degrades to the distinct loaded values rather than rendering nothing', async () => {
      // Guards the refusal above against the degenerate pass: a gantt that
      // rendered no quick filter at all would also never fetch `projects`.
      //
      // ⚠️ ASYNC reads, deliberately (objectui#6959). `mount()` settles on a
      // MOCK CALL — `find('task', { $expand })` was ISSUED — and that is one
      // promise resolution EARLIER than the `setLoading(false)` in `reload()`'s
      // `finally`. So on return from `mount()` `ObjectGantt` may still be
      // painting its `loading` branch (`Loading Gantt chart...`), and a
      // SYNCHRONOUS `getByTestId` here races it. It lost that race twice in
      // fifteen minutes in the merge queue — a heavier runner than PR CI —
      // ejecting two PRs that do not touch `plugin-gantt` at all.
      //
      // `mount()`'s find-call gate STAYS: the refusal probe needs proof of the
      // SCHEMA-dependent commit, and `gantt-view` alone does not carry it —
      // `loading` flips false after the FIRST `find()` resolves, which happens
      // before `objectSchema` lands. The two gates measure different facts, so
      // this block waits for both rather than trading one for the other.
      const { ds, view } = await mount(FIELD_DEFS.legacy_camel);
      const chart = await view.findByTestId('gantt-view');
      expect(chart.getAttribute('data-count')).toBe('2');
      fireEvent.click(await view.findByTestId('quick-filter-trigger-project'));
      const panel = view.getByTestId('quick-filter-panel-project');
      expect(within(panel).getByTestId('quick-filter-option-project-p1')).toBeTruthy();
      expect(within(panel).queryByTestId('quick-filter-option-project-p3')).toBeNull();
      expect(fetchedDomain(ds)).toBe(false);
    });
  });

  describe('the ingestion choke point is what makes the deletion lossless', () => {
    it('a `referenceTo`-only def that came through `normalizeSchemaReferenceKeys` STILL resolves', async () => {
      // The mechanism, not a formality: the normalizer folds a legacy
      // `reference_to` / `referenceTo` onto `reference`, so every def that
      // entered through `MetadataProvider` or
      // `ObjectStackAdapter.getObjectSchema` already carries `reference` by
      // the time this component sees it. The deleted arm was dead weight there.
      //
      // ⚠️ And this is exactly why the pin above still matters: the door is
      // NOT total. `getObjectSchema` is a required member of the published
      // `DataSource` interface and this component calls it on the generic
      // `dataSource`, so a third-party implementation reaches this reader raw.
      const def = { ...FIELD_DEFS.legacy_camel };
      const schema = { name: 'task', fields: { project: def } };
      normalizeSchemaReferenceKeys(schema);
      const { ds } = await mount(schema.fields.project as Record<string, unknown>);
      await waitFor(() => expect(fetchedDomain(ds)).toBe(true));
    });
  });
});
