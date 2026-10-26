// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5039 — the SIX `SchemaForm` render paths that never reach the
 * `WIDGETS` registry, and therefore had no `labelling` declaration to route
 * their label by.
 *
 * ## What was measured
 *
 * objectui#4871 (PR #5041) put a `labelling` declaration on all twenty registry
 * entries and made `FieldRow` emit the channel it dictates. Six paths bypass the
 * registry entirely: `composite` / `repeater` / `record` come from
 * `fieldSpec.type` and short-circuit ahead of the registry lookup, and the three
 * structural fallbacks were chosen INSIDE `FieldControl` from the union-resolved
 * `effective` schema — i.e. after `FieldRow` had already written its label. All
 * six took the default `control` channel and none of them consumed the `id`.
 * Probed on real `SchemaForm` renders at `e7c5a80a8`, both states, same columns
 * as the #4871 ledger plus what the face actually owns:
 *
 * ```
 *                                editable / read-only (identical)
 * (spec) composite               for=DANGLING hostIdEl=NONE  group=NONE  labelable=1[input]
 * (spec) repeater                for=DANGLING hostIdEl=NONE  group=NONE  labelable=[button]
 * (spec) record                  for=DANGLING hostIdEl=NONE  group=NONE  labelable=[button,input]
 * (fallback) nested-object       for=DANGLING hostIdEl=NONE  group=NONE  labelable=1[input]
 * (fallback) array-of-obj        for=DANGLING hostIdEl=NONE  group=NONE  labelable=[button]
 * (fallback) raw-json            for=DANGLING hostIdEl=NONE  group=NONE  labelable=1[textarea]
 * ```
 *
 * `hostIdEl=NONE` twelve times over: the `for` pointed at an id no element in the
 * document carried, the same failure class as #4871 / #4857 / #4788 — an
 * association that resolves to nothing reads to tooling as closed, which is worse
 * than none at all.
 *
 * The `labelable=` column is what decided each disposition, and it does NOT come
 * out uniform:
 *
 *  - `composite` and `nested-object` do contain one labelable `<input>`, but it
 *    belongs to a SUB-field's own `<label for>` (`mdf-probe.sub` /
 *    `mdf-probe.inner` — path-scoped since objectui#5062). The
 *    outer field owns nothing of its own to address → container, `'group'`;
 *  - `repeater` / `array-of-obj` / `record` own only auxiliary buttons — collapse,
 *    add, remove — and just the collapse toggles when read-only → `'group'`;
 *  - `raw-json` is the exception the card asked to CONFIRM rather than assume.
 *    Its face is exactly one labelable element, a `<textarea>` no other label
 *    addresses, in every branch and both states. It read `hostIdEl=NONE` because
 *    the id was never PLUMBED to it, not because the face cannot hold one → it is
 *    a real `'control'` face, and wrapping a lone textarea in a named group
 *    instead would name the container and leave the control the user types in
 *    anonymous (objectui#4010's ruling, in reverse).
 *
 * ## What this file pins
 *
 * Two independent halves, so neither can carry the other:
 *
 *  1. the LEDGER — each path's face kind and channel spelled out here and
 *     asserted against `resolveFieldFace` / `faceLabelling`, so flipping a
 *     classification in the source fails a test rather than silently re-routing;
 *  2. host/DOM AGREEMENT — the channel the assertions demand is read from
 *     `faceLabelling()` (not from a second hand-written list), while the DOM half
 *     comes from a real render. A resolver that misclassifies a path therefore
 *     fails here too: it hands the id to a face that never spreads it.
 *
 * Group cases assert the named surface EXISTS and answers the IDREF — not merely
 * that the `for` is gone, which is equally true of a path that renders nothing.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

// The `code` widget reads the page's Monaco loader probe on mount
// (objectui#11858). Unstubbed, the real loader injects its CDN script, which
// this environment refuses, and the loader leaves a rejection that no browser
// listener is here to cancel. Monaco's loader fails (offline), as on an install
// without CDN access, so the widget renders its textarea fallback.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});
import {
  SchemaForm,
  resolveFieldFace,
  faceLabelling,
  type FieldFace,
  type FormFieldSpec,
} from './SchemaForm';
import { WIDGET_LABELLING } from './widgets';

afterEach(cleanup);

/** The HTML elements a `<label for>` can actually address. */
const LABELABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'METER', 'OUTPUT', 'PROGRESS']);

