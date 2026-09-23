// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The generated draft is emitted in the ONE authorised `*.object.ts` shape.
 *
 * Director-seat ruling, decision batch #122 item 1, maintainer 「同意」
 * 2026-09-12, verbatim:
 *
 * > `ObjectSchema.create({ … })` is the one authorised shape for a
 * > `.object.ts` … The factory parses the object against `ObjectSchema` when
 * > the file is evaluated, so an error surfaces where it was written; the typed
 * > literal defers everything to a build the author may never run.
 *
 * `renderObjectSource` wrote the other one — `const X: ServiceObject = { … }`
 * behind an `import type`, closed by `export default X`. Its own docblock calls
 * the output a `*.object.ts`, and `os datasource introspect --out
 * objects/x.object.ts` tells the author to commit it under that suffix, so the
 * bytes really do land where the ruling governs.
 *
 * ## Why this file is not one `toContain` line
 *
 * The failure mode a shape assertion invites is a generator that emits the
 * right-LOOKING call around a definition the factory refuses — the defect moved
 * one layer down, with every string assertion still green. Both halves are
 * therefore pinned separately, and they measure different things:
 *
 *  1. **the form** — the value import, the named export bound to
 *     `ObjectSchema.create(`, and the ABSENCE of the refused annotated-literal
 *     form. A shape pin that only asserts the new spelling cannot say the old
 *     one left.
 *  2. **the round-trip** — the emitted module body is EVALUATED with the real
 *     `ObjectSchema` from `@objectstack/spec/data`, which is the same factory
 *     call the committed file makes on the author's machine. Nothing is
 *     re-spelled here: if `create()` would throw in the author's file, it throws
 *     in this test.
 *
 * ## Why the evaluation instrument carries its own negative control
 *
 * An evaluation harness that silently stopped running the factory — a transform
 * that no longer matched, an import that resolved to a stub — would report
 * every draft as valid forever. The last block feeds it a source with one
 * unknown top-level key spliced in and requires it to throw. A round-trip that
 * cannot fail is not a measurement.
 */

import { describe, it, expect } from 'vitest';
import type { IntrospectedSchema } from '@objectstack/spec/contracts';
import { ObjectSchema } from '@objectstack/spec/data';
import {
  ExternalDatasourceService,
  type DatasourceLike,
} from '../external-datasource-service.js';

function remoteSchema(): IntrospectedSchema {
  return {
    dialect: 'postgres',
    introspectedAt: '2026-09-23T00:00:00.000Z',
    tables: {
      'mart.customers': {
        name: 'mart.customers',
        indexes: [],
        columns: [
          { name: 'id', type: 'text', nullable: false, primaryKey: true },
          { name: 'name', type: 'varchar(255)', nullable: true, primaryKey: false },
          { name: 'signed_up_at', type: 'timestamptz', nullable: true, primaryKey: false },
        ],
      },
    },
  };
}

function serviceWith(namespace?: string): ExternalDatasourceService {
  return new ExternalDatasourceService({
    introspect: async () => remoteSchema(),
    getDatasource: async (name): Promise<DatasourceLike> => ({ name, schemaMode: 'external' }),
    getObject: async () => undefined,
    listObjects: async () => [],
    getNamespace: () => namespace,
  });
}

const draftFor = (namespace?: string) =>
  serviceWith(namespace).generateObjectDraft('warehouse', 'customers');

/**
 * Evaluate the emitted module body and return what its single export is bound
 * to — i.e. run the author's own `ObjectSchema.create(…)` call.
 *
 * The transform is asserted rather than assumed: a silently non-matching
 * `replace` would hand `new Function` a body with no `return` in it, which
 * evaluates to `undefined` and throws nothing at all.
 */
function evaluateEmittedModule(source: string): unknown {
  const body = source
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n')
    .replace(/^export const [A-Za-z_$][\w$]* = /m, 'return ');
  expect(body, 'the emitted module has no single named export to evaluate').toContain(
    'return ObjectSchema.create(',
  );
  return new Function('ObjectSchema', body)(ObjectSchema) as unknown;
}

