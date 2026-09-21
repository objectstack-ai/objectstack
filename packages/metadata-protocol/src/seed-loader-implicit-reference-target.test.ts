// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19289] `buildDependencyGraph` must resolve a `user` field's target from the
 * TYPE, not from the carrier — the first of the two CONFIRMED defects of the
 * implicit-target census.
 *
 * `IMPLICIT_REFERENCE_TARGETS` (`packages/spec/src/data/field-value.zod.ts`)
 * declares a `user` field's target "a CONSTANT OF THE TYPE" and metadata
 * authored without `reference` "fully specified, not under-specified". This
 * function's type gate admits `user`, so it DOES ask the target question about
 * such a field — and #18550 standardized the read on `referenceCarrierOf`,
 * which answers what the CARRIER says. For `lookup` / `master_detail` the two
 * arbiters agree; for `user` only `referenceTargetOf` matches the contract.
 *
 * ## The failure was SILENT, and its cost is a wrong stored value
 *
 * A spec-complete `{ type: 'user' }` field answered `undefined`, hit the
 * `if (!targetObject) continue`, and so contributed NO `dependsOn` edge and was
 * NEVER pushed onto `references`. Nothing threw and nothing logged. Resolution
 * only maps the natural keys that reached `references`, so the seed value was
 * written VERBATIM — `'Ada Lovelace'` stored in a column that holds a record id
 * — which this function's own docblock names as the cause of dangling
 * references and broken parent joins.
 *
 * ⛔ These assertions are on the `references` ROW, not on a throw: the defect
 * never threw, so a `toThrow` pin could not have caught it and cannot guard it.
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

const account = { name: 'crm_account', fields: { name: { type: 'text', required: true } } };

/** One `crm_task` whose `owner` field is whatever the case supplies. */
const taskWith = (owner: Record<string, unknown>) => ({
  name: 'crm_task',
  fields: {
    name: { type: 'text', required: true },
    owner,
  },
});

const graphOver = (schemas: Record<string, unknown>, names: string[] = ['crm_account', 'crm_task']) =>
  new SeedLoaderService(engineWith(schemas), emptyMetadata(), createLogger()).buildDependencyGraph(names);

const referencesOf = async (schemas: Record<string, unknown>, names?: string[]) =>
  (await graphOver(schemas, names)).nodes.find((n) => n.object === 'crm_task')?.references ?? [];

describe('[#19289] seed dependency graph — a `user` field takes its target from the TYPE', () => {
  it('a `{ type: "user" }` field with NO `reference` still produces a reference row targeting `sys_user`', async () => {
    // THE DEFECT, stated as an assertion. Before the repair this array was
    // empty and the seed value was written verbatim.
    const references = await referencesOf({ crm_account: account, crm_task: taskWith({ type: 'user' }) });
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      field: 'owner',
      targetObject: 'sys_user',
      targetField: 'name',
      fieldType: 'user',
    });
  });

  it('the two legal spellings of one fully-specified field agree', async () => {
    // The contract's point: `reference: 'sys_user'` MATERIALIZES the constant,
    // it does not supply it — so writing it and omitting it are the same
    // metadata and must resolve the same way.
    const implicit = await referencesOf({ crm_account: account, crm_task: taskWith({ type: 'user' }) });
    const explicit = await referencesOf({
      crm_account: account,
      crm_task: taskWith({ type: 'user', reference: 'sys_user' }),
    });
    expect(implicit).toEqual(explicit);
  });

  it('the `dependsOn` edge appears when `sys_user` is itself in the graph', async () => {
    // The other half the carrier read dropped: ordering. `dependsOn` is only
    // recorded for objects inside the seeded set, so this case puts it there.
    const graph = await graphOver(
      {
        sys_user: { name: 'sys_user', fields: { name: { type: 'text' } } },
        crm_task: taskWith({ type: 'user' }),
      },
      ['sys_user', 'crm_task'],
    );
    expect(graph.nodes.find((n) => n.object === 'crm_task')?.dependsOn).toEqual(['sys_user']);
    expect(graph.insertOrder.indexOf('sys_user')).toBeLessThan(graph.insertOrder.indexOf('crm_task'));
  });

  // ── The boundary. `user` is the ONLY member of `IMPLICIT_REFERENCE_TARGETS`,
  //    so no other type may start inventing a target. ⛔ These are the cases a
  //    mechanical "swap every arbiter" sweep would break.
  it.each([
    ['lookup', { type: 'lookup' }],
    ['master_detail', { type: 'master_detail' }],
  ])('%s with no carrier still names NO target — nothing supplies one for it', async (_label, owner) => {
    expect(await referencesOf({ crm_account: account, crm_task: taskWith(owner) })).toEqual([]);
  });

  it('a `user` field whose carrier is unreadable still REFUSES — absence and unreadability stay different', async () => {
    // `referenceTargetOf` reads the carrier through `referenceCarrierOf` before
    // it judges anything, so #18550's refusal is untouched: the implicit target
    // is NOT a fallback that swallows a broken carrier.
    const attempt = () => graphOver({ crm_account: account, crm_task: taskWith({ type: 'user', reference: { object: 'sys_user' } }) });
    await expect(attempt()).rejects.toThrow(TypeError);
    await expect(attempt()).rejects.toThrow(/`reference` is an object/);
  });
});
