// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ConditionBuilder`'s SUBJECT DROPDOWN may not offer a root the engine
 * refuses — objectui#9855, the second door of objectui#9645.
 *
 * ## The defect these cases reproduce
 *
 * objectui#9645 stopped the raw CEL editor's AUTOCOMPLETE from advertising
 * roots a mount's host does not bind. The row builder's subject dropdown was
 * not part of that ruling and kept its own default list, so `org.id` stayed
 * one click away at every mount that declares no vocabulary.
 *
 * `org` was strictly worse than the roots objectui#9645 withdrew, and the two
 * failures are not the same failure:
 *
 *  - an over-advertised root there linted CLEAN and failed at runtime;
 *  - `org` is not in `@objectstack/formula`'s `SCOPE_ROOTS` at all, so the
 *    record-scope validator reads `org.id` as a bare field and REJECTS it
 *    outright, with a remedy naming a record field that does not exist.
 *
 * That is the `app` case `ROW_PREDICATE_ROOTS` (`ConditionalFormattingEditor`)
 * settled under objectui#8155 — an editor advertising a root its own linter
 * rejects — reached through a different control.
 *
 * ## Real engine, on purpose
 *
 * Like `ConditionBuilder.mountRoots.test.tsx` and
 * `ConditionBuilder.mountScope.test.tsx`: the question under test is what the
 * ENGINE says about a subject this component OFFERS. A stub would let the
 * suite stay green while the dropdown went on offering the unofferable — which
 * is precisely how `org.id` survived objectui#6296 and objectui#9645.
 *
 * ## The pins are DERIVED, not retyped
 *
 * The default vocabulary is read off the rendered dropdown and each subject's
 * root is put to the real validator, so this file never restates the engine's
 * answer (AGENTS.md #9). It fails when either side moves: a subject added to
 * the default list that the engine refuses, and equally an engine that starts
 * refusing one the list still offers.
 *
 * ## The must-not-break half
 *
 * `user.*` is deliberately STILL offered, and a case below holds it there.
 * objectui#9855 proposed removing it too; the engine ACCEPTS it and
 * `buildExpressionScope` binds it for every predicate evaluated in the
 * browser, so withdrawing it by default would take a legitimate subject away
 * from the client-evaluated mounts. Narrowing it belongs to the
 * server-evaluated mounts as a DECLARED vocabulary — see the note on
 * `CONTEXT_SUBJECTS`. An over-narrowing reddens here rather than shipping.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Module-scope import of the CEL engine, per AGENTS.md's flaky-test rule: the
// lint runs behind a dynamic `import('@objectstack/formula')` inside
// `celAuthoring`, and a cold first load has been measured near a `waitFor`'s
// whole budget. The specifier must match `loadFormula`'s exactly — ESM caches
// by resolved specifier.
import '@objectstack/formula';

// objectui#4697 — `ConditionBuilder` calls `useObjectFields(objectName)`
// unconditionally even when `fields` is supplied, so a mount-time fetch would
// otherwise escape to the real network.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ConditionBuilder, RECORD_CONDITION_ROOTS, RECORD_CONDITION_SUBJECTS } from './ConditionBuilder';
import { HookDefaultInspector } from './HookDefaultInspector';
import { ObjectValidationsPanel } from '../../studio-design/ObjectValidationsPanel';
import { lintCelPredicate } from '../celAuthoring';

afterEach(cleanup);

const FIELDS = [{ name: 'status', label: 'Status' }];

/** Open the subject dropdown of a default-vocabulary mount and read it. */
async function defaultSubjects(): Promise<string[]> {
  const { container } = render(
    <ConditionBuilder
      label="Condition"
      value="placeholder_subject == 'x'"
      onCommit={() => {}}
      objectName="invoice"
      fields={FIELDS}
    />,
  );
  await userEvent.click(container.querySelectorAll('[role="combobox"]')[0] as HTMLElement);
  return (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
}

/** The CONTEXT half of the default vocabulary — what is not a catalog field. */
function contextSubjectsOf(all: string[]): string[] {
  return all.filter((s) => !s.startsWith('record.status') && s !== 'placeholder_subject');
}

/** Errors only; `warning` is advisory here as everywhere in this component. */
async function errorsFor(src: string): Promise<string[]> {
  const issues = await lintCelPredicate(src, { scope: 'record' });
  return issues.filter((i) => i.severity === 'error').map((i) => i.message);
}

/* ── The offered list, read against the engine that judges it ───────────── */

describe('the default subject vocabulary ↔ the engine (objectui#9855)', () => {
  it('offers only subjects the record scope ACCEPTS — every one lints clean', async () => {
    // THE GATE. Derived from what the dropdown actually renders rather than
    // from a copy of the constant, so a subject added to the default list that
    // the engine refuses reddens here — which is the reading `org.id` needed
    // and never got. This is the `app` failure of objectui#8155, one component
    // over and one control across.
    const subjects = contextSubjectsOf(await defaultSubjects());
    expect(subjects.length, 'the dropdown rendered no context subjects — dead instrument').toBeGreaterThan(0);
    for (const subject of subjects) {
      expect(
        await errorsFor(`${subject} == 'x'`),
        `offered subject "${subject}" must be accepted at scope record`,
      ).toEqual([]);
    }
  });

  it('`org.id` is refused by the engine — the reading the removal rests on', async () => {
    // The positive control for the case above, and the reason `org.id` is not
    // on the list any more. Asserted as a REJECTION (the envelope's severity),
    // not by matching the engine's wording: the remedy text is the engine's to
    // change. If `SCOPE_ROOTS` ever grows an `org`, this reddens and the
    // removal gets re-triaged instead of silently outliving its reason.
    expect(await errorsFor("org.id == 'o1'")).not.toEqual([]);
    expect(contextSubjectsOf(await defaultSubjects())).not.toContain('org.id');
  });

  it('still offers `user.*` — the half that must NOT be narrowed by default', async () => {
    // The `os` case of the objectui#8155 ruling, not the `app` case: accepted
    // by the engine AND bound by `buildExpressionScope` for every predicate
    // evaluated in the browser. Withdrawing it by default would take a working
    // subject away from the client-evaluated mounts; a server-evaluated mount
    // narrows it by DECLARING a `context` instead. Both legs are asserted so
    // this cannot be satisfied by an empty dropdown.
    const subjects = contextSubjectsOf(await defaultSubjects());
    expect(subjects).toContain('user.isAdmin');
    expect(subjects).toContain('record.id');
    expect(await errorsFor('user.isAdmin')).toEqual([]);
  });
});

/* ── Removing an OFFER may not orphan an authored predicate ─────────────── */

describe('a stored `org.id` predicate survives the withdrawal (objectui#9855)', () => {
  it('still round-trips into row mode and keeps its subject selectable', async () => {
    // The blast-radius half. Withdrawing an offer must not strand metadata an
    // author already wrote: the row builder appends an out-of-vocabulary
    // subject as its own option, so an existing `org.id` condition opens in
    // ROW mode with its subject intact rather than blanking or falling back to
    // the raw editor. Asserted through the dropdown, because the subject being
    // *displayed* is not the same claim as it being *selectable*.
    const { container } = render(
      <ConditionBuilder
        label="Condition"
        value="org.id == 'o1'"
        onCommit={() => {}}
        objectName="invoice"
        fields={FIELDS}
      />,
    );
    expect(container.querySelectorAll('[aria-label="Remove condition"]').length).toBe(1);
    await userEvent.click(container.querySelectorAll('[role="combobox"]')[0] as HTMLElement);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent ?? '')).toContain('org.id');
  });
});

