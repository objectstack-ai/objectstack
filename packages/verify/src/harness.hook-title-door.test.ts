// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24289 — a hook's `ctx.title(field?)` answers the same on both doors of
 * `bootStack`: the source boot, where the hook's inline `handler` runs
 * in-process, and the artifact door, where the `body` the artifact carries runs
 * in the sandbox, as `objectstack dev` serves it.
 *
 * Measured before (`origin/main` ec749fbb4): on the source boot every insert was
 * refused with `TypeError: ctx.title is not a function`, while the artifact's
 * body answered. The accessor was installed on the sandbox path only, so an app
 * could not test a hook that used it.
 *
 * Pinned on each door, for one `beforeInsert`:
 *
 *  - `ctx.title()`: this record's title, a formula that reads one hop through a
 *    lookup, so the in-flight foreign key is followed;
 *  - `ctx.title('product')`: the related record's own formula title;
 *  - `ctx.title('spare')`: an empty lookup, `null` and never an id.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defineStack } from '@objectstack/spec';
import { bootStack, type VerifyStack } from './harness.js';

const BOOT_TIMEOUT = 120_000;

const manifest = { id: 'com.example.hook-title-door', name: 'Hook Title Door', namespace: 'htd', version: '1.0.0', type: 'app' };

const product = {
  name: 'htd_product', label: 'Product', pluralLabel: 'Products', sharingModel: 'public_read_write',
  nameField: 'label',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name', required: true },
    code: { name: 'code', type: 'text', label: 'Code' },
    label: { name: 'label', type: 'formula', label: 'Label', expression: "record.name + ' (' + record.code + ')'" },
  },
};

const line = {
  name: 'htd_line', label: 'Line', pluralLabel: 'Lines', sharingModel: 'public_read_write',
  nameField: 'title',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name', required: true },
    product: { name: 'product', type: 'lookup', label: 'Product', reference: 'htd_product' },
    spare: { name: 'spare', type: 'lookup', label: 'Spare', reference: 'htd_product' },
    title: { name: 'title', type: 'formula', label: 'Title', expression: "record.name + ' · ' + record.product.name" },
    own_title: { name: 'own_title', type: 'text', label: 'Own title' },
    product_title: { name: 'product_title', type: 'text', label: 'Product title' },
    spare_title: { name: 'spare_title', type: 'text', label: 'Spare title' },
  },
};

/** One statement set, run in-process by the handler and in the sandbox by the body. */
const SOURCE = [
  'ctx.input.own_title = String(await ctx.title());',
  "ctx.input.product_title = String(await ctx.title('product'));",
  "ctx.input.spare_title = String(await ctx.title('spare'));",
].join('\n');

type TitleCtx = { input: Record<string, unknown>; title: (field?: string) => Promise<string | null> };

/** The configuration: the hook is an inline function, which a source boot runs in-process. */
const app = (): Record<string, unknown> =>
  defineStack({
    manifest,
    objects: [product, line],
    hooks: [
      {
        name: 'htd_name_line',
        object: 'htd_line',
        events: ['beforeInsert'],
        handler: async (ctx: TitleCtx) => {
          ctx.input.own_title = String(await ctx.title());
          ctx.input.product_title = String(await ctx.title('product'));
          ctx.input.spare_title = String(await ctx.title('spare'));
        },
      },
    ],
  } as never) as unknown as Record<string, unknown>;

/** The artifact: the same app, its hook carrying the same statements as a `body`. */
const artifact = (): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(
      defineStack({
        manifest,
        objects: [product, line],
        hooks: [
          {
            name: 'htd_name_line',
            object: 'htd_line',
            events: ['beforeInsert'],
            body: { language: 'js', source: SOURCE, capabilities: ['api.read'] },
          },
        ],
      } as never),
    ),
  ) as Record<string, unknown>;

/** What the body answers on a served runtime, the answer the source boot owes. */
const EXPECTED = { own: 'L1 · Widget', product: 'Widget (W-1)', spare: 'null' };

let hostRoot: string;
beforeAll(() => {
  hostRoot = mkdtempSync(join(tmpdir(), 'verify-hook-title-door-'));
  mkdirSync(join(hostRoot, 'dist'));
  writeFileSync(join(hostRoot, 'dist', 'objectstack.json'), JSON.stringify(artifact()));
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
  const widget = await stack.hooks.run('htd_product', 'insert', { name: 'Widget', code: 'W-1' }, { system: true });
  const row = await stack.hooks.run('htd_line', 'insert', { name: 'L1', product: widget.id }, { system: true });
  return { own: row.own_title, product: row.product_title, spare: row.spare_title };
};

describe('#24289: a hook\'s ctx.title answers the same on both bootStack doors', () => {
  it('the artifact door: the body, in the sandbox, as `objectstack dev` serves it', async () => {
    expect(await titlesOn(await bootStack(app(), { hostRoot, artifact: 'dist/objectstack.json' }))).toEqual(EXPECTED);
  }, BOOT_TIMEOUT);

  it('the source door: the inline handler, in-process, gets the same answers', async () => {
    expect(await titlesOn(await bootStack(app(), { hostRoot }))).toEqual(EXPECTED);
  }, BOOT_TIMEOUT);
});
