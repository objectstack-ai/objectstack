// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0161 K4, clause 2] A knowledge source authored the way Studio's form
// writes one, on a REAL booted showcase (the knowledge service and its one
// store, `memory`), with no restart anywhere:
//
//   ⭐ the Studio wire — the item's draft PUT (`?mode=draft`), then that one
//      item's publish, which is what a Save in Studio's metadata editor sends
//      (objectstack#36902) — saves a source whose body holds every key the
//      `knowledge_source` form offers, `adapter` left blank;
//   ⭐ `search_knowledge` over the live `/mcp` transport then finds a record
//      of that object, named by its object and id, from the new source;
//   ⭐ reopened, the item reads back every value the form wrote, as written,
//      and parses with `KnowledgeSourceSchema`;
//   ⭐ CONTROL: before the publish, the tool lists no such source.
//
// The browser half (the form itself, its pickers bound to `source.object`) is
// pinned in `ui/packages/app-shell`, against the real editor; this file pins
// what the form's body does once it reaches the doors.
//
// The verify harness mounts no MCP server, so this file mounts one, as
// `objectstack dev` and `serve` do. A session bearer carries no OAuth grant,
// so the route serves it the read family, `search_knowledge` included.
//
// The file is ISOLATED: it writes `/meta` and creates a task.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPServerPlugin } from '@objectstack/mcp';
import { type VerifyStack } from '@objectstack/verify';
import { KnowledgeSourceSchema } from '@objectstack/spec/ai';
import { bootShowcase } from './showcase-boot.js';

const SOURCE = 'ks_studio_open_tasks';
/** A word no seeded task carries, so a hit on it is the record this file wrote. */
const MARKER = 'zephyrquartz';

/** Every key the `knowledge_source` form offers, as its controls write them; `adapter` left blank. */
const FORM_BODY = {
  name: SOURCE,
  label: 'Open tasks (Studio)',
  description: 'Titles and notes of open tasks, authored in Studio.',
  aiExposed: true,
  source: {
    kind: 'object',
    object: 'showcase_task',
    content: ['title', 'notes'],
    metadataFields: ['status', 'priority'],
    where: { status: { $ne: 'done' } },
    split: { strategy: 'recursive', maxChars: 600, minChars: 100 },
  },
  refresh: { onRecordChange: true },
};

type Row = Record<string, any>;
const rowsOf = (r: any): Row[] =>
  (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.data) ? r.data : Array.isArray(r?.value) ? r.value : []);

describe('[ADR-0161 K4] a knowledge source authored through Studio\'s wire is searched over MCP without a restart', () => {
  let stack: VerifyStack;
  let admin = '';
  let taskId = '';

  /** One MCP `tools/call` over the live transport, as the admin's session; its first content block parsed. */
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, JSON.stringify(rpc.error)).toBeUndefined();
    const text = String(rpc.result?.content?.[0]?.text ?? '');
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    return { isError: rpc.result?.isError === true, payload, text };
  };

  beforeAll(async () => {
    stack = await bootShowcase({ extraPlugins: [new MCPServerPlugin()] });
    admin = await stack.signIn();
    const projects = await stack.apiAs(admin, 'GET', '/data/showcase_project?limit=1');
    expect(projects.status, await projects.clone().text()).toBe(200);
    const project = rowsOf(await projects.json())[0];
    expect(project?.id, 'a seeded project').toBeTruthy();
    const created = await stack.apiAs(admin, 'POST', '/data/showcase_task', {
      title: `Calibrate the ${MARKER} rig`,
      notes: `The ${MARKER} rig needs a new seal before the next run.`,
      status: 'todo',
      project: project.id,
    });
    const body: any = await created.json();
    expect(created.status, JSON.stringify(body)).toBeLessThan(300);
    taskId = String(body?.id ?? body?.record?.id ?? body?.data?.id ?? '');
    expect(taskId, JSON.stringify(body)).not.toBe('');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('CONTROL: before the publish, search_knowledge lists no such source', async () => {
    const answer = await tool('search_knowledge', { query: MARKER });
    expect(answer.isError, answer.text).toBe(false);
    expect((answer.payload.sources as Array<{ id: string }>).map((s) => s.id)).not.toContain(SOURCE);
  });

  it('Studio\'s Save — the draft PUT, then the item\'s publish — saves the source', async () => {
    const draft = await stack.apiAs(admin, 'PUT', `/meta/knowledge_source/${SOURCE}?mode=draft`, FORM_BODY);
    expect(draft.status, await draft.clone().text()).toBe(200);
    const published = await stack.apiAs(admin, 'POST', `/meta/knowledge_source/${SOURCE}/publish`, {});
    expect(published.status, await published.clone().text()).toBe(200);
  });

  it('search_knowledge over MCP finds the record of that object from the new source, with no restart', async () => {
    const deadline = Date.now() + 30_000;
    let last: Awaited<ReturnType<typeof tool>> | undefined;
    let hit: any;
    while (Date.now() < deadline) {
      last = await tool('search_knowledge', { query: MARKER, sourceIds: [SOURCE] });
      if (!last.isError) {
        hit = (last.payload.hits as any[]).find((h) => h.record?.id === taskId);
        if (hit) break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(hit, last?.text).toBeDefined();
    expect(hit).toMatchObject({ sourceId: SOURCE, record: { object: 'showcase_task', id: taskId } });
    expect(String(hit.snippet)).toContain(MARKER);
    expect((last!.payload.sources as Array<{ id: string; label: string }>)).toContainEqual(
      expect.objectContaining({ id: SOURCE, label: FORM_BODY.label }),
    );
  });

  it('reopened, the item shows every value the form wrote, and parses with KnowledgeSourceSchema', async () => {
    const res = await stack.apiAs(admin, 'GET', `/meta/knowledge_source/${SOURCE}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const json: any = await res.json();
    const item = json?.item ?? json?.data ?? json;
    expect(item).toMatchObject(FORM_BODY);
    expect(item.adapter).toBeUndefined();
    const parsed = KnowledgeSourceSchema.safeParse(item);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