/* ── The server-evaluated mounts DECLARE their narrower vocabulary ──────── */

/**
 * objectui#9855 option B: the two mounts whose condition is evaluated by a
 * SERVER host binding `{ record, previous }` declare their own `context`,
 * rather than the component defaulting one for everybody.
 *
 * ⚠️ Membership of this set is a MEASUREMENT, not a shape. It was read at
 * source in objectstack — `wrapDeclarativeHook` (`hook-wrappers.ts`) for the
 * hook `condition`, `checkPredicate` / `checkConditional`
 * (`validation/rule-validator.ts`) for a validation rule's guard — and both
 * bind exactly two names. ⛔ It is NOT `scope === 'record'`: the action
 * `visible` / `disabled` mounts declare that scope and are evaluated in the
 * browser, where `buildExpressionScope` binds `user`, so they keep `user.*`
 * and a case in the block above holds it there.
 */

/** A `ConditionBuilder`'s own root, found by the toggle only it renders. */
function builderRoot(): HTMLElement {
  const toggle = screen.getAllByRole('button').find((b) => b.textContent?.includes('Expression'));
  if (!toggle) throw new Error('no ConditionBuilder in row mode on screen — harness is dead');
  return toggle.parentElement!.parentElement! as HTMLElement;
}

/** Open the subject dropdown of the first row and read what it offers. */
async function rowSubjects(): Promise<string[]> {
  const trigger = within(builderRoot()).getAllByRole('combobox')[0] as HTMLElement;
  await userEvent.click(trigger);
  return (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
}

function HookHarness() {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'stamp',
    label: 'Stamp',
    object: 'invoice',
    events: ['beforeInsert'],
    condition: "record.status == 'open'",
  });
  return (
    <HookDefaultInspector
      type="hook"
      name="stamp"
      draft={draft}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      readOnly={false}
      locale={'en-US' as never}
    />
  );
}

