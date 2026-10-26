// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The schema-driven condition editor lints in the scope its HOST declares, and
 * the host derives that from the metadata type it is editing — objectui#8167,
 * the third and last arm of the card.
 *
 * ## The defect these cases reproduce
 *
 * `SchemaForm` routes a field to `ConditionWidget` by NAME CONVENTION
 * (`visible` / `hidden` / `disabled` / `condition` / `predicate` / `*When`),
 * so ONE widget serves every metadata type. It claimed no scope, so
 * every one of those fields fell through to `celAuthoring`'s own
 * `hint.scope ?? 'flattened'` default and a bare `status == 'done'` linted
 * CLEAN — including on the action and hook tiers, where the runtime binds the
 * row as the `record` ROOT and the predicate therefore never matches. The
 * author got a success receipt the runtime refuses.
 *
 * ## Why the verdict rides `WidgetContext` and not a prop
 *
 * `ConditionWidget` has ZERO JSX mount sites — measured, and it is the whole
 * reason for this shape. It is resolved out of a registry declared
 * `satisfies Record<string, WidgetRenderer>` where
 * `WidgetRenderer = (props: WidgetProps) => React.ReactElement`, so a
 * widget-specific required prop is a compile error at the registry and there is
 * no host mount to supply one. `WidgetContext` is the channel every host
 * already builds, and `conditionScope` is REQUIRED there, so a host that fails
 * to decide does not compile.
 *
 * ## Real engine, on purpose
 *
 * As in `inspectors/ConditionBuilder.mountScope.test.tsx`: the red leg types a
 * BARE SHORTHAND and asserts the editor rejects it, rather than asserting that
 * a value arrived. A "the member is forwarded" assertion would pass against a
 * scope the engine does not honour; this one can only pass if the engine was
 * actually asked the record-scoped question.
 *
 * ## The three arms, and the control
 *
 *  - `record`    — rejects the bare shorthand, still accepts the canonical one.
 *  - `flattened` — still accepts the bare shorthand. The tiers that are NOT row
 *                  surfaces (flow, permission / RLS) keep their vocabulary;
 *                  this is the half that stops the fix from being a sweep.
 *  - `none`      — no builder and no lint claim at all: the plain string editor.
 *  - NO context  — unchanged from before the member existed. A host that hands
 *                  down no `WidgetContext` has made no claim, and this change
 *                  does not reach it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

// Module-scope import of the CEL engine, per AGENTS.md's flaky-test rule: the
// lint runs behind a dynamic `import('@objectstack/formula')` inside
// `celAuthoring`, and a cold first load has been measured near a `waitFor`'s
// whole budget. The specifier must match `loadFormula`'s exactly — ESM caches
// by resolved specifier, and a different spelling warms a different entry.
import '@objectstack/formula';

// objectui#4697 — `ConditionBuilder` calls `useObjectFields(objectName)`
// unconditionally, so a mount-time fetch would escape to the real network. The
// verdict under test does not depend on the catalog: the engine reports a bare
// reference from the SCOPE, not from the field list.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('./useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { SchemaForm } from './SchemaForm';
import type { WidgetContext } from './widgets';
import {
  CONDITION_SCOPE_BY_METADATA_TYPE,
  conditionScopeForMetadataType,
  type ConditionScope,
} from './conditionScope';
// The load-time registrations themselves — this import IS the instrument the
// table is enumerated against below, not a convenience.
import './register-builtins';
import { listMetadataResources } from './registry';

afterEach(cleanup);

/** The bare shorthand the card is about: retired, clean under `flattened`. */
const BARE = "status == 'done'";
/** Its canonical twin — the must-not-break half of every narrowing. */
const CANONICAL = "record.status == 'done'";

/** A schema whose one field is routed to the condition widget BY NAME. */
const SCHEMA = {
  type: 'object',
  properties: { visible: { type: 'string', title: 'Visible when' } },
} as never;

function Harness({ context }: { context?: WidgetContext }) {
  const [value, setValue] = React.useState<Record<string, unknown>>({ visible: '' });
  return (
    <SchemaForm
      schema={SCHEMA}
      value={value}
      onChange={(next) => setValue(next as Record<string, unknown>)}
      widgetContext={context}
    />
  );
}

