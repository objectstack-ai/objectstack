// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9830, maintainer ruling B — a predicate whose string arm a transform
 * ERASED reaches the condition builder once the served declaration MARKS that
 * arm, and only then.
 *
 * ## The husk, and the mark that tells it apart
 *
 * `/meta/types` serves the OUTPUT derivation. Every expression-input slot
 * (`hook.condition`, `sharing_rule.condition`, `field.visibleWhen` /
 * `readonlyWhen` / `requiredWhen`, a flow edge's `condition`, …) is a union
 * whose string arm is a transform, so that derivation describes what comes OUT
 * of it and the arm is served as `{}` — on the wire, the same bytes as a member
 * that admits anything. `SchemaForm` therefore vetoed both, and the builder
 * mounted for none of those slots.
 *
 * `@objectstack/metadata-protocol` (17.5.0 on) annotates the erased arm in
 * place instead of widening the derivation:
 *
 * ```
 * anyOf: [ { "x-objectstack-erased-authoring-input": { version: 1, type: "string" } },
 *          { type: 'object', properties: { dialect, source, ast, meta }, … } ]
 * ```
 *
 * The ruling: the shape test reads that mark, the husk-boundary pin inverts for
 * MARKED members only, and a key-name rule stays refused.
 *
 * ## Where the subject fixture comes from — re-derivable, not invented
 *
 * `HOOK_CONDITION` below is `hook.condition` exactly as the published
 * projection serves it. To reproduce it, install `@objectstack/metadata-protocol`
 * at the version objectui's lockfile resolves `@objectstack/spec` to, then:
 *
 * ```js
 * import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
 * import { listMetadataTypeSchemaTypes, listUnregisteredKindSchemaTypes } from '@objectstack/spec/kernel';
 * const types = [...listMetadataTypeSchemaTypes(), ...listUnregisteredKindSchemaTypes()];
 * const proto = new ObjectStackProtocolImplementation(
 *   { registry: { getRegisteredTypes: () => types } }, () => undefined);
 * const { entries } = JSON.parse(JSON.stringify(await proto.getMetaTypes()));
 * entries.find((e) => e.type === 'hook').schema.properties.condition;
 * ```
 *
 * The same served document is where the other shapes below are read from: the
 * mark's `type` is not always `string` (erased `object` and `array` arms are
 * marked too), and a genuinely open member such as `field.defaultValue` is a
 * bare `{}` with no mark — which is the unmarked control's shape.
 *
 * ## What this file pins
 *
 *  1. the MARKED husk renders the condition builder — asserted through the face
 *     that renders, scoped to that field's own label id;
 *  2. the UNMARKED husk in the SAME render still gets none — the control, and
 *     the half of the old boundary that stays a veto;
 *  3. the mark is READ, not merely detected: a mark naming another type, and a
 *     mark of a version this reader was not written for, both decline;
 *  4. the mark lifts the SHAPE veto only — the name still chooses, so a marked
 *     member no detector claims by name keeps its non-builder face;
 *  5. the declaration still decides, in both directions: an authored
 *     `widget: 'condition'` mounts the builder on an unmarked husk (the door
 *     authors had before the mark), and an authored non-builder widget on a
 *     marked husk is kept.
 *
 * ⚠️ Cases 2 and 3 are what make case 1 a pin and not a widening: read `{}` as
 * a string arm, or read the mark's presence instead of its value, and they go
 * red. ⛔ Neither is a test to relax.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';

// objectui#4697 — `ConditionBuilder` calls `useObjectFields(objectName)` on
// mount, so an unmocked client would escape to the real network. Nothing below
// reads the catalog: every assertion is about WHICH widget resolved.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('./useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { SchemaForm } from './SchemaForm';
import type { WidgetContext } from './widgets';

afterEach(cleanup);

const MARK = 'x-objectstack-erased-authoring-input';

/** ADR-0089's envelope arm, as the served output derivation emits it. */
const ENVELOPE = {
  type: 'object',
  properties: {
    dialect: { type: 'string', enum: ['cel', 'cron', 'template'] },
    source: { type: 'string' },
    ast: {},
    meta: {
      type: 'object',
      properties: { rationale: { type: 'string' }, generatedBy: { type: 'string' } },
      additionalProperties: false,
    },
  },
  required: ['dialect', 'source'],
  additionalProperties: false,
};

/** `hook.condition`, as the published projection serves it — see the header. */
const HOOK_CONDITION = {
  description:
    'Predicate (CEL); hook runs only when TRUE. e.g. P`record.status == "closed" && record.amount > 1000`',
  anyOf: [{ [MARK]: { version: 1, type: 'string' } }, ENVELOPE],
};

const SCHEMA = {
  type: 'object',
  properties: {
    // SUBJECT — the served, MARKED husk.
    condition: { ...HOOK_CONDITION, title: 'Marked husk' },
    // CONTROL — the same union with the mark absent: "admits anything".
    hidden: { title: 'Unmarked husk', anyOf: [{}, ENVELOPE] },
    // BOUNDARY — a mark whose erased type is not a string.
    disabled: { title: 'Object mark', anyOf: [{ [MARK]: { version: 1, type: 'object' } }, ENVELOPE] },
    // BOUNDARY — a mark of a version this reader does not know.
    visibleWhen: { title: 'Foreign version', anyOf: [{ [MARK]: { version: 2, type: 'string' } }, ENVELOPE] },
    // NAME — a marked string arm under a key no detector claims (the served
    // `field.expression` / `object.titleFormat` shape).
    expression: { title: 'Marked, unclaimed name', anyOf: [{ [MARK]: { version: 1, type: 'string' } }, ENVELOPE] },
  },
} as never;