// `prettify('probe') === 'Probe'`, so `FieldRow` renders no machine-name `<code>`
// inside the label and the accessible name is the visible text alone.
const NAME = 'probe';
const HOST_ID = `mdf-${NAME}`;
const LABEL_ID = `${HOST_ID}-label`;
const TITLE = 'Probe';

type Case = {
  /** The ledger row this case is. */
  tag: string;
  /** The face this path must resolve to — the ledger, spelled out. */
  face: FieldFace['kind'];
  schema: Record<string, unknown>;
  spec?: Record<string, unknown>;
  value?: unknown;
};

/**
 * The six non-registry paths, plus the second shape of three of them: a
 * `nested-object` reached through a union instead of an inferred
 * `object-fields` widget, a `raw-json` announced by an unregistered widget name,
 * a `composite` in its popover disclosure, and a `record` that delegates to a
 * registered widget. Each shape is a distinct route to the same face and each
 * one was `for=DANGLING` before.
 */
const CASES: Case[] = [
  {
    tag: '(spec) composite',
    face: 'composite',
    spec: { type: 'composite', fields: [{ field: 'sub', type: 'text' }] },
    schema: { type: 'object', title: TITLE, properties: { sub: { type: 'string' } } },
    value: { sub: 'a' },
  },
  {
    tag: '(spec) composite / popover disclosure',
    face: 'composite',
    spec: { type: 'composite', disclosure: 'popover', fields: [{ field: 'sub', type: 'text' }] },
    schema: { type: 'object', title: TITLE, properties: { sub: { type: 'string' } } },
    value: { sub: 'a' },
  },
  {
    tag: '(spec) repeater',
    face: 'repeater',
    spec: { type: 'repeater', fields: [{ field: 'sub', type: 'text' }] },
    schema: {
      type: 'array',
      title: TITLE,
      items: { type: 'object', properties: { sub: { type: 'string' } } },
    },
    value: [{ sub: 'a' }],
  },
  {
    tag: '(spec) repeater / grid layout',
    face: 'repeater',
    spec: { type: 'repeater', widget: 'grid', fields: [{ field: 'sub', type: 'text' }] },
    schema: {
      type: 'array',
      title: TITLE,
      items: { type: 'object', properties: { sub: { type: 'string' } } },
    },
    value: [{ sub: 'a' }],
  },
  {
    tag: '(spec) record',
    face: 'record',
    spec: { type: 'record' },
    schema: {
      type: 'object',
      title: TITLE,
      additionalProperties: {
        type: 'object',
        properties: { name: { type: 'string' }, label: { type: 'string' } },
      },
    },
    value: { alpha: { name: 'alpha' } },
  },
  {
    // The record face's other shape: the whole editor delegated to a registered
    // widget. `fieldSpec.type` still decides the face — the registry lookup is
    // short-circuited — so the channel is the record's, and the IDREF has to
    // reach the delegate for the declaration to hold.
    tag: '(spec) record / delegated to a registered widget',
    face: 'record',
    spec: { type: 'record', widget: 'code' },
    schema: { type: 'object', title: TITLE, additionalProperties: { type: 'object' } },
    value: { alpha: {} },
  },
  {
    // `inferWidget` returns `object-fields` for every `type: 'object'` schema;
    // it is not a registry key, so this lands in the widget branch's structural
    // fallback.
    tag: '(fallback) nested-object',
    face: 'nested-form',
    schema: { type: 'object', title: TITLE, properties: { inner: { type: 'string' } } },
    value: { inner: 'a' },
  },
  {
    // The same face with NO widget hint at all: the outer schema has no `type`,
    // so the union has to be resolved before the object branch is visible — the
    // View `data`-provider shape.
    tag: '(fallback) nested-object / union-resolved',
    face: 'nested-form',
    schema: {
      title: TITLE,
      anyOf: [{ type: 'string' }, { type: 'object', properties: { provider: { type: 'string' } } }],
    },
    value: { provider: 'rest' },
  },
  {
    // The View `sort` shape (objectui#3379): `anyOf: [string, {field,order}[]]`.
    tag: '(fallback) array-of-obj',
    face: 'object-rows',
    schema: {
      title: TITLE,
      anyOf: [
        { type: 'string' },
        { type: 'array', items: { type: 'object', properties: { field: { type: 'string' } } } },
      ],
    },
    value: [{ field: 'name' }],
  },
  {
    tag: '(fallback) raw-json',
    face: 'raw-json',
    schema: { title: TITLE },
    value: { anything: 1 },
  },
  {
    // An unregistered, non-passthrough widget name: the JSON editor plus the
    // "no renderer for <widget>" hint. Reached before the scalar chain, so even
    // this `type: 'string'` field renders the editor.
    tag: '(fallback) raw-json / unregistered widget hint',
    face: 'raw-json',
    spec: { widget: 'gizmo' },
    schema: { type: 'string', title: TITLE },
    value: 'x',
  },
];

