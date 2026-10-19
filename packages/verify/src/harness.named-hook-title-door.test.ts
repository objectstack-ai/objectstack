// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24289 — a hook whose `handler` NAMES a function gets the same
 * `ctx.title(field?)` on both doors of `bootStack`, as an inline handler and a
 * `body` do (`harness.hook-title-door.test.ts`).
 *
 * The two doors name the function two ways, and both run it in-process:
 *
 *  - the source door: `defineStack({ functions })` and a hook naming one entry;
 *  - the artifact door: a string `handler` and a `runtimeModule` that supplies
 *    the function, which is what `objectstack build` ships for a callable it
 *    could not lower to a `body`.
 *
 * Measured before (`origin/main` ee882b845): both doors refused every insert
 * with `TypeError: ctx.title is not a function`. The binder resolved the name
 * past the runtime's wrap of an inline handler, so the function was called
 * with the engine's bare context.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defineStack } from '@objectstack/spec';
import { bootStack, type VerifyStack } from './harness.js';

const BOOT_TIMEOUT = 120_000;

const manifest = { id: 'com.example.named-hook-title-door', name: 'Named Hook Title Door', namespace: 'nhd', version: '1.0.0', type: 'app' };

const product = {
  name: 'nhd_product', label: 'Product', pluralLabel: 'Products', sharingModel: 'public_read_write',
  nameField: 'label',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name', required: true },
    code: { name: 'code', type: 'text', label: 'Code' },
    label: { name: 'label', type: 'formula', label: 'Label', expression: "record.name + ' (' + record.code + ')'" },
  },
};

const line = {
  name: 'nhd_line', label: 'Line', pluralLabel: 'Lines', sharingModel: 'public_read_write',
  nameField: 'title',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name', required: true },
    product: { name: 'product', type: 'lookup', label: 'Product', reference: 'nhd_product' },
    spare: { name: 'spare', type: 'lookup', label: 'Spare', reference: 'nhd_product' },
    title: { name: 'title', type: 'formula', label: 'Title', expression: "record.name + ' · ' + record.product.name" },
    own_title: { name: 'own_title', type: 'text', label: 'Own title' },
    product_title: { name: 'product_title', type: 'text', label: 'Product title' },
    spare_title: { name: 'spare_title', type: 'text', label: 'Spare title' },
  },
};

/** One statement set: the named function's body on both doors. */
const SOURCE = [
  'ctx.input.own_title = String(await ctx.title());',
  "ctx.input.product_title = String(await ctx.title('product'));",
  "ctx.input.spare_title = String(await ctx.title('spare'));",
].join('\n');

const hook = { name: 'nhd_name_line', object: 'nhd_line', events: ['beforeInsert'], handler: 'nhd_stamp_titles' };

type TitleCtx = { input: Record<string, unknown>; title: (field?: string) => Promise<string | null> };

/** The configuration: the hook names an entry of the stack's own `functions`. */
const app = (): Record<string, unknown> =>
  defineStack({
    manifest,
    objects: [product, line],
    hooks: [hook],
    functions: {
      nhd_stamp_titles: async (ctx: TitleCtx) => {
        ctx.input.own_title = String(await ctx.title());
        ctx.input.product_title = String(await ctx.title('product'));
        ctx.input.spare_title = String(await ctx.title('spare'));
      },
    },
  } as never) as unknown as Record<string, unknown>;

/** The artifact: the same hook, its function shipped in the runtime module beside it. */
const artifact = (): Record<string, unknown> => ({
  manifest,
  objects: [product, line],
  hooks: [hook],
  runtimeModule: './runtime.mjs',
});
const RUNTIME_MODULE = `export const functions = {\n  nhd_stamp_titles: async (ctx) => {\n${SOURCE}\n  },\n};\n`;

/** What a `body` answers on a served runtime, the answer both doors owe. */
const EXPECTED = { own: 'L1 · Widget', product: 'Widget (W-1)', spare: 'null' };

let hostRoot: string;
beforeAll(() => {
  hostRoot = mkdtempSync(join(tmpdir(), 'verify-named-hook-title-door-'));
  mkdirSync(join(hostRoot, 'dist'));
  writeFileSync(join(hostRoot, 'dist', 'objectstack.json'), JSON.stringify(artifact()));
  writeFileSync(join(hostRoot, 'dist', 'runtime.mjs'), RUNTIME_MODULE);
});
afterAll(() => {
  if (hostRoot) rmSync(hostRoot, { recursive: true, force: true });
});

const live: VerifyStack[] = [];
afterEach(async () => {
  for (const stack of live.splice(0)) await stack.stop();
});

const titlesOn = async (stack: VerifyStack): Promise<Record<string, unknown>> => {
  live.push(stack);
  const widget = await stack.hooks.run('nhd_product', 'insert', { name: 'Widget', code: 'W-1' }, { system: true });
  const row = await stack.hooks.run('nhd_line', 'insert', { name: 'L1', product: widget.id }, { system: true });
  return { own: row.own_title, product: row.product_title, spare: row.spare_title };
};

describe('#24289: a hook whose handler names a function gets ctx.title on both bootStack doors', () => {
  it('the artifact door: a string handler resolved from the runtime module', async () => {
    expect(await titlesOn(await bootStack(app(), { hostRoot, artifact: 'dist/objectstack.json' }))).toEqual(EXPECTED);
  }, BOOT_TIMEOUT);

  it("the source door: a string handler resolved from the stack's functions", async () => {
    expect(await titlesOn(await bootStack(app(), { hostRoot }))).toEqual(EXPECTED);
  }, BOOT_TIMEOUT);
});