describe('the emitted draft carries the authorised `ObjectSchema.create` shape', () => {
  it('imports the factory as a VALUE and binds a single named export to its call', async () => {
    const draft = await draftFor('wh');

    expect(draft.source).toContain("import { ObjectSchema } from '@objectstack/spec/data';");
    expect(draft.source).toContain('export const wh_customers = ObjectSchema.create({');
    // The call is closed as a call, not as a bare object literal.
    expect(draft.source.trimEnd().endsWith('});')).toBe(true);
  });

  it('carries the shape on the no-namespace path too, TODO block and all', async () => {
    const draft = await draftFor(undefined);

    // The TODO block renders ABOVE the import; the shape must survive it.
    expect(draft.source).toContain('TODO(namespace)');
    expect(draft.source).toContain("import { ObjectSchema } from '@objectstack/spec/data';");
    expect(draft.source).toContain('export const customers = ObjectSchema.create({');
  });

  it('emits a value import — an `import type` would be elided and the file would throw', async () => {
    const draft = await draftFor('wh');
    expect(draft.source).not.toContain('import type');
  });
});

describe('the refused annotated-literal form is absent, by name', () => {
  it.each([
    ['the `ServiceObject` type annotation', ': ServiceObject = {'],
    ['the type-only spec import', "import type { ServiceObject } from '@objectstack/spec/data';"],
    ['the unexported `const` binding', 'const wh_customers: ServiceObject'],
    ['the default export that closed it', 'export default'],
  ])('%s is gone', async (_label, refused) => {
    const draft = await draftFor('wh');
    expect(draft.source).not.toContain(refused);
  });

  it('names no `ServiceObject` type at all outside the preserved remote-key note', async () => {
    const draft = await draftFor('wh');
    const mentions = draft.source
      .split('\n')
      .filter((l) => l.includes('ServiceObject'))
      .map((l) => l.trim());

    // The one survivor is the remote-primary-key tombstone, which explains a
    // SPEC type rather than describing this file's shape.
    expect(mentions).toEqual([
      "// Preserved as a COMMENT because 'ServiceObject' has no authorable key for a",
    ]);
  });
});

describe('round-trip — the factory call inside the emitted file accepts the draft', () => {
  it('evaluates without throwing and yields the definition the draft reports', async () => {
    const draft = await draftFor('wh');
    const evaluated = evaluateEmittedModule(draft.source) as Record<string, unknown>;

    expect(evaluated.name).toBe('wh_customers');
    expect(evaluated.label).toBe('Customers');
    expect(evaluated.datasource).toBe('warehouse');
    expect(evaluated.sharingModel).toBe('private');
    expect(Object.keys(evaluated.fields as Record<string, unknown>)).toEqual([
      'id',
      'name',
      'signed_up_at',
    ]);
    // `writable` is NOT emitted by the renderer — it is the schema default,
    // applied because the evaluated file really parsed. Spelled out rather than
    // loosened to `toMatchObject`: this key is the cheapest standing evidence
    // that the factory ran instead of an object literal being handed back.
    expect(evaluated.external).toEqual({
      remoteSchema: 'mart',
      remoteName: 'customers',
      writable: false,
    });
  });

  it('round-trips the no-namespace draft too — the TODO comment is inert to the factory', async () => {
    const draft = await draftFor(undefined);
    const evaluated = evaluateEmittedModule(draft.source) as Record<string, unknown>;
    expect(evaluated.name).toBe('customers');
  });

  it('agrees with the structured definition the same draft carries', async () => {
    const draft = await draftFor('wh');
    const evaluated = evaluateEmittedModule(draft.source);
    // `create()` parses, so the comparison is against the parsed definition —
    // the rendered file and `draft.definition` must describe one object.
    expect(evaluated).toEqual(ObjectSchema.parse(draft.definition));
  });

  it('NEGATIVE CONTROL — the evaluation really runs the factory', async () => {
    const draft = await draftFor('wh');
    const poisoned = draft.source.replace(
      "  name: 'wh_customers',",
      "  name: 'wh_customers',\n  workflows: [],",
    );
    expect(poisoned).not.toBe(draft.source);

    expect(() => evaluateEmittedModule(poisoned)).toThrow(/workflows/);
  });
});
