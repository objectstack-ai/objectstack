/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-grid` REFUSES the retired string `sort` clause (objectui#8767).
 *
 * ## What was wrong
 *
 * The #8221 ruling (decision batch #77) retired the legacy OData-ish string
 * clause: one spelling, the array, everywhere. PR #8758 narrowed the shared
 * sink `convertSortToQueryParams` so a string that still arrives at runtime is
 * refused out loud and the query carries no `$orderby`.
 *
 * `ObjectGrid` never went through that sink. It reads `schema.sort` at its own
 * site and lowers it with private code, so after #8758 a bare `object-grid`
 * still forwarded a string verbatim to `$orderby` while the SAME key routed
 * through `object-view` was refused with a diagnostic — one key meaning two
 * things depending on which block you are on. That is precisely the shape the
 * ruling rejected when it declined option A by name:
 *
 *   > per-block arms would make one key mean different things on different
 *   > blocks and keep a spelling the spec already refuses on one of them.
 *
 * ## What these tests pin, and what they deliberately do NOT
 *
 * Route C, as ruled: the string arm is refused with #8758's own reporter, and
 * NOTHING else about this block moves. So the file has two halves, and the
 * second is what stops it passing by refusing everything:
 *
 *   1. a string `sort` reaches no `$orderby`, and says so once per spelling;
 *   2. the array arm still lowers to the very same `"field order"` join string
 *      this block has always sent — byte for byte, single- and multi-key.
 *
 * The join string is the wire shape route B would change and route C keeps.
 * The header-arrow reader `parseSchemaSort` and the export path read the same
 * key and are untouched here; they belong to that other card.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { resetRetiredSortSpellingReports } from '@object-ui/core';
// Registers `object-grid` and its `view:grid` alias.
import '../index';

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({
      data: [{ id: '1', name: 'Acme', status: 'active' }],
      total: 1,
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: { id: { type: 'text' }, name: { type: 'text' }, status: { type: 'text' } },
    }),
  };
}

/**
 * Render the block and return the params of its first `find` call — the same
 * harness shape as the sibling `gridDefaultFiltersLowering.test.tsx`, so both
 * legs of this read site are observed through one lens.
 */
async function findParamsFor(schema: Record<string, unknown>) {
  const adapter = makeAdapter();
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return (adapter.find.mock.calls[0] as [string, any])[1];
}

const BASE = { type: 'object-grid', objectName: 'account', columns: [{ field: 'name' }] };

/**
 * The retired spelling, reached the only way it still can be. The declaration
 * is `SortConfig[]` since #8221, so a string arrives from authored JSON, a
 * stored `sys_metadata` row or an `as any` bag — never from a typed caller.
 */
const authoredAtRuntime = (sort: unknown) => ({ ...BASE, sort }) as Record<string, unknown>;

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // The reporter dedupes per spelling in MODULE state. Without this reset the
  // second test to assert the diagnostic would observe silence and pass for
  // the wrong reason.
  resetRetiredSortSpellingReports();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('object-grid — the retired string `sort` clause is REFUSED at this block’s own read site (objectui#8767)', () => {
  it('carries NO `$orderby` for a string `sort`, and names the array form', async () => {
    const params = await findParamsFor(authoredAtRuntime('name desc'));

    // The defect in one line: this used to be the string `'name desc'`, i.e.
    // the grid honoured at runtime what `object-view` refuses.
    expect(params.$orderby).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(params, '$orderby')).toBe(false);

    expect(errorSpy).toHaveBeenCalled();
    const message = String(errorSpy.mock.calls[0][0]);
    // #8758's OWN diagnostic, not a second one written here: it quotes the
    // offending spelling and prescribes the array form, because a refusal with
    // no prescription only moves the author's problem.
    expect(message).toContain('"name desc"');
    expect(message).toContain("[{ field: 'name', order: 'desc' }]");
    expect(message).toContain('objectui#8221');
  });

  it('refuses a bare field string too — every retired spelling, not just the two-word one', async () => {
    const params = await findParamsFor(authoredAtRuntime('name'));
    expect(params.$orderby).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('reports once per spelling, not once per grid', async () => {
    await findParamsFor(authoredAtRuntime('name desc'));
    await findParamsFor(authoredAtRuntime('name desc'));
    // Two blocks inheriting the same bad view sort print one line between them
    // — the dedupe is the reporter's, and reusing it is what keeps this read
    // site from becoming a second, differently-behaved diagnostic.
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('does not fall through to the legacy `defaultSort` leg when it refuses', async () => {
    // A refusal that quietly handed the query to the next arm would be a
    // silent substitution — a different ordering than either the author asked
    // for or the refusal announced. (Since objectui#5861 retired `defaultSort`
    // there is no such arm left to fall to; the cell stays as the guard that
    // none is re-added.)
    const params = await findParamsFor({
      ...authoredAtRuntime('name desc'),
      defaultSort: { field: 'status', order: 'asc' },
    });
    expect(params.$orderby).toBeUndefined();
  });
});

describe('CONTROL — the array arm lowers UNCHANGED (route C keeps this block’s wire shape)', () => {
  it('still sends the single-key `"field order"` join string', async () => {
    const params = await findParamsFor({ ...BASE, sort: [{ field: 'name', order: 'desc' }] });
    // Byte-identical to what this block sent before #8767. Route B would send
    // the shared sink's `{ name: 'desc' }` map here; that is a different card,
    // and this line is what would catch it arriving by accident.
    expect(params.$orderby).toBe('name desc');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still joins a multi-key array with `, `', async () => {
    const params = await findParamsFor({
      ...BASE,
      sort: [
        { field: 'status', order: 'asc' },
        { field: 'name', order: 'desc' },
      ],
    });
    expect(params.$orderby).toBe('status asc, name desc');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
