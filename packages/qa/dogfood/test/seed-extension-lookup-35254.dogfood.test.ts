// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#35254] A seed that sets a lookup another package adds through
// `objectExtensions` (ADR-0130 D5) stores the target's id, on the boot that
// loads a COMPILED ARTIFACT — the door `os dev`, `os serve` and the cloud
// runtime load through.
//
// On that boot the metadata service holds each object as its own package
// authored it; the extension's fields exist only in the ObjectQL registry's
// fold. The seed loader used to read the metadata copy, so the extension lookup
// was no reference: no dependency edge, and the target's natural key written
// verbatim into the foreign-key column. The in-process boot (no artifact) bridges
// the metadata service from the folded registry and resolved the same seed,
// which is why `@objectstack/verify` alone never saw it.
//
// Two packages, composed the way a deployment receives them:
//   - `qa_ext_app` (app) owns `qa_ext_order` and seeds order `O-1`, with its own
//     authored lookup `account_ref` set by name (the CONTROL);
//   - `qa_ext_mod` (module) owns `qa_ext_quote`, adds `quote_ref`
//     (→ `qa_ext_quote`) to `qa_ext_order`, seeds the quote, then
//     - `update` mode: sets `O-1.quote_ref` by the quote's name;
//     - `upsert` mode: inserts order `O-2` with `quote_ref` by the quote's name.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MetadataPlugin } from '@objectstack/metadata';
import { composeStacks, defineStack } from '@objectstack/spec';
import { writeBuildShapedArtifact } from './build-shaped-artifact.js';

const QUOTE = 'Acme Annual Renewal Quote';
const ACCOUNT = 'Acme Corporation';

const appPackage = defineStack({
  manifest: { id: 'com.qa.ext35254.app', namespace: 'qa_ext', name: 'qa_ext_app', version: '1.0.0', type: 'app' },
  objects: [
    {
      name: 'qa_ext_account', label: 'Account', sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name', required: true } },
    },
    {
      name: 'qa_ext_order', label: 'Order', sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        account_ref: { type: 'lookup', label: 'Account', reference: 'qa_ext_account' },
      },
    },
  ],
  data: [
    { object: 'qa_ext_account', externalId: 'name', mode: 'upsert', records: [{ name: ACCOUNT }] },
    { object: 'qa_ext_order', externalId: 'name', mode: 'upsert', records: [{ name: 'O-1', account_ref: ACCOUNT }] },
  ],
} as never);

const modulePackage = defineStack({
  manifest: { id: 'com.qa.ext35254.mod', namespace: 'qa_ext', name: 'qa_ext_mod', version: '1.0.0', type: 'module' },
  objects: [
    {
      name: 'qa_ext_quote', label: 'Quote', sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name', required: true } },
    },
  ],
  objectExtensions: [
    { extend: 'qa_ext_order', fields: { quote_ref: { type: 'lookup', label: 'Source Quote', reference: 'qa_ext_quote' } } },
  ],
  data: [
    // The order datasets come BEFORE the quote's: only the dependency edge puts the quote first.
    { object: 'qa_ext_order', externalId: 'name', mode: 'update', records: [{ name: 'O-1', quote_ref: QUOTE }] },
    { object: 'qa_ext_order', externalId: 'name', mode: 'upsert', records: [{ name: 'O-2', quote_ref: QUOTE, account_ref: ACCOUNT }] },
    { object: 'qa_ext_quote', externalId: 'name', mode: 'upsert', records: [{ name: QUOTE }] },
  ],
} as never);

describe('[#35254] an artifact boot resolves a seed lookup an object extension adds', () => {
  const artifact = composeStacks([appPackage, modulePackage], { manifest: 'preserve' }) as any;
  let stack: VerifyStack;
  let admin: string;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-seed-ext-lookup-'));
    const artifactPath = join(dir, 'objectstack.json');
    writeBuildShapedArtifact(artifact as unknown as Record<string, unknown>, artifactPath);
    stack = await bootStack(artifact, {
      extraPlugins: [
        new MetadataPlugin({
          rootDir: dir, watch: false, artifactWatch: false, registerSystemObjects: false,
          artifactSource: { mode: 'local-file', path: artifactPath },
        }),
      ],
    });
    admin = await stack.signIn();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const rows = async (object: string): Promise<any[]> => {
    const res = await stack.apiAs(admin, 'GET', `/data/${object}`);
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(200);
    const body = JSON.parse(text);
    return (body?.records ?? body?.data?.records ?? body?.data ?? body?.items ?? []) as any[];
  };

  it('PREMISE: the metadata service holds the order without the extension field, the engine serves it with it', async () => {
    const metadata: any = await stack.kernel.getServiceAsync('metadata');
    const authored = await metadata.getObject('qa_ext_order');
    expect(Object.keys(authored?.fields ?? {})).not.toContain('quote_ref');
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    expect(Object.keys(ql.getSchema('qa_ext_order')?.fields ?? {})).toContain('quote_ref');
  });

  it('update and upsert both store the quote\'s id, never its name; the authored lookup beside it resolves too', async () => {
    const [quote] = await rows('qa_ext_quote');
    const [account] = await rows('qa_ext_account');
    expect(quote?.id).toBeTruthy();
    const orders = await rows('qa_ext_order');
    const byName = Object.fromEntries(orders.map((o) => [o.name, o]));
    expect(orders.map((o) => o.name).sort()).toEqual(['O-1', 'O-2']);
    expect([byName['O-1'].quote_ref, byName['O-2'].quote_ref]).toEqual([quote.id, quote.id]);
    // CONTROL: the owner's own lookup on the same rows.
    expect([byName['O-1'].account_ref, byName['O-2'].account_ref]).toEqual([account.id, account.id]);
  });
});
