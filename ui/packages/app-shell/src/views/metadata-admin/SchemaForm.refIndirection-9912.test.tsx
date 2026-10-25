// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9912 — `SchemaForm` follows the ONE indirection the served
 * derivation uses, and the rows it cannot help are pinned as such.
 *
 * ## What the card said, and which half of it survived measurement
 *
 * The card reported that the served `/meta/types` derivation carries property
 * rows that are a bare `$ref` while this form resolved none, so the author got
 * the raw-JSON fallback "instead of an editor derived from the shape the schema
 * does declare". The first half is true and this file fixes it. The second half
 * is true for a MINORITY of those rows, and the rows the card NAMED are not
 * among them — which is why the negative cases below are not padding:
 *
 *  - every `*.filter` / `*Filter` row it listed (`dataset.filter`,
 *    `field.relatedListFilter`, `report.runtimeFilter`,
 *    `dashboard.widgets[].filter`, …) points at ONE definition: the recursive
 *    Query-DSL `FilterCondition`, whose derivation is
 *    `allOf: [ an open record, { $and / $or / $not } ]`. No top-level `type`,
 *    no top-level `properties` ⇒ {@link resolveFieldFace} lands on the SAME
 *    JSON editor after resolution as before it. Nothing is bought there, and
 *    the spec's own `report` form declares `widget: 'json'` on `runtimeFilter`,
 *    so the JSON editor is the INTENDED control rather than a fallback;
 *  - the rows that do move are the ones whose `$ref` sits in an ARRAY-ITEMS or
 *    RECORD-VALUE position and points at an object shape — `app.navigation`
 *    being the reachable one: today one `<textarea>`, with this change a
 *    repeater whose rows carry real labelled controls.
 *
 * ## Where the two real fixtures come from — re-derivable, not invented
 *
 * Both are read from the installed `@objectstack/spec` through the same
 * `z.toJSONSchema` call `/meta/types` is served with:
 *
 * ```js
 * import * as z from 'zod';
 * import { getMetadataTypeSchema } from '@objectstack/spec/kernel';
 * const app = z.toJSONSchema(getMetadataTypeSchema('app'), { unrepresentable: 'any' });
 * app.properties.navigation.items          // SUBJECT — a bare `$ref`
 * const report = z.toJSONSchema(getMetadataTypeSchema('report'), { unrepresentable: 'any' });
 * report.properties.runtimeFilter          // NEGATIVE — a bare `$ref` that buys nothing
 * ```
 *
 * ⚠️ Reading the live corpus is deliberate and it is a TRIPWIRE: if the
 * producer stops emitting a bare `$ref` in either position, these two go red
 * and the reader is told the population this change served has moved, rather
 * than being left with a pin that passes while testing nothing.
 *
 * ## The CONTROL is the same document with `$defs` deleted
 *
 * A pointer with no dictionary to resolve against is left exactly as it is —
 * which is, byte for byte, the behaviour this change replaces. So each subject
 * renders twice in the same test, through the same component, differing only in
 * whether the definitions the document already carries are reachable. ⛔ No
 * source-text assertion: every verdict below is read off the rendered face.
 *
 * ## What must NOT move
 *
 * A resolver near the widget decision is one bug away from rewriting every
 * field, so the negatives are load-bearing: a non-`$ref` row in the SAME render
 * keeps the control it has today, a document with no `$defs` at all renders
 * identically, and the self-recursive arm keeps its indirection instead of
 * hanging the walk.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { z } from 'zod';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';

