// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9336 — the flow `end` node's `config.message`, the key
 * `outcome: 'refused'` REQUIRES and `outcome: 'completed'` REFUSES.
 *
 * `EndConfigSchema` cross-validates the pair in BOTH directions through a
 * `superRefine`. The form offered a typed control for `outcome` (objectui#9278
 * made it a closed two-option dropdown) and NONE for `message`, so the most
 * direct route through the repaired control — pick `refused`, save — produced a
 * flow that fails to load. That is a BLOCKED AUTHORING PATH, not a missing
 * nicety, and it is the shape these rows pin: not "a field exists" but "the
 * outcome an author can pick is one they can then satisfy".
 *
 * ## What makes each reading a reading rather than a dead probe
 *
 * Every negative here is paired with a lit control differing in exactly one
 * way, because a zero whose control is also dead proves nothing:
 *
 *  - the spec rows print BOTH signs from one parse: `refused` alone is refused,
 *    `refused` + `message` is accepted, and `completed` + `message` is refused.
 *    An accept-only loop would pass against a schema that accepts everything.
 *  - the "hidden on a completed end" row is paired with the SAME query finding
 *    the SAME control on a refused end — so an absence is a gate, never a
 *    renderer that drew nothing (objectui#8350's lesson).
 *  - the queries proving `message` absent are paired with `Outcome`, which is
 *    present in every one of those renders.
 *
 * ## The gate, and why it is `showWhen` rather than an always-on field
 *
 * An always-on `message` box would trade this defect for the contract's OTHER
 * direction: a completion carrying a message is refused just as loudly. The
 * descriptor is therefore gated on the controller, and the two halves that make
 * the pair fully authorable are both pinned below — the field is OFF while the
 * outcome resolves to `completed` (through the declared default, on an unset
 * key), and a STORED message re-shows it anyway, which is the only way an
 * author can clear a stale message after switching back.
 *
 * ⛔ These rows pin the CONTRACT's direction, not this file's taste. Every
 * expectation about what the schema accepts is derived from the installed
 * `EndConfigSchema` at run time, never from a literal restated here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// Same doubles as the sibling flow-node suites: the engine config-schema hook
// publishes nothing (so the STATIC table is what renders), and object fields
// resolve empty.
vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { fieldsForNodeType, isFieldVisible } from './flow-node-config';
import type { MetadataSelection } from '../preview-registry';
// ⛔ The `/automation` subpath is load bearing — these read `undefined` off the
// package root, and any `.parse` on them then throws.
import { EndConfigSchema, FlowNodeSchema } from '@objectstack/spec/automation';

/* ── The `meta/*` double ───────────────────────────────────────────────────
 * `FlowNodeInspector` renders `FlowReferenceField` for reference-kind keys, and
 * that field resolves options through a real `fetch` under happy-dom. Served
 * from a recorder whose `afterEach` fails on any URL outside the metadata
 * routes, so an escape to a data endpoint reds here instead of vanishing into a
 * `.catch`.
 * ────────────────────────────────────────────────────────────────────────── */
const META_PREFIX = '/api/v1/meta/';
let metaCalls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  metaCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      metaCalls.push(url);
      const route = routeOf(url);
      if (!route.startsWith(META_PREFIX)) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ type: route.slice(META_PREFIX.length), items: [] }),
      };
    }),
  );
});

