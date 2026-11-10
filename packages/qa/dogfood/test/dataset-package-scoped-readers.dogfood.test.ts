// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#32072, ADR-0150 D3/D5] The dataset readers resolve a dataset by package,
// on a booted showcase holding the clash phase 1 still boots with a warning:
// two `AppPlugin` packages of two namespaces, `com.qa.bare.alpha` (`alpha`) and
// `com.qa.bare.beta` (`beta`), each shipping the dataset `qa_shared_dataset`
// over its own object, and alpha alone holding `qa_alpha_dataset`.
//
// The doors driven here:
//
//   - `POST /analytics/dataset/query` with `datasetName`: a bare name is a
//     caller with no package, so two holders answer 409 RESOURCE_CONFLICT
//     naming both (it ran the first listed, alpha's); `?package=X` is `/meta`'s
//     exact qualifier and runs X's own dataset, or refuses naming the holders;
//   - `GET /meta/dataset/NAME` (bare 409), `/meta/dataset/NS/NAME` and
//     `?package=` (each its own holder), now that `dataset` is one of the
//     types whose by-name readers consult `(package, name)`; a qualified read
//     naming a package that does not hold the name (`/NS/NAME`, `?package=`,
//     `_env`) is refused naming the holder, where it served alpha's (200);
//   - the MCP tool `query_dataset` (its callers belong to no package): two
//     holders refused naming both.
//
// CONTROL: a dataset one package holds answers on every door exactly as it
// did; the step-0 reading (`main` ff04ad81) compared every saved dataset of
// this showcase between the old list pick and the by-name read, byte for byte.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AppPlugin } from '@objectstack/runtime';
import { MCPServerPlugin } from '@objectstack/mcp';
import { defineStack } from '@objectstack/spec';
import { bootShowcase } from './showcase-boot.js';

const DATASET = 'qa_shared_dataset';
const ALPHA_ONLY = 'qa_alpha_dataset';
const ALPHA = 'com.qa.bare.alpha';
const BETA = 'com.qa.bare.beta';
const SHOWCASE = 'com.example.showcase';
const SOLO = 'showcase_task_metrics';

/** One of the two packages the cold boot registers, each shipping the shared dataset over its own object. */
function bootPackage(p: 'alpha' | 'beta') {
  return defineStack({
    manifest: { id: `com.qa.bare.${p}`, namespace: p, name: `qa_bare_${p}`, version: '1.0.0', type: 'app' },
    objects: [{
      name: `${p}_item`,
      label: `${p} item`,
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' }, note: { type: 'text', label: 'Note' } },
    }],
    datasets: [{
      name: DATASET,
      label: `${p} dataset`,
      object: `${p}_item`,
      dimensions: [{ name: 'note', label: `${p} note`, field: 'note', type: 'string' }],
      measures: [{ name: 'row_count', label: `${p} count`, aggregate: 'count' }],
    }, ...(p === 'alpha' ? [{
      name: ALPHA_ONLY,
      label: 'alpha only dataset',
      object: 'alpha_item',
      dimensions: [{ name: 'note', label: 'alpha only note', field: 'note', type: 'string' }],
      measures: [{ name: 'row_count', label: 'alpha only count', aggregate: 'count' }],
    }] : [])],
  } as never);
}

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;
const messageOf = (body: any) =>
  String((body?.error && typeof body.error === 'object' ? body.error.message : body?.error) ?? body?.message ?? '');