function renderCase(c: Case, readOnly: boolean) {
  const spec = { field: NAME, ...c.spec } as FormFieldSpec;
  return render(
    <SchemaForm
      schema={{ type: 'object', properties: { [NAME]: c.schema } } as never}
      form={{ type: 'simple', sections: [{ label: 'S', fields: [spec] }] } as never}
      value={{ [NAME]: c.value }}
      onChange={() => {}}
      readOnly={readOnly}
    />,
  );
}

const faceOf = (c: Case) =>
  resolveFieldFace({
    fieldSpec: { field: NAME, ...c.spec } as FormFieldSpec,
    // `FieldRow` resolves the widget name before calling; for these paths that is
    // either the authored one or nothing (an inferred `object-fields` /
    // `master-detail` would be the registry's business, not this file's).
    widget: (c.spec as { widget?: string } | undefined)?.widget,
    schema: c.schema,
    value: c.value,
  });

describe('resolveFieldFace — the lifted decision, as a pure function', () => {
  for (const c of CASES) {
    it(`${c.tag} → ${c.face}`, () => {
      expect(faceOf(c).kind).toBe(c.face);
    });
  }

  it('keeps the registry as the authority for a REGISTERED widget', () => {
    // The lifted resolver must not second-guess objectui#4871's reviewed table:
    // a registry key resolves to `registered` and its channel comes from
    // `WIDGET_LABELLING`, group and control alike.
    const cond = resolveFieldFace({ widget: 'condition', schema: { type: 'string' } });
    expect(cond).toEqual({ kind: 'registered', widget: 'condition' });
    expect(faceLabelling(cond)).toBe(WIDGET_LABELLING['condition']);
    expect(faceLabelling(cond)).toBe('group');

    const icon = resolveFieldFace({ widget: 'icon', schema: { type: 'string' } });
    expect(faceLabelling(icon)).toBe(WIDGET_LABELLING['icon']);
    expect(faceLabelling(icon)).toBe('control');
  });

  it('routes every builtin scalar branch to the one `scalar` face', () => {
    // Each of these renders a labelable control that spreads the host id, so they
    // are one face for naming purposes — unchanged from before the lift.
    const scalars: Array<Parameters<typeof resolveFieldFace>[0]> = [
      { schema: { type: 'string' } },
      { schema: { type: 'number' } },
      { schema: { type: 'integer' } },
      { schema: { type: 'boolean' } },
      { schema: { type: 'string', enum: ['a', 'b'] } },
      { schema: { type: 'array', items: { type: 'string' } } },
      { schema: {}, fieldSpec: { field: 'f', options: [{ label: 'A', value: 'a' }] } },
      // A composite sub-field's schema fragment is often `{}` while the spec
      // marks it boolean — the `switch` case that predates this change.
      { schema: {}, fieldSpec: { field: 'f', type: 'boolean' } },
      { schema: {}, widget: 'switch' },
      // A union of primitives resolves against the value before the type check.
      { schema: { anyOf: [{ type: 'string' }, { type: 'number' }] }, value: 7 },
    ];
    for (const input of scalars) {
      const face = resolveFieldFace(input);
      expect(face.kind, JSON.stringify(input)).toBe('scalar');
      expect(faceLabelling(face)).toBe('control');
    }
  });

  it('keeps a PASSTHROUGH widget hint on the scalar path, but not over structure', () => {
    // `json` / `text` / `textarea` … are hints that overlay the default control:
    // they must not divert a string to the JSON editor…
    expect(resolveFieldFace({ widget: 'json', schema: { type: 'string' } }).kind).toBe('scalar');
    // …while an unregistered, non-passthrough name does exactly that.
    expect(resolveFieldFace({ widget: 'gizmo', schema: { type: 'string' } })).toEqual({
      kind: 'raw-json',
      hint: 'gizmo',
    });
    // A structured schema still wins over the passthrough hint, as it always did.
    expect(
      resolveFieldFace({
        widget: 'json',
        schema: { type: 'object', properties: { a: { type: 'string' } } },
      }).kind,
    ).toBe('nested-form');
  });

  it('resolves the repeater row schema through a union (objectui#3379)', () => {
    // The face carries the resolved `items`, so the sub-field list and the
    // per-row controls both see real sub-schemas rather than a blank row.
    const face = resolveFieldFace({
      fieldSpec: { field: 'sort', type: 'repeater' },
      schema: {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'object', properties: { field: { type: 'string' } } } },
        ],
      },
      value: [{ field: 'name' }],
    });
    expect(face.kind).toBe('repeater');
    expect((face as { itemSchema: Record<string, unknown> }).itemSchema.properties).toEqual({
      field: { type: 'string' },
    });
  });

  it('declares a channel for every face kind, and the six non-registry ones by measurement', () => {
    // `faceLabelling` is a total function over the union — a new face kind added
    // without a channel is a compile error there, and this is its runtime half.
    const kinds: FieldFace['kind'][] = [
      'composite',
      'repeater',
      'record',
      'registered',
      'nested-form',
      'object-rows',
      'raw-json',
      'scalar',
    ];
    const channels = Object.fromEntries(
      kinds
        .filter((k) => k !== 'registered')
        .map((k) => [k, faceLabelling({ kind: k } as FieldFace)]),
    );
    expect(channels).toEqual({
      composite: 'group',
      repeater: 'group',
      record: 'group',
      'nested-form': 'group',
      'object-rows': 'group',
      // MEASURED, not assumed: one labelable `<textarea>`, both states.
      'raw-json': 'control',
      scalar: 'control',
    });
    // Every case in the ledger below covers one of the eight kinds, and between
    // them the six non-registry faces are all exercised through a real render.
    expect([...new Set(CASES.map((c) => c.face))].sort()).toEqual(
      ['composite', 'nested-form', 'object-rows', 'raw-json', 'record', 'repeater'].sort(),
    );
  });
});

