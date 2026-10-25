// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#3218 — the Hook inspector's "Run only when" guard must read AND
 * write the ADR-0089 expression envelope.
 *
 * `HookSchema.condition` is `ExpressionInputSchema`, the same pipe
 * `FlowEdgeSchema.condition` uses: a bare authored string is NORMALIZED at
 * parse time into `{ dialect: 'cel', source }`, so the envelope is what a
 * persisted hook actually carries. The inspector used to read
 * `typeof draft.condition === 'string'`, so a persisted guard rendered EMPTY —
 * and because `ConditionBuilder.emit` compiles only the rows currently on
 * screen, the author's next edit REPLACED a guard they were never shown.
 *
 * FIXTURE DISCIPLINE (objectui#3216's method): no envelope is hand-written
 * here. Every fixture is the AUTHORED input fed through `HookSchema.parse`, so
 * a fixture cannot drift from the spec — if the spec stops normalizing, these
 * tests change shape with it instead of quietly testing a shape nothing emits.
 *
 * The write rule (issue ruling, option B) is what the edit cases pin:
 *
 *   | key       | when `source` is edited                                |
 *   |:----------|:-------------------------------------------------------|
 *   | `dialect` | PRESERVED (only a value with no prior envelope is 'cel')|
 *   | `meta`    | PRESERVED (ADR-0089 rationale / generatedBy)            |
 *   | `source`  | replaced                                               |
 *   | `ast`     | DISCARDED — derived from the OLD source                |
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HookSchema } from '@objectstack/spec/data';

// objectui#4697 — HookDefaultInspector calls useObjectOptions() unconditionally
// (the "Object(s) this hook fires on" picker) even though every fixture here
// uses `object: '*'` and never renders the picker's options. Stub the shared
// client so that mount-time fetch doesn't escape to the real network; see
// PageBlockInspector.i18n.test.tsx for the full mechanism.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { HookDefaultInspector } from './HookDefaultInspector';

afterEach(cleanup);

/**
 * Author a hook the way a user does, parse it with the spec, and hand the
 * RESULT to the inspector — exactly what the metadata editor loads.
 */
function hookDraft(condition: unknown): Record<string, unknown> {
  return HookSchema.parse({
    name: 'guard_hook',
    // '*' keeps ConditionBuilder in raw/no-catalog mode: the guard's read and
    // write are what is under test, not the field picker's network fetch.
    object: '*',
    events: ['beforeInsert'],
    handler: 'guard_fn',
    condition,
  }) as unknown as Record<string, unknown>;
}

function renderInspector(draft: Record<string, unknown>, onPatch = vi.fn()) {
  render(
    <HookDefaultInspector
      type="hook"
      name="guard_hook"
      draft={draft}
      onPatch={onPatch}
      readOnly={false}
      locale={'en-US' as never}
    />,
  );
  return onPatch;
}

/** The no-code builder's value box for the single parsed row. */
const rowValueInput = () => screen.getByPlaceholderText('value') as HTMLInputElement;
/**
 * The raw-expression editor. CelPredicateField renders a combobox TEXTAREA
 * (autocomplete host); the panel's Radix selects are combobox buttons.
 */
const rawEditor = () =>
  screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;

describe('HookDefaultInspector — condition envelope (#3218)', () => {
  it('renders the `source` of an envelope condition instead of an empty box', () => {
    const draft = hookDraft('amount > 10');
    // Pin what the platform actually stores, so this test fails loudly if the
    // spec ever stops normalizing rather than passing on a stale assumption.
    expect(draft.condition).toEqual({ dialect: 'cel', source: 'amount > 10' });

    renderInspector(draft);

    // The guard is visible: the no-code builder adopted `amount > 10`, so its
    // value box carries `10` and the compiled preview echoes the whole guard.
    expect(rowValueInput().value).toBe('10');
    expect(screen.getByText('amount > 10')).toBeInTheDocument();
  });

  it('preserves `dialect` and `meta` verbatim across an edit', () => {
    const draft = hookDraft({
      dialect: 'cel',
      source: 'amount > 10',
      meta: { rationale: 'Only large deals need approval', generatedBy: 'agent:deal-guard' },
    });
    const onPatch = renderInspector(draft);

    fireEvent.change(rowValueInput(), { target: { value: '20' } });

    expect(onPatch).toHaveBeenCalledWith({
      condition: {
        dialect: 'cel',
        source: 'amount > 20',
        meta: { rationale: 'Only large deals need approval', generatedBy: 'agent:deal-guard' },
      },
    });
  });

  it('DISCARDS a stale `ast` on edit (it was compiled from the old source)', () => {
    const draft = hookDraft({
      dialect: 'cel',
      source: 'amount > 10',
      ast: { op: '>', left: 'amount', right: 10 },
    });
    expect((draft.condition as Record<string, unknown>).ast).toBeDefined();

    const onPatch = renderInspector(draft);
    fireEvent.change(rowValueInput(), { target: { value: '20' } });

    const patched = onPatch.mock.calls.at(-1)![0].condition as Record<string, unknown>;
    expect(patched.source).toBe('amount > 20');
    // Keeping it would leave the engine evaluating the OLD guard while the UI
    // shows the new one. `objectstack compile` refills it.
    expect(patched).not.toHaveProperty('ast');
    // Dropping `ast` is safe: `source` is present, so ExpressionSchema's
    // "one of source | ast" refinement still holds.
    expect(HookSchema.parse({ ...draft, condition: patched }).condition).toEqual({
      dialect: 'cel',
      source: 'amount > 20',
    });
  });

  it('keeps a `template` guard on the template dialect (the A/B dividing line)', () => {
    const draft = hookDraft({ dialect: 'template', source: 'Hello {{record.name}}' });
    const onPatch = renderInspector(draft);

    // Not simple-CEL, so the builder opens the raw expression editor — which
    // is also proof the envelope's `source` reached the control.
    expect(rawEditor().value).toBe('Hello {{record.name}}');

    fireEvent.change(rawEditor(), { target: { value: 'Hello {{record.title}}' } });

    // Committing a bare string here (option A) would have let the spec's pipe
    // rewrite this guard to `dialect: 'cel'` — a different evaluation engine
    // for an author who believes they only retyped the text.
    expect(onPatch).toHaveBeenCalledWith({
      condition: { dialect: 'template', source: 'Hello {{record.title}}' },
    });
  });

  it('still clears the guard to `undefined` when the author empties it', () => {
    const draft = hookDraft('amount > 10');
    const onPatch = renderInspector(draft);

    fireEvent.click(screen.getByLabelText('Remove condition'));

    expect(onPatch).toHaveBeenCalledWith({ condition: undefined });
  });

  it('writes the bare-string shorthand when there was no prior envelope', () => {
    // A hook authored without a guard: nothing to preserve, so the shorthand
    // (which the spec's pipe normalizes to `dialect: 'cel'`) is what is sent.
    const draft = hookDraft(undefined);
    expect(draft.condition).toBeUndefined();

    const onPatch = renderInspector(draft);
    fireEvent.click(screen.getByText('Add condition'));
    // A subject-less row compiles to '', i.e. still no guard.
    expect(onPatch).toHaveBeenLastCalledWith({ condition: undefined });
  });
});
