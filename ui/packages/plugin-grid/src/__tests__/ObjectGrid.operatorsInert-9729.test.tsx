/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An authored `operators` on an `object-grid` changes nothing drawn (objectui#9729).
 *
 * ## Why this reading exists
 *
 * `objectql.zod.ts#ObjectGridSchema` states `operators` and the `ObjectGridSchema`
 * twin does not — the second LOCAL entry in the `MirroredUndeclared` ledger, and
 * the one whose mirror line carries its own provenance: a comment saying the key
 * was missing from an earlier TypeScript scan. The contract review needs to know
 * whether a renderer consumes it.
 *
 * ⛔ A source grep cannot answer that, because this renderer receives a node's
 * leftover keys as props: `ObjectGridRenderer` spreads everything it does not
 * itself consume onto `ObjectGrid`. So the question is asked with a RULER — the
 * same document drawn twice, compared as bytes — rather than by reading code.
 *
 * ## The ruler, and why the control comes first
 *
 * A byte comparison that reports "no difference" is worthless unless the
 * instrument can report one. The first case pins that two identical documents
 * draw identical bytes (the ruler is stable — no timestamps, no random ids), the
 * second is a LIT CONTROL on a key the renderer demonstrably DOES read, and only
 * then is the measurement taken. It is taken twice: once on a plain grid and
 * once with the grid's search box on (`searchableFields`), since `operators` is
 * a filtering word and a grid without its one query affordance would be the
 * wrong corpus to ask. That corpus also used to carry `showFilters: true`, which
 * never drew anything: an `object-grid` has no filter UI, and objectui#11068
 * retired the key on this node.
 *
 * ⚠️ The claim is bounded by the ruler: this is what the RENDERED output does
 * with the key, on these documents. ⛔ It is not a claim that no code anywhere
 * could ever read it.
 *
 * ⛔ This file takes no position on the remedy — objectui#9729 is the card.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ObjectGridRenderer } from '../index';

afterEach(cleanup);

const BASE: Record<string, unknown> = {
  type: 'object-grid',
  objectName: 'probe',
  columns: ['name'],
  staticData: [
    { id: '1', name: 'Alpha' },
    { id: '2', name: 'Beta' },
  ],
};

/** Draw one document and return its markup, once the rows are on screen. */
async function draw(schema: Record<string, unknown>): Promise<string> {
  const { container } = render(<ObjectGridRenderer schema={schema} />);
  await screen.findByText('Alpha', {}, { timeout: 5000 });
  return container.innerHTML;
}

describe('the ruler', () => {
  it('two identical documents draw identical bytes', async () => {
    const a = await draw({ ...BASE });
    cleanup();
    const b = await draw({ ...BASE });
    expect(b).toBe(a);
  });

  it('LIT CONTROL — a key the renderer DOES read moves the bytes', async () => {
    const a = await draw({ ...BASE });
    cleanup();
    const b = await draw({ ...BASE, label: 'GRID-CAPTION-9729' });
    expect(b).not.toBe(a);
    expect(b).toContain('GRID-CAPTION-9729');
  });
});

describe('an authored `operators`', () => {
  it('changes nothing the grid draws', async () => {
    const a = await draw({ ...BASE });
    cleanup();
    const b = await draw({ ...BASE, operators: { name: ['equals', 'contains'] } });
    expect(b).toBe(a);
  });

  it('changes nothing with the search box on either', async () => {
    const SEARCH = { ...BASE, searchableFields: ['name'] };
    const a = await draw({ ...SEARCH });
    cleanup();
    const b = await draw({ ...SEARCH, operators: { name: ['equals', 'contains'] } });
    expect(b).toBe(a);
  });
});