afterEach(() => {
  expect(metaCalls.filter((url) => !routeOf(url).startsWith(META_PREFIX))).toEqual([]);
  // Unmount BEFORE restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

function draftWith(config: Record<string, unknown>) {
  return { nodes: [{ id: 'n1', type: 'end', label: 'Done', config }], edges: [] };
}

function renderInspector(draft: Record<string, unknown>) {
  const onPatch = vi.fn();
  const utils = render(
    <FlowNodeInspector
      type="flow"
      name="renewal"
      draft={draft}
      selection={{ kind: 'node', id: 'n1' } as MetadataSelection}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
  return { onPatch, ...utils };
}

const endFields = () => fieldsForNodeType('end');
const messageField = () => endFields().find((f) => f.id === 'message');
const outcomeField = () => endFields().find((f) => f.id === 'outcome');

/**
 * The `message` control as the author sees it, found by the placeholder the
 * descriptor declares — `Label` here is not `htmlFor`-bound, so a label query
 * cannot reach the input itself.
 */
const messageControl = () =>
  screen.queryByPlaceholderText(messageField()!.placeholder!) as HTMLTextAreaElement | null;

/* ── 1. The contract, read off the installed spec ─────────────────────────── */

describe('the contract this form has to make satisfiable (objectui#9336)', () => {
  const parse = (config: Record<string, unknown>) =>
    FlowNodeSchema.safeParse({ id: 'e', type: 'end', label: 'E', config });

  it('still declares `message`, and still judges the pair in BOTH directions', () => {
    // THE VACUITY GUARD. Every row below is about a key; a spec that stopped
    // declaring it would make the form's new field wrong rather than right, and
    // these rows would otherwise pass over a schema that no longer has an
    // opinion.
    expect(
      Object.keys((EndConfigSchema as unknown as { shape: Record<string, unknown> }).shape),
      'EndConfigSchema still declares exactly the pair this card is about',
    ).toEqual(['outcome', 'message']);

    // Both signs, one reading. The ACCEPTED rows are what make the REFUSED ones
    // a measurement: a schema that refused everything would pass the negatives
    // alone.
    expect(parse({ outcome: 'completed' }).success, '`completed` alone is accepted').toBe(true);
    expect(
      parse({ outcome: 'refused', message: 'Refused: {{ record.name }} is a confirmed duplicate' }).success,
      '`refused` WITH a message is accepted — the shape the form must be able to produce',
    ).toBe(true);
    expect(
      parse({ outcome: 'refused' }).success,
      '`refused` with no message is REFUSED — which is what an author could only produce before',
    ).toBe(false);
    expect(
      parse({ outcome: 'completed', message: 'x' }).success,
      'and the other direction: a completion carrying a message is REFUSED',
    ).toBe(false);
    expect(
      parse({ message: 'x' }).success,
      'including when `outcome` is OMITTED — the default resolves to `completed`, so the rule still bites',
    ).toBe(false);
  });

  it('and refuses the empty string under BOTH outcomes — so clearing must DELETE the key', () => {
    // This is why the control must not commit `''`. `setAtPath` deletes a leaf
    // on an empty commit; if it ever started storing `''` instead, an author
    // who cleared this box would ship an unloadable flow under either outcome.
    expect(parse({ outcome: 'refused', message: '' }).success, "refused + '' is refused (min(1))").toBe(false);
    expect(parse({ outcome: 'completed', message: '' }).success, "completed + '' is refused too").toBe(false);
  });
});

/* ── 2. The descriptor ────────────────────────────────────────────────────── */

describe('the end group offers a typed control for `message` (objectui#9336)', () => {
  it('declares a `message` field, gated on the outcome that requires it', () => {
    const field = messageField();
    expect(field, 'the end node offers a typed control for `message` at all').toBeDefined();
    expect(
      field!.path,
      'and it writes the key the contract names, under config',
    ).toEqual(['config', 'message']);
    // Derived, not chosen: the spec describes `message` as interpolated
    // "exactly like a screen `description`", and that field is a textarea in
    // this same table — as is the sibling `message` key on `notify`.
    expect(field!.kind, 'a {token} template body is not authored in a one-line box').toBe('textarea');
    expect(field!.showWhen, 'it is gated on the outcome that requires it').toEqual({
      field: 'outcome',
      equals: ['refused'],
    });
    // The controller the gate names must EXIST in this group, or `showWhen`
    // silently resolves to "never admit" and the field becomes unreachable.
    expect(
      endFields().some((f) => f.id === field!.showWhen!.field),
      'the gate names a controller that exists in this group',
    ).toBe(true);
    // ⛔ No declared default: `message` is `.optional()` with no `.default()`,
    // and a `defaultValue` here would be an unchecked claim about the spec.
    expect(field!.defaultValue, 'the spec declares no default for `message`').toBeUndefined();
  });

  it('and the `outputVariable` row of the same group is GONE — objectui#9335, come past on purpose', () => {
    // ⭐ THIS ROW CHANGED SIDES, DELIBERATELY.
    //
    // It was this card's separability pin. While objectui#9335 was open it
    // asserted the OPPOSITE — that the `outputVariable` row was still present,
    // still `text` and still ungated — so that a later reader could see it had
    // been left alone rather than missed, and so that a future repair of #9335
    // would have to come past this assertion ON PURPOSE rather than route
    // around it. objectui#9335 did exactly that; this is the other side.
    //
    // What it asserts now is the same separability read forward: the removal
    // that repaired #9335 took the refused key and NOTHING ELSE — this card's
    // own control is pinned intact by the rows above and below.
    expect(
      endFields().find((f) => f.id === 'outputVariable'),
      'the key `EndConfigSchema` refuses by name is no longer offered by this group (objectui#9335)',
    ).toBeUndefined();
    // The lit control: the SAME lookup still finds this card's field, so the
    // `undefined` above is a scoped removal and not an emptied group.
    expect(messageField(), 'and this card\u2019s own control survived that removal').toBeDefined();

    // ⭐ The un-hiding, which is what #9335 was costing THIS card. An
    // unrecognized key short-circuits `EndConfigSchema`'s `superRefine`, so a
    // `refused` end carrying `outputVariable` reported ONLY `unrecognized_keys`
    // and never the missing-`message` refusal these rows exist for. The form
    // can no longer produce that key, so the rule above is the one an author
    // now meets. Both halves read off the installed spec, one key apart.
    const masked = FlowNodeSchema.safeParse({
      id: 'e',
      type: 'end',
      label: 'E',
      config: { outcome: 'refused', outputVariable: 'result' },
    });
    expect(masked.success, 'the key is still refused by the contract — nothing here widened it').toBe(false);
    expect(
      masked.error!.issues.some((i) => i.code === 'custom'),
      'and it still MASKS this card\u2019s refusal — which is why the form must not be able to write it',
    ).toBe(false);
    expect(
      FlowNodeSchema.safeParse({ id: 'e', type: 'end', label: 'E', config: { outcome: 'refused' } }).error!.issues.some(
        (i) => i.code === 'custom',
      ),
      'the lit control, one key apart: without it, the missing-`message` refusal is exactly what surfaces',
    ).toBe(true);
  });

  it('the visibility resolver admits it only for a refused outcome', () => {
    const field = messageField()!;
    const fields = endFields();
    expect(
      isFieldVisible(field, { id: 'n', type: 'end', config: {} }, fields),
      'an UNSET outcome resolves through the declared `completed` default — hidden',
    ).toBe(false);
    expect(
      isFieldVisible(field, { id: 'n', type: 'end', config: { outcome: 'completed' } }, fields),
      'and an explicit `completed` keeps it hidden',
    ).toBe(false);
    expect(
      isFieldVisible(field, { id: 'n', type: 'end', config: { outcome: 'refused' } }, fields),
      'picking `refused` puts it on screen',
    ).toBe(true);
    // The stored-value re-show rule (objectui#6499 Option C) — the ONLY way an
    // author can clear a stale message after switching back to `completed`.
    expect(
      isFieldVisible(field, { id: 'n', type: 'end', config: { outcome: 'completed', message: 'stale' } }, fields),
      'a STORED message stays visible under `completed`, so it can be cleared rather than stranded',
    ).toBe(true);
    // The lit control for the two negatives above: the SAME resolver says yes to
    // the ungated sibling on the very same node, so `false` is a gate and not a
    // resolver that refuses everything.
    expect(
      isFieldVisible(outcomeField()!, { id: 'n', type: 'end', config: {} }, fields),
      'the ungated Outcome field is visible on the same node — the negatives above are a gate, not a dead resolver',
    ).toBe(true);
  });
});

/* ── 3. The rendered inspector ────────────────────────────────────────────── */

describe('and the author actually sees it on a refused end (objectui#9336)', () => {
  it('renders the control on a refused end — and the label states the contract', () => {
    renderInspector(draftWith({ outcome: 'refused' }));
    expect(messageControl(), 'the message control is rendered at all').not.toBeNull();
    expect(
      screen.queryByText(messageField()!.label),
      'and is labelled in the spec’s own words',
    ).not.toBeNull();
  });

  it('hides it on a completed end — with the SAME query finding it one render away', () => {
    // The paired control. This negative differs from the positive above in
    // exactly one way: the stored outcome.
    renderInspector(draftWith({ outcome: 'completed' }));
    expect(messageControl(), 'a completed end does not offer the key its outcome refuses').toBeNull();
    expect(
      screen.queryByRole('combobox', { name: 'Outcome' }),
      'the lit control: this render DID draw the end inspector',
    ).not.toBeNull();
    cleanup();

    renderInspector(draftWith({ outcome: 'refused' }));
    expect(
      messageControl(),
      'and the identical query finds it when the outcome is refused — so the null above is a gate',
    ).not.toBeNull();
  });

  it('hides it on an end with NO stored outcome — the default the runtime applies', () => {
    renderInspector(draftWith({}));
    expect(messageControl(), 'an unset outcome resolves to `completed`, so the field is off screen').toBeNull();
    expect(
      screen.queryByRole('combobox', { name: 'Outcome' }),
      'the lit control, again: the inspector rendered',
    ).not.toBeNull();
  });

  it('re-shows a STORED message under `completed`, so a stale value can be cleared', () => {
    renderInspector(draftWith({ outcome: 'completed', message: 'stale refusal text' }));
    const control = messageControl();
    expect(control, 'a stored message is never hidden from the author who has to clear it').not.toBeNull();
    expect(control!.value, 'and it shows the stored text').toBe('stale refusal text');
  });

  it('writes `config.message`, and a cleared box DELETES the key rather than storing ""', () => {
    // The end-to-end row: what the author types has to reach the key the
    // contract requires, in a shape the contract accepts.
    const { onPatch } = renderInspector(draftWith({ outcome: 'refused' }));
    const control = messageControl()!;
    fireEvent.change(control, { target: { value: 'Refused: {{ record.name }} is a confirmed duplicate' } });
    fireEvent.blur(control);

    expect(onPatch, 'the edit reached the draft').toHaveBeenCalled();
    const written = onPatch.mock.calls.at(-1)![0] as { nodes: Array<Record<string, unknown>> };
    const config = written.nodes[0].config as Record<string, unknown>;
    expect(config.message, 'the typed text lands on the key the contract names').toBe(
      'Refused: {{ record.name }} is a confirmed duplicate',
    );
    // ⭐ The whole point of the card, stated as a parse: what the form now
    // produces from a `refused` outcome LOADS.
    expect(
      FlowNodeSchema.safeParse({ id: 'n1', type: 'end', label: 'Done', config }).success,
      'and the node the form produced is one the contract accepts — the blocked path is open',
    ).toBe(true);

    // Now clear it. `setAtPath` deletes an empty leaf; a commit of `''` would be
    // refused under BOTH outcomes (pinned above), so this row is load bearing.
    cleanup();
    const second = renderInspector(draftWith({ outcome: 'refused', message: 'stale' }));
    const stored = messageControl()!;
    fireEvent.change(stored, { target: { value: '' } });
    fireEvent.blur(stored);
    const cleared = (second.onPatch.mock.calls.at(-1)![0] as { nodes: Array<Record<string, unknown>> }).nodes[0]
      .config as Record<string, unknown>;
    expect('message' in cleared, 'clearing DELETES the key — it never stores the empty string').toBe(false);
  });
});
