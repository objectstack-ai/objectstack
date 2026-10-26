// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio action editor offers no `aria` control (objectui#10929).
 *
 * `@objectstack/spec` 17.5.0 retired `action.aria` as a `retiredKey()`
 * tombstone: authoring it is a parse rejection, because no action surface ever
 * applied it. The accessible name an action gets is its `label`.
 *
 * ## Why this inspector keeps no `RETIRED_FIELDS` row for it
 *
 * The inspector has no `aria` control of its own. The only way it could offer
 * `aria` is through the "More fields" `SchemaForm`, which renders every
 * property of the SERVED `action` schema that is not curated or hidden. The
 * release that retired `aria` is also the first whose served derivation drops
 * every property no instance can satisfy: `stripUnauthorableProperties` in
 * `@objectstack/metadata-protocol`, which removes a non-required
 * `{ not: {} }` node. That is the node a tombstone derives to. So a server that
 * refuses `aria` never advertises it, and there is nothing for a hidden-field
 * row to hide. objectui#10929 measured this once through this inspector with
 * the payload the published 17.5.0 `getMetaTypes()` serves; the numbers are in
 * that PR, not here.
 *
 * ## Where the fixture comes from
 *
 * The schema below is derived from the installed `@objectstack/spec` with the
 * call `/meta/types` uses for `action` (the `io: 'input'` retry arm, since the
 * output derivation of `ActionSchema` is a husk). Then it applies the served
 * strip, top level only: a property whose node is `{ not: {} }` and that the
 * parent does not require is dropped. objectui does not install
 * `@objectstack/metadata-protocol`, so this is a reproduction of that one step,
 * not an import of it. It covers only the top level, because this file reads
 * only a top-level key.
 *
 * ## What this file pins
 *
 *  1. Fed the served schema, the editor offers no `aria` control, neither as a
 *     "More fields" row nor as a labelled control of its own. The same detector
 *     finds a served, non-curated row (`order`) and a curated control
 *     (`Label`). So an empty answer is not a detector that sees nothing.
 *  2. An action that already STORES an `aria` block (a row written before the
 *     retirement) opens without throwing. The editor shows the action as usual
 *     and still offers no `aria` control: `SchemaForm` builds its rows from
 *     the schema's properties, never from keys that only the value carries.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as z from 'zod';
import '@objectstack/spec';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';

// objectui#4697: the inspector calls `useObjectOptions()` and
// `useObjectFields()` on mount. Stub the shared client so that fetch does not
// escape to the network. Nothing below reads the catalog.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { ActionDefaultInspector } from './ActionDefaultInspector';

afterEach(cleanup);

type Json = Record<string, unknown>;

/** JSON Schema for "no instance validates": a `not` over the empty schema. */
function acceptsNothing(node: unknown): boolean {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const not = (node as Json).not;
  return typeof not === 'object' && not !== null && !Array.isArray(not) && Object.keys(not).length === 0;
}

/** The `action` schema as `/meta/types` serves it, top level. See the header. */
function servedActionSchema(): Json {
  const derived = z.toJSONSchema(getMetadataTypeSchema('action') as never, {
    unrepresentable: 'any',
    io: 'input',
  }) as Json;
  const required = new Set(Array.isArray(derived.required) ? (derived.required as string[]) : []);
  const properties = Object.fromEntries(
    Object.entries((derived.properties ?? {}) as Json).filter(([key, node]) => !(acceptsNothing(node) && !required.has(key))),
  );
  return { ...derived, properties };
}

const SERVED = servedActionSchema();

function mount(draft: Json) {
  render(
    <ActionDefaultInspector
      type="action"
      name="approve"
      draft={draft}
      onPatch={() => {}}
      readOnly={false}
      locale={'en-US' as never}
      serverSchema={SERVED}
    />,
  );
}

/**
 * Every way this inspector could offer a control for `key`: a "More fields"
 * row (its `mdf-` host id, whichever labelling the row resolved to), or any
 * control whose accessible name matches `name`, which is how a curated control
 * of its own would appear.
 */
function offered(key: string, name: RegExp): string[] {
  const hits: string[] = [];
  for (const id of [`mdf-${key}`, `mdf-${key}-label`]) {
    if (document.getElementById(id)) hits.push(`#${id}`);
  }
  for (const el of screen.queryAllByLabelText(name)) hits.push(`control named ${JSON.stringify(el.getAttribute('aria-label') ?? el.id)}`);
  return hits;
}

describe('ActionDefaultInspector offers no `aria` control (objectui#10929)', () => {
  it('fed the served action schema, offers no aria control', () => {
    mount({ name: 'approve', label: 'Approve', type: 'script' });

    expect(offered('aria', /\baria\b/i), 'the action editor offers an `aria` control').toEqual([]);

    // Firing controls. The same detector sees a served row that nothing curates,
    // and a curated control of the inspector's own.
    expect(offered('order', /^order$/i).length, 'the "More fields" form did not render').toBeGreaterThan(0);
    expect(offered('label', /^label$/i).length, 'the curated Label control did not render').toBeGreaterThan(0);
  });

  it('opens an action that already stores an aria block, and still offers no aria control', () => {
    mount({
      name: 'approve',
      label: 'Approve',
      type: 'script',
      aria: { ariaLabel: 'Approve the request', role: 'button' },
    });

    // It rendered the action, not an error state.
    expect(screen.getByLabelText(/^label$/i)).toHaveValue('Approve');
    expect(offered('order', /^order$/i).length, 'the "More fields" form did not render').toBeGreaterThan(0);
    // The stored block reaches no control: rows come from the schema's
    // properties, and the served schema has no `aria`.
    expect(offered('aria', /\baria\b/i), 'a stored `aria` block surfaced as a control').toEqual([]);
  });
});