// The condition/field widgets call `useObjectFields()` on mount, so an unmocked
// client would escape to the real network. Nothing below reads the catalog.
const state = vi.hoisted(() => ({
  metadataClient: {
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => [] as unknown[]),
  },
}));
vi.mock('./useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { SchemaForm } from './SchemaForm';

afterEach(cleanup);

type Json = Record<string, any>;

/** The served derivation for one metadata type, as `/meta/types` produces it. */
function servedSchema(type: string): Json {
  const zod = getMetadataTypeSchema(type);
  expect(zod, `no Zod schema registered for "${type}"`).toBeTruthy();
  return z.toJSONSchema(zod as never, { unrepresentable: 'any' }) as Json;
}

/**
 * The CONTROL arm: the same document with its definition dictionary removed, so
 * no pointer in it can resolve. That is precisely the pre-change behaviour.
 */
function withoutDefs(doc: Json): Json {
  const copy: Json = { ...doc };
  delete copy.$defs;
  delete copy.definitions;
  return copy;
}

/** Every form-field DOM id currently in the tree. */
function fieldIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[id]'))
    .map((el) => (el as HTMLElement).id)
    .filter((id) => id.startsWith('mdf-'));
}

/**
 * Open every collapsed container exactly once — sections, repeater rows, nested
 * boxes. Each button is clicked at most once on purpose: a toggle clicked twice
 * closes what it opened, which reads back as "the field is not there".
 */
function openEverything(container: HTMLElement): void {
  const clicked = new WeakSet<Element>();
  for (let round = 0; round < 12; round += 1) {
    const before = fieldIds(container).join(',');
    const buttons = Array.from(container.querySelectorAll('button')).filter((b) => !clicked.has(b));
    if (buttons.length === 0) break;
    for (const button of buttons) {
      const text = `${button.textContent ?? ''} ${button.getAttribute('aria-label') ?? ''} ${button.getAttribute('title') ?? ''}`;
      if (/remove|delete|add item/i.test(text)) continue;
      clicked.add(button);
      fireEvent.click(button);
    }
    if (fieldIds(container).join(',') === before && round > 3) break;
  }
}

/** Render one document and report what the author can address. */
function renderFields(schema: Json, value: unknown): { ids: string[]; container: HTMLElement } {
  const { container } = render(
    <SchemaForm schema={schema as never} value={value as never} onChange={() => {}} />,
  );
  openEverything(container);
  return { ids: fieldIds(container), container };
}