function ctx(conditionScope: ConditionScope): WidgetContext {
  return { conditionScope };
}

/** `CelPredicateField` renders its editor as a combobox TEXTAREA. */
function rawEditor(): HTMLTextAreaElement {
  fireEvent.click(screen.getByText('Expression'));
  return within(document.body)
    .getAllByRole('combobox')
    .find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

/**
 * The editor REJECTED what was typed. `aria-invalid` is the structural
 * assertion — it is what the editor sets from its own error count and what a
 * save gate counts. The message check is narrowed to the canonical spelling the
 * engine prescribes: the fix an author must apply is the contract, the wording
 * is not.
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

/* ── `record` — the row tiers ───────────────────────────────────────────── */

describe("ConditionWidget — a host declaring `record` gets the record-scoped lint (objectui#8167)", () => {
  it('rejects the bare shorthand and names the record.<field> fix', async () => {
    render(<Harness context={ctx('record')} />);
    const box = rawEditor();
    fireEvent.change(box, { target: { value: BARE } });
    await expectRejected(box);
  });

  it('still accepts the canonical spelling', async () => {
    // The other half of a narrowing: rejecting the retired spelling must not
    // cost the author the one they are being sent to.
    render(<Harness context={ctx('record')} />);
    const box = rawEditor();
    fireEvent.change(box, { target: { value: CANONICAL } });
    await expectAccepted(box);
  });
});

/* ── `flattened` — the tiers that are NOT row surfaces ──────────────────── */

describe('ConditionWidget — a host declaring `flattened` keeps its vocabulary (objectui#8167)', () => {
  it('accepts the bare shorthand, because that tier binds it', async () => {
    // Flow nodes and permission / RLS conditions are not row surfaces
    // (objectui#5738 stand-down 3). This case is what keeps the fix from being
    // a sweep: it reddens if anyone makes `record` the widget's default.
    render(<Harness context={ctx('flattened')} />);
    const box = rawEditor();
    fireEvent.change(box, { target: { value: BARE } });
    await expectAccepted(box);
  });
});

/* ── `none` — no builder, no claim ──────────────────────────────────────── */

describe('ConditionWidget — `none` routes the field to the plain editor (objectui#8167)', () => {
  it('renders no condition builder at all', () => {
    // `none` is the page-block row's verdict today and the last row's verdict
    // for every type without one: the evaluator binds a set no lint scope
    // expresses, so the honest editor is the one that claims nothing. The
    // builder's raw/visual toggle is its signature; its absence is the
    // assertion.
    render(<Harness context={ctx('none')} />);
    expect(screen.queryByText('Expression')).toBeNull();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('still round-trips what the author types', () => {
    render(<Harness context={ctx('none')} />);
    const box = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(box, { target: { value: BARE } });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(BARE);
  });

  it('is still named by the host label — the `group` labelling contract holds', () => {
    // `WIDGET_LABELLING` declares this key `'group'`, so the host sends a label
    // id and no control id. That contract cannot vary with the scope, which is
    // why the wrapper stays on both arms.
    render(<Harness context={ctx('none')} />);
    expect(screen.getByRole('group')).toBeInTheDocument();
    // A regex, not the literal: the host renders the field's key beside its
    // title, and which of the two the name ends up carrying is that host's
    // business. What this case pins is that the plain editor is NAMED at all —
    // an unnamed control is what a `'group'` widget would leave behind if the
    // wrapper were the only thing carrying the label.
    expect(screen.getByRole('textbox')).toHaveAccessibleName(/Visible when/);
  });
});

/* ── Control — a host that declares nothing is unchanged ────────────────── */

describe('ConditionWidget — no `WidgetContext` at all is byte-for-byte unchanged (objectui#8167)', () => {
  it('still renders the builder and still lints the bare shorthand clean', async () => {
    // A host that hands down no context has made no claim, so the widget
    // forwards no scope and `celAuthoring`'s `hint.scope ?? 'flattened'`
    // answers exactly what it answered before this member existed. This reddens
    // if the absent-context arm is ever "tidied" into `'none'` or `'record'` —
    // either of which would change mounts nobody ruled on.
    render(<Harness />);
    const box = rawEditor();
    fireEvent.change(box, { target: { value: BARE } });
    await expectAccepted(box);
  });
});

/* ── The ruled table ────────────────────────────────────────────────────── */

/**
 * Types the table rules that the resource registry does not enumerate. Each one
 * needs a reason, because an unexplained row is how a table rots:
 *
 *  - `field` / `index` / `validation` — the `editAs` targets an object's
 *    embedded children are edited AS. The registry rows for them are the
 *    `__object_*` anchors, which are anchors and never edit routes.
 *    ⚠️ Naming them here is the table being exhaustive, ⛔ NOT a claim that any
 *    of them reaches the table through a host: `EmbeddedItemEditor`, which is
 *    what an `editAs` opens, builds no `WidgetContext` at all. For `validation`
 *    that matters most, because its row is `record` and something else delivers
 *    it — the curated `ObjectValidationsPanel`, which declares its own scope at
 *    its own mount. The standalone `validation` kind is retired (ADR-0088), so
 *    the generic editor never receives it either. See `conditionScope.ts`'s note
 *    on that row.
 *  - the other spec-schema types — served by the generic
 *    editor through `clientValidation`'s loader table rather than by a
 *    registered resource row, so they reach `conditionScopeForMetadataType`
 *    without ever appearing in `listMetadataResources()`.
 */
const RULED_BEYOND_THE_REGISTRY = [
  'agent',
  'analytics_cube',
  'api',
  'connector',
  'field',
  'index',
  'job',
  'mapping',
  'validation',
  'webhook',
] as const;

describe('the per-type table is exhaustive over the types the editor serves (objectui#8167)', () => {
  it('every registered metadata resource has a ruled row', () => {
    // ⭐ The instrument, not a copied count: `listMetadataResources()` is the
    // engine's own registry, filled by `./register-builtins` at import time. A
    // metadata type added there without a verdict here fails HERE — which is
    // the whole reason the table is pinned rather than defaulted.
    const served = listMetadataResources().map((r) => r.type).sort();
    expect(served.length).toBeGreaterThan(0); // the registry really did load
    const ruled = new Set(Object.keys(CONDITION_SCOPE_BY_METADATA_TYPE));
    expect(served.filter((t) => !ruled.has(t))).toEqual([]);
  });

  it('rules nothing it cannot account for', () => {
    // The other direction, so a row for a type the editor stopped serving goes
    // red instead of going quiet.
    const served = new Set(listMetadataResources().map((r) => r.type));
    const extra = Object.keys(CONDITION_SCOPE_BY_METADATA_TYPE)
      .filter((t) => !served.has(t))
      .sort();
    expect(extra).toEqual([...RULED_BEYOND_THE_REGISTRY].sort());
  });

  it('carries the ruled verdict for each tier the ruling names', () => {
    // These six are the director seat's ruling of 2026-09-17 (batch #150 item 5,
    // letter B with the derivation table). ⛔ A row is changed by a new ruling,
    // never by an edit here — that is what this case exists to notice.
    expect(conditionScopeForMetadataType('action')).toBe('record');
    expect(conditionScopeForMetadataType('validation')).toBe('record');
    expect(conditionScopeForMetadataType('hook')).toBe('record');
    expect(conditionScopeForMetadataType('flow')).toBe('flattened');
    expect(conditionScopeForMetadataType('permission')).toBe('flattened');
    expect(conditionScopeForMetadataType('sharing_rule')).toBe('flattened');
    expect(conditionScopeForMetadataType('page')).toBe('none');
  });

  it('answers `none` for a type it has never heard of', () => {
    // The runtime fallback: a build must keep editing a type it does not know,
    // and `none` is the only answer that claims nothing about it. The case
    // above is what stops that fallback from being where a REAL new type lands.
    expect(conditionScopeForMetadataType('a_type_no_build_has_heard_of')).toBe('none');
  });
});