function ValidationHarness() {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'invoice',
    fields: { status: { type: 'text' } },
    validations: [
      {
        type: 'script',
        name: 'rule_a',
        label: 'rule_a',
        message: 'nope',
        severity: 'error',
        active: true,
        condition: "record.status == 'open'",
      },
    ],
  });
  return (
    <ObjectValidationsPanel
      draft={draft}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      onBlockingIssuesChange={() => {}}
    />
  );
}

describe('server-evaluated mounts declare `context` (objectui#9855 option B)', () => {
  for (const [what, Harness] of [
    ['a hook `condition`', HookHarness],
    ["an object validation rule's guard", ValidationHarness],
  ] as const) {
    it(`${what} offers no \`user.*\` subject — its host binds record and previous alone`, async () => {
      render(<Harness />);
      const offered = await rowSubjects();
      // Both legs, so an empty or unopened dropdown cannot satisfy this.
      expect(offered, 'the subject dropdown did not open — dead instrument').not.toHaveLength(0);
      expect(offered, '`record.id` must survive the narrowing').toContain('record.id');
      const unbound = offered.filter((s) => s.startsWith('user.') || s.startsWith('org.'));
      expect(
        unbound,
        `this mount is evaluated by a host binding { record, previous } only, so ${unbound.join(', ')} compiles a row that can never match`,
      ).toEqual([]);
    });
  }

  it('declares no subject under a root the server hosts do not bind', () => {
    // Derived from BOTH constants, so this states the rule rather than a
    // snapshot of today's single entry: the dropdown's list and the
    // autocomplete's list are the two doors of one ruling and may not drift.
    expect(RECORD_CONDITION_SUBJECTS.length, 'an empty list would satisfy every case below').toBeGreaterThan(0);
    for (const s of RECORD_CONDITION_SUBJECTS) {
      const root = s.value.split('.')[0];
      expect(
        RECORD_CONDITION_ROOTS,
        `declared subject "${s.value}" names root "${root}", which neither the hook wrapper nor the rule validator binds`,
      ).toContain(root);
    }
  });
});
