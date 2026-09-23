// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18550] `buildDependencyGraph` must refuse a `FieldSchema.reference` carrier
 * it cannot read, rather than building a dependency graph around it.
 *
 * One of the measured residue sites of ruling letter E item 2 on #18095. The
 * read was a truthiness gate followed by a CAST:
 *
 *     if ((type is lookup|master_detail|user) && fieldDef.reference) {
 *       const targetObject = fieldDef.reference as string;
 *
 * The cast asserted exactly what the guard had not checked. An object-valued
 * carrier is truthy, so `targetObject` became a non-string that matched no name
 * in `objectSet` — contributing no `dependsOn` edge, so the seed order was
 * computed as if the relationship did not exist — and was then pushed onto
 * `references` for resolution to make of what it could.
 *
 * Absence keeps its answer, and there are three spellings of it: `undefined`
 * (what `.optional()` admits), `null` (what `StrictField` admits) and `''`
 * (which names no object). All three still skip the field silently, because a
 * relational field naming no target is a legal thing for metadata to say — the
 * defect that reports THAT is `field/relationship-without-reference`, not this
 * reader.
 *
 * The type gate deliberately stays FIRST, so the set of fields whose carrier is
 * read here is byte-identical to before: a `text` field carrying a stray
 * `reference` was never read and so is still never refused. That case is pinned
 * too — it is the boundary between "this reader got stricter" and "this reader
 * got wider".
 */

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** The graph builder reads metadata only — `getSchema` is the whole surface. */
function engineWith(schemas: Record<string, unknown>): IDataEngine {
  return { getSchema: vi.fn((name: string) => schemas[name]) } as unknown as IDataEngine;
}

function emptyMetadata(): IMetadataService {
  return { getObject: vi.fn(async () => undefined) } as unknown as IMetadataService;
}

const author = { name: 'author', fields: { name: { type: 'text', required: true } } };

/** One `book` whose `primary_author` carrier is whatever the case supplies. */
const bookWith = (carrier: Record<string, unknown>) => ({
  name: 'book',
  fields: {
    name: { type: 'text', required: true },
    primary_author: { type: 'lookup', ...carrier },
  },
});

const graphOver = (schemas: Record<string, unknown>) =>
  new SeedLoaderService(engineWith(schemas), emptyMetadata(), createLogger()).buildDependencyGraph(['author', 'book']);

describe('[#18550] seed dependency graph — an unreadable `reference` carrier is refused', () => {
  it('control: a READABLE carrier builds the edge and the reference row', async () => {
    // Without this every refusal below could pass on a builder that had
    // stopped deriving relationships at all.
    const graph = await graphOver({ author, book: bookWith({ reference: 'author' }) });
    const book = graph.nodes.find((n) => n.object === 'book');
    expect(book?.dependsOn).toEqual(['author']);
    expect(book?.references.map((r) => r.targetObject)).toEqual(['author']);
    expect(graph.insertOrder.indexOf('author')).toBeLessThan(graph.insertOrder.indexOf('book'));
  });

  it('an OBJECT-valued carrier refuses — the reader is named and the shape is named', async () => {
    // ⛔ Not a bare `toThrow()`: a builder that threw some other Error on some
    // other input would satisfy that.
    const attempt = () => graphOver({ author, book: bookWith({ reference: { object: 'author' } }) });
    await expect(attempt()).rejects.toThrow(TypeError);
    // [#19289] The reader named in the refusal is now `referenceTargetOf`, the
    // arbiter this site asks (the carrier read happens INSIDE it, so the throw
    // and its prescription are unchanged). The assertions that carry this
    // case's weight are the three below: the error CLASS, the offending SHAPE
    // and the prescription. What is deliberately NOT weakened is the input —
    // this call reaches the arbiter only through `buildDependencyGraph`.
    await expect(attempt()).rejects.toThrow(/referenceTargetOf/);
    await expect(attempt()).rejects.toThrow(/`reference` is an object/);
    await expect(attempt()).rejects.toThrow(/FieldSchema declares it as an optional STRING/);
  });

  it('an ARRAY-valued carrier refuses too, and the message names its length', async () => {
    await expect(graphOver({ author, book: bookWith({ reference: ['author', 'co_author'] }) }))
      .rejects.toThrow(/`reference` is an array \(length 2\)/);
  });

  // ── ABSENCE — all three spellings, none of which may throw. ⛔ These are the
  //    cases a mechanical "throw on everything falsy" sweep would break.
  it.each([
    ['undefined (the key omitted)', {}],
    ['null (`StrictField` declares it nullable)', { reference: null }],
    ["'' (names no object)", { reference: '' }],
  ])('absence stays silent: %s derives no edge and does not throw', async (_label, carrier) => {
    const graph = await graphOver({ author, book: bookWith(carrier) });
    const book = graph.nodes.find((n) => n.object === 'book');
    expect(book?.dependsOn).toEqual([]);
    expect(book?.references).toEqual([]);
  });

  it('the type gate stays FIRST: a `text` field carrying a stray `reference` is not read, so not refused', async () => {
    // The boundary case. This reader's job is relational targets; a carrier on
    // a non-relational field was never read here and is not this change's to
    // start refusing. (`ObjectSchema.safeParse` refuses the shape wherever it
    // was written, on any field type.)
    const strayCarrier = {
      name: 'book',
      fields: {
        name: { type: 'text', required: true },
        note: { type: 'text', reference: { object: 'author' } },
      },
    };
    const graph = await graphOver({ author, book: strayCarrier });
    expect(graph.nodes.find((n) => n.object === 'book')?.references).toEqual([]);
  });
});
