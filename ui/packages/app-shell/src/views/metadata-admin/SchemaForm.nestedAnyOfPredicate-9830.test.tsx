// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9830 — a predicate whose string arm sits one `anyOf` DEEPER reaches
 * the condition builder, and the husk that means "nothing derived" still does
 * not.
 *
 * ## The defect, and why a flat pin never saw it
 *
 * `detectConditionWidget` gated on a ONE-LEVEL scan of `anyOf`
 * (`schema.anyOf.some(b => b.type === 'string')`). Every pin that exercised it
 * declared its predicate key as a bare `type: 'string'` or as a FLAT
 * `anyOf: [string, …]`, so all of them were green throughout — the shape the
 * platform actually serves for a predicate that ALSO accepts a boolean literal
 * was never in any fixture.
 *
 * ## Where the fixtures below come from — re-derivable, not invented
 *
 * Both predicate shapes are the real derivation of the installed
 * `@objectstack/spec`, through the same `z.toJSONSchema` call `/meta/types` is
 * served with. To reproduce either one:
 *
 * ```js
 * import * as z from 'zod';
 * import '@objectstack/spec';
 * import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
 * const doc = z.toJSONSchema(getMetadataTypeSchema('action'),
 *                            { unrepresentable: 'any', io: 'input' });
 * doc.properties.visible               // NESTED — the subject
 * doc.properties.params.items.properties.visible   // FLAT — the control
 * ```
 *
 * `action`'s OWN `visible` wraps the CEL union inside a second union so a plain
 * `true` / `false` literal is also accepted; its `params[].visible` does not.
 * One product, one key name, two nesting depths — which is what makes the flat
 * arm below a control rather than a second copy of the subject.
 *
 * ## What this file pins
 *
 *  1. the NESTED predicate renders the condition builder — the arm that was
 *     dark, asserted through the face that renders and scoped to that field's
 *     own label id, not through a widget name or a source-text read;
 *  2. the FLAT predicate renders the SAME face in the SAME render — it was
 *     green before this change and must stay green, so case 1 cannot be read as
 *     a builder that now mounts on anything;
 *  3. ⛔ the UNMARKED HUSK — `anyOf: [ {}, {…envelope} ]` with no declaration
 *     mark on the `{}` arm — still gets NO builder. `{}` is JSON Schema for
 *     "anything", and it is equally what "this transform erased its own input
 *     type" looks like on the wire; reading it as a string arm would mount a CEL
 *     builder on a genuinely boolean-only key. The declaration side now marks
 *     an erased arm, and a MARKED husk does get the builder — that inversion,
 *     and the boundaries of the mark read, are pinned in
 *     `SchemaForm.erasedArmMark-9830.test.tsx`; this case is the unmarked half
 *     and stays a veto;
 *  4. a predicate-NAMED key is still required: a plain `label` string keeps its
 *     text input, so the shape gate is not doing the naming's job either.
 *
 * ⚠️ Case 3 is the one that makes this a pin rather than a ratchet: widen the
 * gate to treat an UNMARKED `{}` as a string arm and it goes red, which is the
 * intended alarm and ⛔ not a test to relax.
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

/** ADR-0089's `{dialect, source}` envelope, as the derivation emits it. */
const ENVELOPE = {
  type: 'object',
  properties: {
    dialect: { type: 'string', enum: ['cel', 'cron', 'template'] },
    source: { type: 'string', minLength: 1 },
  },
  required: ['dialect'],
};

const SCHEMA = {
  type: 'object',
  properties: {
    // SUBJECT — `action.visible`: boolean literal OR the CEL union, nested.
    visible: {
      title: 'Nested predicate',
      anyOf: [{ type: 'boolean' }, { anyOf: [{ type: 'string', minLength: 1 }, ENVELOPE] }],
    },
    // CONTROL — `action.params[].visible`: the same union, top level.
    condition: { title: 'Flat predicate', anyOf: [{ type: 'string', minLength: 1 }, ENVELOPE] },
    // BOUNDARY — an output-mode husk whose erased arm carries NO declaration
    // mark: indistinguishable from "admits anything", so it keeps the veto.
    hidden: { title: 'Husk predicate', anyOf: [{}, ENVELOPE] },
    // NEGATIVE — a plain string that no naming convention claims.
    label: { title: 'Plain text', type: 'string' },
  },
} as never;

/**
 * `flattened` is the scope every tier without a row binding gets. The verdict
 * under test is which WIDGET resolved, not which lint scope it then claims —
 * `none` would mount the same widget with its builder suppressed and could not
 * tell the two apart.
 */
const ctx: WidgetContext = { conditionScope: 'flattened' };

function renderForm() {
  render(<SchemaForm schema={SCHEMA} value={{}} onChange={() => {}} widgetContext={ctx} />);
}

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

describe('#9830 — the predicate shape gate looks THROUGH a nested union', () => {
  it('a string arm nested one `anyOf` deeper reaches the condition builder', () => {
    renderForm();
    expect(
      builderFor('visible'),
      'the nested predicate got no condition builder — the shape gate is one-level again',
    ).not.toBeNull();
  });

  it('the FLAT predicate renders the same face in the same render — the control still fires', () => {
    renderForm();
    expect(
      builderFor('condition'),
      'the flat predicate lost its builder — this pin has no control left',
    ).not.toBeNull();
    // Same render, same corpus: both depths resolve to one face. That parity is
    // the claim; either one alone would only be a snapshot.
    expect(builderFor('visible')).not.toBeNull();
  });

  it('⛔ the UNMARKED husk `anyOf: [ {}, envelope ]` still gets NO builder', () => {
    renderForm();
    expect(
      builderFor('hidden'),
      'an UNMARKED husk now mounts the builder — a bare `{}` is being read as a string arm, which it is not',
    ).toBeNull();
    // It falls through to the union fallback, so the author still has an editor.
    expect(document.querySelector('#mdf-hidden')).not.toBeNull();
  });

  it('a non-predicate name keeps its plain text input — the naming still decides', () => {
    renderForm();
    expect(builderFor('label')).toBeNull();
    const plain = document.querySelector<HTMLInputElement>('input#mdf-label');
    expect(plain, 'the plain `label` field lost its text input').not.toBeNull();
  });

  it('exactly the two predicates with a real string arm mount the widget', () => {
    renderForm();
    // Whole-render accounting: a green subject cannot be a chain that converts
    // every field, and a green boundary cannot be a widget that never mounts.
    const mounted = ['visible', 'condition', 'hidden', 'label'].filter((f) => builderFor(f) !== null);
    expect(mounted).toEqual(['visible', 'condition']);
  });
});