describe('[#32072] the dataset readers resolve a dataset by package (ADR-0150 D3)', () => {
  let stack: VerifyStack;
  let admin: string;

  const query = async (datasetName: string, measure: string, qs = '') => {
    const res = await stack.apiAs(admin, 'POST', `/analytics/dataset/query${qs}`, { datasetName, selection: { measures: [measure] } });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = undefined; }
    return { status: res.status, text, body };
  };
  const meta = async (path: string) => {
    const res = await stack.apiAs(admin, 'GET', path);
    return { status: res.status, body: (await res.json()) as any };
  };
  /** `tools/call` over the live MCP transport: the tool's text content, parsed. */
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    expect(res.status).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, JSON.stringify(rpc.error)).toBeUndefined();
    const text = String(rpc.result?.content?.[0]?.text ?? '');
    return { isError: rpc.result?.isError === true, text };
  };

  beforeAll(async () => {
    stack = await bootShowcase({
      extraPlugins: [new AppPlugin(bootPackage('alpha') as never), new AppPlugin(bootPackage('beta') as never), new MCPServerPlugin()],
    });
    admin = await stack.signIn();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a bare datasetName two packages hold answers 409 RESOURCE_CONFLICT naming both, running neither', async () => {
    const { status, body, text } = await query(DATASET, 'row_count');
    expect([status, codeOf(body)], text).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(messageOf(body)).toContain(ALPHA);
    expect(messageOf(body)).toContain(BETA);
    expect(text).not.toContain('FROM');
  });

  it('`?package=` runs exactly that package\'s dataset: alpha\'s over alpha_item, beta\'s over beta_item', async () => {
    for (const p of ['alpha', 'beta'] as const) {
      const { status, body, text } = await query(DATASET, 'row_count', `?package=com.qa.bare.${p}`);
      expect(status, text).toBe(200);
      expect(body.object).toBe(`${p}_item`);
      expect(body.sql).toContain(`FROM "${p}_item"`);
      expect(body.fields[0].label).toBe(`${p} count`);
    }
  });

  it('`?package=` naming a package that holds none of the name is refused naming the holders', async () => {
    const { status, body, text } = await query(DATASET, 'row_count', `?package=${SHOWCASE}`);
    expect([status, codeOf(body)], text).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(messageOf(body)).toContain(ALPHA);
    expect(messageOf(body)).toContain(BETA);
  });

  it('GET /meta/dataset: the bare read refuses naming both; the qualified address and `?package=` each reach their holder', async () => {
    const bare = await meta(`/meta/dataset/${DATASET}`);
    expect([bare.status, codeOf(bare.body)], JSON.stringify(bare.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(messageOf(bare.body)).toContain(ALPHA);
    expect(messageOf(bare.body)).toContain(BETA);
    for (const p of ['alpha', 'beta'] as const) {
      const qualified = await meta(`/meta/dataset/${p}/${DATASET}`);
      expect(qualified.status, JSON.stringify(qualified.body)).toBe(200);
      expect(qualified.body.item.label).toBe(`${p} dataset`);
      expect(qualified.body.item._packageId).toBe(`com.qa.bare.${p}`);
      const named = await meta(`/meta/dataset/${DATASET}?package=com.qa.bare.${p}`);
      expect(named.status).toBe(200);
      expect(named.body.item.label).toBe(`${p} dataset`);
    }
  });

  it('a qualified read naming a package that does not hold the name is refused naming the holder, on /meta and the query door', async () => {
    for (const path of [
      `/meta/dataset/beta/${ALPHA_ONLY}`,
      `/meta/dataset/${ALPHA_ONLY}?package=${BETA}`,
      `/meta/dataset/_env/${ALPHA_ONLY}`,
    ]) {
      const read = await meta(path);
      expect([read.status, codeOf(read.body)], `${path} ${JSON.stringify(read.body)}`).toEqual([409, 'RESOURCE_CONFLICT']);
      expect(messageOf(read.body), path).toContain(ALPHA);
    }
    const env = await meta(`/meta/dataset/_env/${DATASET}`);
    expect([env.status, codeOf(env.body)], JSON.stringify(env.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(messageOf(env.body)).toContain(ALPHA);
    expect(messageOf(env.body)).toContain(BETA);
    const door = await query(ALPHA_ONLY, 'row_count', `?package=${BETA}`);
    expect([door.status, codeOf(door.body)], door.text).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(messageOf(door.body)).toContain(ALPHA);
  });

  it('CONTROL: the one-holder alpha dataset is served bare, at its namespace and at its `?package=`', async () => {
    for (const path of [`/meta/dataset/${ALPHA_ONLY}`, `/meta/dataset/alpha/${ALPHA_ONLY}`, `/meta/dataset/${ALPHA_ONLY}?package=${ALPHA}`]) {
      const read = await meta(path);
      expect(read.status, path).toBe(200);
      expect(read.body.item.label, path).toBe('alpha only dataset');
    }
    const bare = await query(ALPHA_ONLY, 'row_count');
    expect(bare.status, bare.text).toBe(200);
    expect(bare.body.object).toBe('alpha_item');
    const named = await query(ALPHA_ONLY, 'row_count', `?package=${ALPHA}`);
    expect(named.text).toBe(bare.text);
  });

  it('the MCP tool query_dataset (a caller with no package) is refused naming both', async () => {
    const { isError, text } = await tool('query_dataset', { datasetName: DATASET, selection: { measures: ['row_count'] } });
    expect(isError, text).toBe(true);
    expect(text).toContain('RESOURCE_CONFLICT');
    expect(text).toContain(ALPHA);
    expect(text).toContain(BETA);
  });

  it('CONTROL: a dataset one package holds is served on every door as before', async () => {
    const bare = await query(SOLO, 'task_count');
    expect(bare.status, bare.text).toBe(200);
    expect(bare.body.object).toBe('showcase_task');
    const named = await query(SOLO, 'task_count', `?package=${SHOWCASE}`);
    expect(named.status, named.text).toBe(200);
    expect(named.text).toBe(bare.text);
    const item = await meta(`/meta/dataset/${SOLO}`);
    expect(item.status).toBe(200);
    expect(item.body.item._packageId).toBe(SHOWCASE);
    const viaTool = await tool('query_dataset', { datasetName: SOLO, selection: { measures: ['task_count'] } });
    expect(viaTool.isError, viaTool.text).toBe(false);
    expect(JSON.parse(viaTool.text).provenance.dataset.name).toBe(SOLO);
  });
});
