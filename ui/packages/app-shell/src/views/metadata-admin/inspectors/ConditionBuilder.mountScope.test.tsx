// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ConditionBuilder`'s raw CEL editor must lint in the scope its MOUNT SITE
 * evaluates in — objectui#8167, the objectui#7727 defect at a component
 * objectui#7727 does not touch.
 *
 * ## The defect these cases reproduce
 *
 * The scope was not a prop at all. Every mount fell through to `celAuthoring`'s
 * own default — spelled `hint.scope ?? 'flattened'` — and nothing could
 * override it, so a bare `status == 'done'` typed into an action's **Visible
 * when** linted CLEAN. It never matches: `usePredicateRecordContext` binds
 * `record` and nothing else, and objectui#5741 Phase 2 retired the bare
 * shorthand on runtime record surfaces, so the predicate is simply false
 * forever with no author-time signal anywhere.
 *
 * That is why the red leg below types a BARE SHORTHAND and asserts the editor
 * rejects it, rather than asserting that a prop arrived. A "the prop is
 * forwarded" assertion would pass against a scope value that means nothing to
 * the engine; this one can only pass if the engine was actually asked the
 * record-scoped question.
 *
 * ## Real engine, on purpose
 *
 * These cases run against the REAL `@objectstack/formula` — the same choice
 * `ConditionalFormattingEditor.test.tsx` made when PR #8164 turned this same
 * defect at the conditional-formatting mount. A stub would let the suite stay
 * green while asking the engine the wrong question, which is precisely the
 * failure being pinned. Measured on the installed engine, both directions:
 *
 *   scope 'flattened' · `status == 'done'`        -> ok, no findings
 *   scope 'record'    · `status == 'done'`        -> error, names `record.status`
 *   scope 'record'    · `record.status == 'done'` -> ok, no findings
 *
 * ## The control half
 *
 * "Unchanged" is the load-bearing half of the ruling on objectui#8167, so the
 * default itself is pinned: a bare `ConditionBuilder` with no `scope` must
 * still lint the bare shorthand CLEAN. If a later change makes the prop default
 * to `'record'` — or derives it from `subjects.fieldPrefix` — that case goes
 * red, which is the point.
 *
 * ⚠️ `HookDefaultInspector` used to stand beside it as a second control, on the
 * ground that its tier was unsettled. It is settled now (ruling of
 * 2026-09-16), so the same mount appears BELOW as a rejecting case instead.
 * That is a re-homing, not a weakened pin: the control asserted "no claim is
 * made here", and a claim is now made.
 *
 * ## Two mounts still pass nothing, for two DIFFERENT reasons
 *
 *  - the schema-driven `ConditionWidget` in `widgets.tsx` — undecided channel,
 *    no rendered harness of its own, and no JSX mount site to supply a prop;
 *  - the PAGE BLOCK — decided, and the decision is that neither scope fits.
 *    Its evaluator binds `record`, `current_user` AND `page.<var>`, and the
 *    `record` scope REFUSES the third, because `page` is not among the engine's
 *    scope roots. The case below is the falsifiable half of that: it pins the
 *    spec's own documented example, so anyone who "settles" that mount with
 *    `'record'` gets a red test instead of a designer whose Save button is
 *    disabled by a predicate the spec prescribes.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

// Module-scope import of the CEL engine, per AGENTS.md's flaky-test rule: the
// lint runs behind a dynamic `import('@objectstack/formula')` inside
// `celAuthoring`, and a cold first load has been measured near a `waitFor`'s
// whole budget. Paying it at import time takes it out of every bounded window
// below. The specifier must match `loadFormula`'s exactly — ESM caches by
// resolved specifier, and a different spelling warms a different entry.
import '@objectstack/formula';

// objectui#4697 — these inspectors call `useObjectFields(objectName)` /
// `useObjectOptions()` unconditionally, so a mount-time fetch would escape to
// the real network. The verdict under test does not depend on the catalog: the
// engine reports a bare reference from the SCOPE, not from the field list
// (measured with `fields: []` and with `fields: undefined` — identical).
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { PageSchema } from '@objectstack/spec/ui';

import { ConditionBuilder } from './ConditionBuilder';
import { ActionDefaultInspector } from './ActionDefaultInspector';
import { HookDefaultInspector } from './HookDefaultInspector';
import { PageBlockInspector } from './PageBlockInspector';
import { ObjectValidationsPanel } from '../../studio-design/ObjectValidationsPanel';

afterEach(cleanup);

/** The bare shorthand the card is about: retired, clean under `flattened`. */
const BARE = "status == 'done'";
/** Its canonical twin — the must-not-break half of every narrowing. */
const CANONICAL = "record.status == 'done'";
/** The transition idiom: only expressible where `previous` is bound too. */
const TRANSITION = "previous.status != 'done' && record.status == 'done'";
/** `@objectstack/spec`'s OWN worked example for a page block's `visibleWhen`. */
const PAGE_VAR = "page.selectedProjectId != ''";

