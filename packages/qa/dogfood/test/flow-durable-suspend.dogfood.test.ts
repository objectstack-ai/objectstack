// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// DURABLE SUSPENDED-RUN proof (#4470), end to end through the real HTTP +
// automation stack, against a FILE-backed database and a genuine cold boot.
//
// Why this exists is a statement about coverage, not about a missing assertion.
// Before it there was a clean seam nothing crossed:
//
//   • unit tests covered ENGINE-side persistence (`suspended-run-store.test.ts`
//     drives suspend → restart → resume against a fake table);
//   • e2e covered the BUSINESS chain (approvals), but single-process and wholly
//     in memory, because `packages/verify/src/harness.ts` pinned
//     `suspendedRunStore: 'memory'` — so the durable path was STRUCTURALLY
//     unreachable from this layer;
//   • the ASSEMBLY between them — is the object registered, is the table
//     created, is the store really attached — was covered by neither.
//
// #4420 grew in precisely that seam: the store hung off a table that was never
// created, every write failed into a `warn` nobody read, the pause reported
// success, and the run died at the next restart. #4460 added assembly UNIT
// tests; this is the e2e half.
//
// The assertions are therefore about FACTS rather than the absence of errors: a
// `paused` row is read back out of `sys_automation_run` by id, the first kernel
// is then STOPPED, and a second kernel that shares only the database file
// resumes the run and produces an observable data change.
//
// Note the shutdown is load-bearing, not tidiness: the sqlite-wasm driver
// defaults to `persist: 'on-disconnect'`, so a "cold boot" taken while the first
// kernel still holds the database would read a file its writes had not reached
// yet — and would fail for a reason that has nothing to do with suspended runs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { durableSuspendStack } from './fixtures/flow-durable-suspend-fixture.js';