describe('the ledger, re-measured: every non-registry path gets the channel its face declares', () => {
  for (const c of CASES) {
    for (const readOnly of [false, true]) {
      const state = readOnly ? 'read-only' : 'editable';
      const declared = faceLabelling({ kind: c.face } as FieldFace);

      it(`${c.tag} — ${declared}, ${state}`, () => {
        renderCase(c, readOnly);
        const label = screen.getByText(TITLE).closest('label')!;
        expect(label.tagName).toBe('LABEL');

        if (declared === 'control') {
          // Column 1: the `for` resolves, AND to a LABELABLE element. "The id is
          // on SOME element" is the deceptive green a half-fix produces.
          expect(label).toHaveAttribute('for', HOST_ID);
          expect(label).not.toHaveAttribute('id');
          const target = document.getElementById(HOST_ID);
          expect(target, `${c.tag}: host id is on no element in the ${state} state`).not.toBeNull();
          expect(
            LABELABLE.has(target!.tagName),
            `${c.tag}: host id landed on <${target!.tagName.toLowerCase()}>, which no <label for> can address`,
          ).toBe(true);
          // Column 3: the named surface IS that control, named by the visible
          // label rather than by some self-owned string.
          expect(target).toHaveAccessibleName(TITLE);
          return;
        }

        // `'group'`. Column 1: no `for` at all — not a `for` pointing somewhere
        // harmless. On a container it activates nothing and names nothing, and
        // beside the working IDREF it is a second, broken channel (#3978/#4010).
        expect(label).not.toHaveAttribute('for');
        expect(label).toHaveAttribute('id', LABEL_ID);
        expect(document.getElementById(HOST_ID)).toBeNull();

        // Columns 2 + 3: the face EXISTS, answers the IDREF, and is a group.
        // Asserted positively on purpose — a path that rendered nothing would
        // satisfy every "is absent" assertion above.
        const named = document.querySelector(`[aria-labelledby="${LABEL_ID}"]`);
        expect(named, `${c.tag}: nothing answers the host label's IDREF in the ${state} state`).not.toBeNull();
        expect(['group', 'radiogroup']).toContain(named!.getAttribute('role'));
        expect(named).toHaveAccessibleName(TITLE);
      });
    }
  }
});