/** `CelPredicateField` renders its editor as a combobox TEXTAREA. */
function rawEditorIn(root: HTMLElement): HTMLTextAreaElement {
  fireEvent.click(within(root).getByText('Expression'));
  return within(root)
    .getAllByRole('combobox')
    .find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

/** A builder's own root, located by its label — inspectors mount several. */
function builderLabelled(label: string): HTMLElement {
  return screen.getByText(label).parentElement!.parentElement! as HTMLElement;
}

/**
 * The editor REJECTED what was typed.
 *
 * `aria-invalid` is the structural assertion — it is what the editor sets from
 * its own error count, and what a save gate counts. The message check is
 * deliberately narrowed to the canonical spelling the engine prescribes rather
 * than to its sentence: the fix an author must apply is the contract here, the
 * wording is not.
 */
async function expectRejected(box: HTMLTextAreaElement) {
  await waitFor(() => expect(box.getAttribute('aria-invalid')).toBe('true'), { timeout: 4000 });
  expect(await screen.findByText(/record\.status/, {}, { timeout: 4000 })).toBeTruthy();
}

/** The editor ACCEPTED what was typed — no error, and it says so. */
async function expectAccepted(box: HTMLTextAreaElement) {
  expect(await screen.findByText('Valid CEL', {}, { timeout: 4000 })).toBeTruthy();
  expect(box.getAttribute('aria-invalid')).not.toBe('true');
}

/* ── Mount 1 & 2 — an action's `visible` / `disabled` ──────────────────── */

function ActionHarness() {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'approve',
    label: 'Approve',
    type: 'script',
    objectName: 'invoice',
  });
  return (
    <ActionDefaultInspector
      type="action"
      name="approve"
      draft={draft}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      readOnly={false}
      locale={'en-US' as never}
    />
  );
}

describe("ActionDefaultInspector — an action guard is a ROW surface (objectui#8167)", () => {
  // `rowPredicateCanon.ts` names `visible` / `disabled` on an action renderer
  // as a row predicate in its own words, and that is the whole basis for these
  // two: conformance, not taste.
  for (const label of ['Visible when', 'Disabled when'] as const) {
    it(`rejects the bare shorthand in "${label}" and names the record.<field> fix`, async () => {
      render(<ActionHarness />);
      const box = rawEditorIn(builderLabelled(label));
      fireEvent.change(box, { target: { value: BARE } });
      await expectRejected(box);
    });

    it(`still accepts the canonical spelling in "${label}"`, async () => {
      // The other half of a narrowing: rejecting the retired spelling must not
      // cost the author the one they are being sent to.
      render(<ActionHarness />);
      const box = rawEditorIn(builderLabelled(label));
      fireEvent.change(box, { target: { value: CANONICAL } });
      await expectAccepted(box);
    });
  }
});

/* ── Mount 3 — an object validation rule's `condition` ─────────────────── */

function ValidationsHarness() {
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
      },
    ],
  });
  return (
    <ObjectValidationsPanel
      draft={draft}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
    />
  );
}

describe('ObjectValidationsPanel — the SERVER binds a rule condition to `record` (objectui#8167)', () => {
  // objectql's rule validator evaluates a `script` / `cross_field` condition
  // with `{ record, previous }` and nothing else, and since objectstack#4649 an
  // unevaluable predicate there is fail-CLOSED. So a bare reference authored
  // here does not merely fail to match — it rejects every write to the object,
  // and this editor used to lint it clean.
  it('rejects the bare shorthand in a rule condition and names the record.<field> fix', async () => {
    const { container } = render(<ValidationsHarness />);
    const box = rawEditorIn(container as HTMLElement);
    fireEvent.change(box, { target: { value: BARE } });
    await expectRejected(box);
  });

  it('still accepts the canonical spelling in a rule condition', async () => {
    const { container } = render(<ValidationsHarness />);
    const box = rawEditorIn(container as HTMLElement);
    fireEvent.change(box, { target: { value: CANONICAL } });
    await expectAccepted(box);
  });
});

/* ── Mount 4 — a page block's `visibleWhen` ────────────────────────────── */

function pageDraft(): Record<string, unknown> {
  return PageSchema.parse({
    name: 'home',
    label: 'Home',
    type: 'home',
    template: 'default',
    regions: [{ name: 'main', components: [{ type: 'text', id: 'b1' }] }],
  }) as unknown as Record<string, unknown>;
}

function PageBlockHarness() {
  const [draft, setDraft] = React.useState<Record<string, unknown>>(pageDraft);
  return (
    <PageBlockInspector
      type="page"
      name="home"
      draft={draft}
      selection={{ kind: 'block', id: 'regions[0].components[0]' }}
      onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      onBlockingIssuesChange={() => {}}
      readOnly={false}
      locale={'en-US' as never}
    />
  );
}