/**
 * `flattened` is the scope every tier without a row binding gets. The verdict
 * under test is which WIDGET resolved, not which lint scope it then claims —
 * `none` would mount the same widget with its builder suppressed and could not
 * tell the two apart.
 */
const ctx: WidgetContext = { conditionScope: 'flattened' };

/**
 * The builder that resolved for one field, or `null`. `ConditionWidget` is a
 * `'group'`-labelled widget: its wrapper points at the host label it was given,
 * so the lookup is scoped to ONE field rather than to the page. Its own
 * signature inside that wrapper is the raw/visual toggle.
 */
function builderFor(field: string): HTMLElement | null {
  const group = document.querySelector<HTMLElement>(`[role="group"][aria-labelledby="mdf-${field}-label"]`);
  if (!group) return null;
  return within(group).queryByText('Expression') ? group : null;
}

const FIELDS = ['condition', 'hidden', 'disabled', 'visibleWhen', 'expression'] as const;

describe('#9830 ruling B — the shape gate reads the declaration mark on an erased arm', () => {
  it('a MARKED husk — `hook.condition` as served — reaches the condition builder', () => {
    render(<SchemaForm schema={SCHEMA} value={{}} onChange={() => {}} widgetContext={ctx} />);
    expect(
      builderFor('condition'),
      'the marked husk got no condition builder — the shape gate is not reading the declaration mark',
    ).not.toBeNull();
  });

  it('⛔ the UNMARKED husk in the same render still gets none — the control', () => {
    render(<SchemaForm schema={SCHEMA} value={{}} onChange={() => {}} widgetContext={ctx} />);
    expect(
      builderFor('hidden'),
      'an UNMARKED husk mounts the builder — a bare `{}` is being read as a string arm',
    ).toBeNull();
    // It keeps an editor: the union fallback, exactly as before the mark.
    expect(document.querySelector('#mdf-hidden')).not.toBeNull();
    // Same render: the subject's builder is there, so this null is a verdict
    // about the husk and not a widget that never mounts.
    expect(builderFor('condition')).not.toBeNull();
  });

  it('⛔ the mark is read for its VALUE: another erased type, or another version, declines', () => {
    render(<SchemaForm schema={SCHEMA} value={{}} onChange={() => {}} widgetContext={ctx} />);
    expect(
      builderFor('disabled'),
      'an arm marked as an erased OBJECT counted as a string arm — the mark is being read for presence, not type',
    ).toBeNull();
    expect(
      builderFor('visibleWhen'),
      'a mark of an unknown version counted — the reader is not gating on the version it was written for',
    ).toBeNull();
  });

  it('the mark lifts the shape veto only — a name no detector claims gets no builder', () => {
    render(<SchemaForm schema={SCHEMA} value={{}} onChange={() => {}} widgetContext={ctx} />);
    expect(builderFor('expression')).toBeNull();
    expect(document.querySelector('#mdf-expression')).not.toBeNull();
  });

  it('exactly the one marked predicate mounts the widget', () => {
    render(<SchemaForm schema={SCHEMA} value={{}} onChange={() => {}} widgetContext={ctx} />);
    // Whole-render accounting: a green subject cannot be a chain that converts
    // every union, and a green boundary cannot be a widget that never mounts.
    const mounted = FIELDS.filter((f) => builderFor(f) !== null);
    expect(mounted).toEqual(['condition']);
  });
});

describe('#9830 ruling B — the declaration still decides, in both directions', () => {
  /** Only the `widget` pin varies; the schemas are the ones above. */
  const FORM = {
    type: 'simple' as const,
    sections: [
      {
        label: 'Predicates',
        fields: [
          // The door the ruling named for authors while the mark was absent.
          { field: 'hidden', widget: 'condition' },
          // A marked husk under an explicit non-builder pin keeps that pin.
          { field: 'condition', widget: 'textarea' },
        ],
      },
    ],
  } as never;

  it('an authored `widget: \'condition\'` mounts the builder on an UNMARKED husk', () => {
    render(<SchemaForm schema={SCHEMA} form={FORM} value={{}} onChange={() => {}} widgetContext={ctx} />);
    expect(
      builderFor('hidden'),
      "an authored widget: 'condition' no longer wins outright over the shape veto",
    ).not.toBeNull();
  });

  it('an authored non-builder widget on a MARKED husk is kept — the mark does not outrank it', () => {
    render(<SchemaForm schema={SCHEMA} form={FORM} value={{}} onChange={() => {}} widgetContext={ctx} />);
    expect(
      builderFor('condition'),
      'the mark overrode an explicit form-spec widget — detectors are running over a declared widget',
    ).toBeNull();
    expect(document.querySelector('textarea#mdf-condition')).not.toBeNull();
  });
});