describe('a group name does not swallow the sub-fields it contains', () => {
  // `nested-object` recurses into a whole nested `SchemaForm`, and `composite`
  // into recursive `FieldRow`s. Naming the outer container must leave every inner
  // field's own channel intact — the inner rows are the reason the outer face is
  // a group in the first place.
  it('nested-object — the inner field keeps its own `for`, and the outer name is only the outer label', () => {
    render(
      <SchemaForm
        schema={
          {
            type: 'object',
            properties: {
              [NAME]: {
                type: 'object',
                title: TITLE,
                properties: { inner: { type: 'string', title: 'Inner' } },
              },
            },
          } as never
        }
        form={{ type: 'simple', sections: [{ label: 'S', fields: [{ field: NAME }] }] } as never}
        value={{ [NAME]: { inner: 'a' } }}
        onChange={() => {}}
      />,
    );

    const group = document.querySelector(`[aria-labelledby="${LABEL_ID}"]`)!;
    // The outer group is named by the outer label ALONE, though it contains the
    // inner label's text too: `aria-labelledby` wins over subtree content.
    expect(group).toHaveAccessibleName(TITLE);

    // The inner field is a plain control on its own `control` channel, reached by
    // its own label — not by the outer one, and not by `aria-labelledby`.
    // Its id is scoped under the host field's path (objectui#5062): a nested
    // `inner` and a top-level `inner` are two fields and must not share an id.
    const innerLabel = within(group as HTMLElement).getByText('Inner').closest('label')!;
    expect(innerLabel).toHaveAttribute('for', `${HOST_ID}.inner`);
    const innerInput = document.getElementById(`${HOST_ID}.inner`)!;
    expect(innerInput.tagName).toBe('INPUT');
    expect(innerInput).not.toHaveAttribute('aria-labelledby');
    expect(innerInput).toHaveAccessibleName('Inner');
    // And the inner control is inside the outer group rather than replacing it —
    // the outer field never claimed it as its own control.
    expect(group.contains(innerInput)).toBe(true);
    expect(group).not.toBe(innerInput);
  });

  it('composite — each sub-row keeps its own `for` under the named box', () => {
    render(
      <SchemaForm
        schema={
          { type: 'object', properties: { [NAME]: { type: 'object', title: TITLE, properties: { sub: { type: 'string' } } } } } as never
        }
        form={
          {
            type: 'simple',
            sections: [
              { label: 'S', fields: [{ field: NAME, type: 'composite', fields: [{ field: 'sub', type: 'text', label: 'Sub' }] }] },
            ],
          } as never
        }
        value={{ [NAME]: { sub: 'a' } }}
        onChange={() => {}}
      />,
    );

    const group = document.querySelector(`[aria-labelledby="${LABEL_ID}"]`)!;
    expect(group).toHaveAccessibleName(TITLE);
    // Path-scoped under the composite's own field (objectui#5062).
    const subInput = document.getElementById(`${HOST_ID}.sub`)!;
    expect(subInput.tagName).toBe('INPUT');
    expect(subInput).toHaveAccessibleName('Sub');
    expect(within(group as HTMLElement).getByText('Sub').closest('label')).toHaveAttribute('for', `${HOST_ID}.sub`);
  });
});