describe('PageBlockInspector — neither lint scope fits this mount (objectui#8167)', () => {
  /**
   * The mount passes NO `scope`, and this case is why it may not simply be
   * "settled" with `'record'`.
   *
   * The renderer reading that motivated `'record'` is correct as far as it
   * goes: `SchemaRenderer` binds the row as the `record` root, so a bare
   * `status == 'done'` never matches here. But the SAME evaluator construction
   * also binds `page: pageVariables`, and `@objectstack/spec`'s `page.zod.ts`
   * documents exactly that — *"Contract-bound roots: `record`, `current_user`
   * … and page state as `page.<var>`"* — with `page.selectedProjectId != ''`
   * as its own worked example.
   *
   * At `scope: 'record'` the validator runs a strict environment declaring
   * exactly the engine's `SCOPE_ROOTS`, and `page` is not in it. Measured on
   * the installed `@objectstack/formula`:
   *
   *   scope 'record' · "page.selectedProjectId != ''"
   *     -> error: "bare reference `page` … Write `record.page`."
   *
   * — a hard error prescribing a nonsense fix, on the spelling the spec
   * prescribes. And this inspector reports blocking issues upward, where the
   * host turns them into a disabled Save. So the narrowing that fixes the bare
   * shorthand breaks a contract-bound root: the objectui#8155 shape, and an
   * engine-vocabulary gap rather than a mount decision.
   *
   * ⇒ this case fails the moment someone passes `scope="record"` here. That is
   * its entire job: it makes the deliberate omission falsifiable rather than
   * asserted, and it fails in the DESIGNER, where the cost actually lands.
   */
  it("accepts the spec's own `page.<var>` example — which the `record` scope would refuse", async () => {
    const { container } = render(<PageBlockHarness />);
    const box = rawEditorIn(container as HTMLElement);
    fireEvent.change(box, { target: { value: PAGE_VAR } });
    await expectAccepted(box);
  });
});

/* ── Mount 5 — a hook's `condition` ────────────────────────────────────── */

function HookHarness() {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'stamp',
    label: 'Stamp',
    object: 'invoice',
    events: ['beforeInsert'],
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

function BareBuilderHarness() {
  const [value, setValue] = React.useState('');
  return (
    <ConditionBuilder
      label="Condition"
      value={value}
      onCommit={setValue}
      objectName="invoice"
      fields={[{ name: 'status' }]}
    />
  );
}

describe('HookDefaultInspector — the SERVER binds a hook condition to `record` (objectui#8167)', () => {
  // `@objectstack/objectql`'s `wrapDeclarativeHook` compiles the condition once
  // and evaluates it as
  //   `ExpressionEngine.evaluate<boolean>(expr, { record: record ?? {}, previous })`
  // — `record` and `previous`, and nothing else. An unevaluable condition there
  // throws `HookConditionError` rather than resolving false, so a bare
  // reference is not merely a gate that never fires. The editor linted it
  // clean; that mismatch is the defect this pair closes.
  it('rejects the bare shorthand in a hook condition and names the record.<field> fix', async () => {
    render(<HookHarness />);
    const box = rawEditorIn(builderLabelled('Run only when (optional CEL)'));
    fireEvent.change(box, { target: { value: BARE } });
    await expectRejected(box);
  });

  it('still accepts the canonical spelling in a hook condition', async () => {
    render(<HookHarness />);
    const box = rawEditorIn(builderLabelled('Run only when (optional CEL)'));
    fireEvent.change(box, { target: { value: CANONICAL } });
    await expectAccepted(box);
  });

  it('accepts `previous.<field>` — the transition idiom the server binds beside `record`', async () => {
    // The ruling asked for `previous` to be reachable in this mount's scope.
    // Measured on the installed engine, it already is: at `scope: 'record'`
    // `validateExpression` returns no finding for a `previous.*` reference and
    // `introspectScope` already advertises `previous` among its roots, so the
    // narrowing to `record` does not cost this surface the one root that makes
    // a transition expressible. This case is what keeps that true.
    render(<HookHarness />);
    const box = rawEditorIn(builderLabelled('Run only when (optional CEL)'));
    fireEvent.change(box, { target: { value: TRANSITION } });
    await expectAccepted(box);
  });
});

/* ── Control — the mount that still passes nothing is unchanged ────────── */

describe('mounts that pass no `scope` are byte-for-byte unchanged (objectui#8167)', () => {
  it('the component default is still the engine default, not `record`', async () => {
    // Omitting `scope` must forward `undefined`, so `celAuthoring`'s
    // `hint.scope ?? 'flattened'` answers exactly what it answered before the
    // prop existed. This reddens if the default is ever changed, or derived
    // from `subjects.fieldPrefix`.
    render(<BareBuilderHarness />);
    const box = rawEditorIn(screen.getByText('Condition').parentElement!.parentElement! as HTMLElement);
    fireEvent.change(box, { target: { value: BARE } });
    await expectAccepted(box);
  });
});
