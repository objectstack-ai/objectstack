// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declared default of `runAutomations` AGREES with the server's decision
 * (#6704).
 *
 * ## Why the agreement, and not either half
 *
 * `ImportRequestSchema` declares what a caller who validates a request body
 * materialises. `prepareImportRequest` decides what the server does with the
 * body it is handed. Nothing in this repo connects the two — the import route
 * reads the RAW body and never parses it through the schema, and the only
 * reference to `CreateImportJobRequestSchema` is the declarative
 * `ImportJobApiContracts` catalog entry, a declaration and not a parse. That
 * missing connection is the whole defect: for two years the schema said
 * `.default(false)` while the server ran `body?.runAutomations !== false`, and
 * no gate could see it because each half was internally consistent.
 *
 * So neither half pins the fact. Asserting `parse({}).runAutomations === true`
 * pins the schema; asserting `prepare({}).runAutomations === true` pins the
 * server; only asserting they are EQUAL, over an input set that includes the
 * omitted key, pins that the divergence is closed. This file is the only place
 * in the repo that can make that assertion — `@objectstack/rest` depends on
 * `@objectstack/spec`, so both halves are reachable from here and from nowhere
 * upstream of it.
 *
 * ## Behaviour is deliberately UNCHANGED
 *
 * #6704 moved the DECLARATION to the runtime, never the runtime to the
 * declaration: `packages/rest/src/import-prepare.ts` is untouched. The
 * `serverDecision` column below therefore reads identically before and after the
 * change, and the `declared` column is what moved. If a future edit "fixes" the
 * disagreement from the other side — making an omitted flag skip automations —
 * these cases stay green while `import-prepare.test.ts`'s own `#2922` block goes
 * red, which is the correct division of labour between the two files.
 */

import { describe, it, expect } from 'vitest';
import { ImportRequestSchema, CreateImportJobRequestSchema } from '@objectstack/spec/api';
import { prepareImportRequest } from './import-prepare';

const SCHEMA = {
  name: 'task',
  fields: {
    title: { name: 'title', type: 'text', label: 'Title' },
  },
};

const p = { getMetaItem: async () => ({ type: 'object', name: 'task', item: SCHEMA }) };

/** The rows are irrelevant to the flag; one valid row keeps `prepare` on its ok path. */
const ROWS = [{ title: 'a' }];

/** What the server decides for a body, reading it exactly as the route does. */
const serverDecision = async (body: Record<string, unknown>): Promise<boolean> => {
  const prep = await prepareImportRequest(
    { format: 'json', rows: ROWS, ...body },
    { p, objectName: 'task', maxRows: 10 },
  );
  expect(prep.ok).toBe(true);
  if (!prep.ok) throw new Error('prepareImportRequest refused a valid body');
  return prep.prepared.runAutomations;
};

/** What a caller who validates the body first materialises and sends. */
const declared = (body: Record<string, unknown>): boolean =>
  ImportRequestSchema.parse({ format: 'json', rows: ROWS, ...body }).runAutomations;

describe('runAutomations — declared default agrees with the server (#6704)', () => {
  const cases: Array<{ label: string; body: Record<string, unknown>; expected: boolean }> = [
    // THE case. Before #6704 this row was the divergence: declared `false`,
    // server `true`. Everything else in this file already agreed.
    { label: 'omitted', body: {}, expected: true },
    { label: 'explicit true', body: { runAutomations: true }, expected: true },
    { label: 'explicit false', body: { runAutomations: false }, expected: false },
  ];

  for (const { label, body, expected } of cases) {
    it(`${label}: the materialised value and the server decision are the same`, async () => {
      const fromServer = await serverDecision(body);
      const fromSchema = declared(body);
      // Assert the agreement itself first — a mismatch reports both values.
      expect({ declared: fromSchema, server: fromServer })
        .toEqual({ declared: expected, server: expected });
    });
  }

  it('validating before sending cannot change the outcome', async () => {
    // The concrete harm #6704 names: a client that parses its request through
    // the published schema and sends the PARSED object used to get the opposite
    // behaviour from one that sent the same body unvalidated. Drive both paths
    // through the server and require one answer.
    const raw = {};
    const validated = ImportRequestSchema.parse({ format: 'json', rows: ROWS, ...raw });
    expect(await serverDecision(raw)).toBe(await serverDecision(validated));
    expect(await serverDecision(validated)).toBe(true);
  });

  it('the async job body agrees too — same schema object, separately published def', async () => {
    // `POST /api/v1/data/:object/import/jobs` shares `prepareImportRequest` and
    // its request def is an alias of the sync one, but both defs ship their own
    // JSON Schema file, reference table and authorable-defaults row — so the
    // async twin is asserted by name rather than inferred from the aliasing.
    const fromSchema = CreateImportJobRequestSchema
      .parse({ format: 'json', rows: ROWS }).runAutomations;
    expect(fromSchema).toBe(await serverDecision({}));
    expect(fromSchema).toBe(true);
  });

  it('an omitted flag is the only input whose declaration ever moved', async () => {
    // Guards the reverse direction of the fix: the explicit spellings were
    // already in agreement before #6704 and must not have been "fixed" into
    // something else while the omitted case was corrected.
    expect(declared({ runAutomations: false })).toBe(false);
    expect(await serverDecision({ runAutomations: false })).toBe(false);
    expect(declared({ runAutomations: true })).toBe(true);
    expect(await serverDecision({ runAutomations: true })).toBe(true);
  });
});