describe('objectstack verify FLOW: suspended runs are durable across a cold boot (#4470)', () => {
  let dir: string;
  let dbFile: string;
  /** The FIRST process: authors the record, triggers the flow, suspends. */
  let hot: VerifyStack | undefined;
  let hotToken: string;
  let noteId: string;
  let runId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-durable-suspend-'));
    dbFile = join(dir, 'verify.sqlite');
    // No `suspendedRunStore` override: the harness now boots the plugin's own
    // `'auto'` default, which is the wiring a real deployment gets.
    hot = await bootStack(durableSuspendStack, { automation: true, databaseFile: dbFile });
    hotToken = await hot.signIn();
  }, 120_000);

  afterAll(async () => {
    await hot?.stop().catch(() => {});
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('precondition: the automation service is wired and the flow is registered', async () => {
    const res = await hot!.apiAs(hotToken, 'GET', '/automation/flow_durable_suspend');
    expect(res.status, `automation service not wired: ${res.status}`).toBe(200);
  });

  it('precondition: `sys_automation_run` really exists — the table #4420 was missing', async () => {
    // The whole #4420 failure was a store writing into a table nobody created.
    // Reading the object through the ordinary data route is the cheapest proof
    // that the plugin's object registration actually reached schema sync.
    const res = await hot!.apiAs(hotToken, 'GET', '/data/sys_automation_run?limit=1');
    expect(res.status, `sys_automation_run not queryable: ${await res.clone().text()}`).toBe(200);
  });

  it('suspends at the screen node and PERSISTS the pause as a `paused` row', async () => {
    const created = await hot!.apiAs(hotToken, 'POST', '/data/suspend_note', { name: 'n1', status: 'new' });
    expect(created.status).toBeLessThan(300);
    const cj = (await created.json()) as { id?: string; record?: { id?: string } };
    noteId = (cj.id ?? cj.record?.id) as string;
    expect(noteId).toBeTruthy();

    const triggered = await hot!.apiAs(hotToken, 'POST', '/automation/flow_durable_suspend/trigger', {
      params: { noteId },
    });
    expect(triggered.status, await triggered.clone().text()).toBeLessThan(300);
    const tj = (await triggered.json()) as any;
    const result = tj.result ?? tj.data ?? tj;
    expect(result.status).toBe('paused');
    runId = result.runId;
    expect(runId, 'no runId on the paused result').toBeTruthy();

    // THE assertion #4470 asked for: the pause is a ROW IN THE DATABASE, read
    // back by id — not "no error was logged", which is exactly what #4420
    // produced while persisting nothing at all.
    const row = await hot!.apiAs(hotToken, 'GET', `/data/sys_automation_run/${runId}`);
    expect(row.status, `no sys_automation_run row for ${runId}`).toBe(200);
    const rj = (await row.json()) as any;
    const rec = rj.record ?? rj;
    expect(rec.status).toBe('paused');
    expect(rec.flow_name).toBe('flow_durable_suspend');
    expect(rec.node_id).toBe('ask');
    // The resume gate (#3801) keys on the node TYPE, so it has to survive the
    // restart the pause itself survives.
    expect(rec.node_type).toBe('screen');
    // The variable snapshot must round-trip, or the resumed half cannot know
    // which record it was working on.
    expect(String(rec.variables_json ?? '')).toContain(noteId);
  });

  it('a COLD kernel — sharing only the database file — rehydrates and resumes the run', async () => {
    // Shut the first process down for real. See the header note: this is what
    // flushes sqlite-wasm's image to disk, and it is also what makes the second
    // boot a restart rather than a second connection.
    await hot!.stop();
    hot = undefined;

    const cold = await bootStack(durableSuspendStack, { automation: true, databaseFile: dbFile });
    try {
      const t = await cold.signIn();

      const resumed = await cold.apiAs(
        t, 'POST', `/automation/flow_durable_suspend/runs/${runId}/resume`,
        { inputs: { resolution: 'fixed upstream' } },
      );
      expect(resumed.status, await resumed.clone().text()).toBeLessThan(300);

      // The downstream node ran, in the cold process, against the variables the
      // FIRST process snapshotted — so the whole state round-trip is proven by
      // an observable data change rather than by a status field.
      const note = await cold.apiAs(t, 'GET', `/data/suspend_note/${noteId}`);
      expect(note.status).toBe(200);
      const rec = ((await note.json()) as any).record ?? {};
      expect(rec.status).toBe('resolved');
      expect(rec.resolution).toBe('fixed upstream');
    } finally {
      await cold.stop();
    }
  }, 120_000);

  it('the screen contract is enforced on a rehydrated pause too (#4477 over the durable path)', async () => {
    // A fresh kernel and a fresh run: the field contract has to survive
    // persistence as well, since `screen_json` is what a rehydrated pause
    // validates against. Suspend in one process, decide in the next.
    const first = await bootStack(durableSuspendStack, { automation: true, databaseFile: dbFile });
    let secondRun: string;
    try {
      const t = await first.signIn();
      const created = await first.apiAs(t, 'POST', '/data/suspend_note', { name: 'n2', status: 'new' });
      const id = ((await created.json()) as any).id ?? ((await created.clone().json()) as any).record?.id;

      const triggered = await first.apiAs(t, 'POST', '/automation/flow_durable_suspend/trigger', {
        params: { noteId: id },
      });
      const tj = (await triggered.json()) as any;
      const result = tj.result ?? tj.data ?? tj;
      expect(result.status).toBe('paused');
      secondRun = result.runId;
    } finally {
      await first.stop();
    }

    const cold = await bootStack(durableSuspendStack, { automation: true, databaseFile: dbFile });
    try {
      const t = await cold.signIn();
      const bad = await cold.apiAs(
        t, 'POST', `/automation/flow_durable_suspend/runs/${secondRun!}/resume`, { inputs: {} },
      );
      expect(bad.status).toBe(400);
      expect(await bad.text()).toContain('resolution');

      // Refused, not consumed: the legitimate submission still lands, in the
      // same cold process.
      const good = await cold.apiAs(
        t, 'POST', `/automation/flow_durable_suspend/runs/${secondRun!}/resume`,
        { inputs: { resolution: 'ok' } },
      );
      expect(good.status, await good.clone().text()).toBeLessThan(300);
    } finally {
      await cold.stop();
    }
  }, 180_000);
});