describe('objectui#9912 — `$ref` indirection in the served metadata schema', () => {
  it('SUBJECT: an array-items `$ref` becomes a repeater with real per-row controls', () => {
    const app = servedSchema('app');
    const navigation = app.properties?.navigation;
    // The shape this case exists for. If the producer stops emitting it, the
    // assertion below says so instead of passing vacuously.
    expect(typeof navigation?.items?.$ref, 'app.navigation.items is no longer a `$ref`').toBe('string');
    expect(navigation.items.type, 'app.navigation.items now carries its own `type`').toBeUndefined();

    const document = { type: 'object', properties: { navigation }, $defs: app.$defs } as Json;
    const value = { navigation: [{ id: 'home', label: 'Home' }] };

    const control = renderFields(withoutDefs(document), value);
    expect(control.ids).toEqual(['mdf-navigation']);
    expect(control.container.querySelector('#mdf-navigation')?.tagName).toBe('TEXTAREA');

    cleanup();

    const subject = renderFields(document, value);
    // The row's own fields are addressable — the point of the whole change.
    expect(subject.ids).toContain('mdf-navigation.0.id');
    expect(subject.ids).toContain('mdf-navigation.0.label');
    expect(subject.container.querySelector('#mdf-navigation\\.0\\.id')?.tagName).toBe('INPUT');
    // …and the single opaque JSON control it replaces is gone.
    expect(subject.ids).not.toContain('mdf-navigation');
  });

  it('NEGATIVE: the `FilterCondition` rows the card named keep the JSON editor', () => {
    const report = servedSchema('report');
    const runtimeFilter = report.properties?.runtimeFilter;
    expect(typeof runtimeFilter?.$ref, 'report.runtimeFilter is no longer a `$ref`').toBe('string');

    const document = {
      type: 'object',
      properties: {
        // SUBJECT of this case — a `$ref` whose target derives to an `allOf`
        // husk, so resolving it reaches the same face.
        runtimeFilter,
        // CONTROL in the same render — an ordinary row that never was a `$ref`
        // and must come out exactly as it does today.
        description: report.properties.description,
        drilldown: report.properties.drilldown,
      },
      $defs: report.$defs,
    } as Json;

    const control = renderFields(withoutDefs(document), {});
    const controlIds = control.ids;
    const controlFilterTag = control.container.querySelector('#mdf-runtimeFilter')?.tagName;
    const controlDescriptionTag = control.container.querySelector('#mdf-description')?.tagName;

    cleanup();

    const subject = renderFields(document, {});
    // Same fields, same faces — resolving this pointer buys the author nothing.
    expect(subject.ids).toEqual(controlIds);
    expect(subject.container.querySelector('#mdf-runtimeFilter')?.tagName).toBe(controlFilterTag);
    expect(subject.container.querySelector('#mdf-runtimeFilter')?.tagName).toBe('TEXTAREA');
    // The non-`$ref` neighbour is untouched: a resolver must not rewrite rows
    // that never asked for one.
    expect(subject.container.querySelector('#mdf-description')?.tagName).toBe(controlDescriptionTag);
    expect(subject.ids).toContain('mdf-drilldown');
  });

  it('the self-recursive arm keeps its indirection instead of hanging the walk', () => {
    // `FilterCondition` is the real instance of this: the definition refers to
    // itself, so an eager resolver never terminates. The outer pointer resolves;
    // the one already on the stack is left as the `$ref` node it is, which is
    // the pre-change face for that arm.
    const document: Json = {
      type: 'object',
      properties: { where: { $ref: '#/$defs/cond' } },
      $defs: {
        cond: {
          type: 'object',
          properties: {
            label: { type: 'string', title: 'Label' },
            nested: { $ref: '#/$defs/cond' },
          },
        },
      },
    };

    const { ids, container } = renderFields(document, {});
    // Outer pointer followed: the object's own rows are addressable.
    expect(ids).toContain('mdf-where.label');
    expect(container.querySelector('#mdf-where\\.label')?.tagName).toBe('INPUT');
    // Recursive arm NOT followed: it keeps the last-resort editor.
    expect(container.querySelector('#mdf-where\\.nested')?.tagName).toBe('TEXTAREA');
  });

  it("a row's own keywords win over the definition it points at", () => {
    // The derivation puts the row's help text beside the `$ref`
    // (`{ description: 'Render-time scope filter', $ref: … }`), so the inlined
    // target is the BASE and the row's own keys are laid over it. Reversed, the
    // author would read the definition's prose instead of the field's.
    const document: Json = {
      type: 'object',
      properties: {
        note: { $ref: '#/$defs/text', description: 'The row says this' },
      },
      $defs: { text: { type: 'string', description: 'The definition says that' } },
    };

    const { container } = renderFields(document, {});
    expect(container.querySelector('#mdf-note')?.tagName).toBe('INPUT');
    expect(container.textContent).toContain('The row says this');
    expect(container.textContent).not.toContain('The definition says that');
  });

  it('a document with no definitions to resolve against renders exactly as before', () => {
    const document: Json = {
      type: 'object',
      properties: {
        label: { type: 'string', title: 'Label' },
        enabled: { type: 'boolean', title: 'Enabled' },
        // An UNRESOLVABLE pointer — no dictionary at all. It must keep the
        // last-resort editor rather than disappear or throw.
        dangling: { $ref: '#/$defs/missing' },
      },
    };

    const { ids, container } = renderFields(document, {});
    expect(ids).toEqual(['mdf-label', 'mdf-enabled', 'mdf-dangling']);
    expect(container.querySelector('#mdf-label')?.tagName).toBe('INPUT');
    expect(container.querySelector('#mdf-dangling')?.tagName).toBe('TEXTAREA');
  });
});
