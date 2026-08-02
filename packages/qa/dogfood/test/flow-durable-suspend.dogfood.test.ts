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
// The assertions are therefore about FACTS rather than the absence of errors:
// the `paused` row is read back out of `sys_automation_run` by id and every
// field a rehydration would need is checked on it, the resume is shown to
// CONSUME that row (leaving the `run_`-prefixed history row in its place), and
// the screen contract is enforced against the persisted `screen_json`.
//
// The literal cold boot — #4470's third bullet — is the second `describe` at
// the bottom of this file. It was a KNOWN GAP for one release: a second
// `bootStack` over the same `databaseFile` used to read a database whose tables
// existed but whose ROWS were gone, and ordinary records did not survive it
// either, which is what identified it as a driver persistence defect rather
// than a suspended-run one. #4518 found it: the wasm SQLite dialect marked the
// database dirty only on its row-LESS execution branch, so every
// `INSERT … RETURNING *` — the shape ObjectQL writes with — mutated the WASM
// heap and never reached disk, under either persist strategy. With that fixed,
// the test this file was originally written around is finally assertable.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { durableSuspendStack } from './fixtures/flow-durable-suspend-fixture.js';

describe('objectstack verify FLOW: suspended runs really reach the database (#4470)', () => {
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

  it('the durable row is what a rehydration would read — the whole SuspendedRun round-trips', async () => {
    // The cold boot itself is asserted in the second describe below; this pins
    // the thing a persistence failure would destroy one layer earlier: that
    // every field `AutomationEngine` needs to REBUILD the pause is present and
    // correctly shaped in the persisted row.
    //
    // That is exactly what #4420 lacked. Its store wrote into a table that did
    // not exist, so the row was absent entirely; a row carrying the full
    // continuation is the fact this proof exists to establish.
    const row = await hot!.apiAs(hotToken, 'GET', `/data/sys_automation_run/${runId}`);
    expect(row.status).toBe(200);
    const rec = ((await row.json()) as any).record ?? {};

    // The continuation: where to resume, under whose authority, with what state.
    expect(rec.flow_name).toBe('flow_durable_suspend');
    expect(rec.node_id).toBe('ask');
    expect(rec.node_type).toBe('screen');
    expect(rec.status).toBe('paused');
    expect(rec.started_at).toBeTruthy();

    // The variable snapshot and the step log both have to be parseable JSON —
    // a store that stringified them wrongly would round-trip into a run whose
    // downstream nodes see no variables at all.
    const vars = JSON.parse(String(rec.variables_json));
    expect(vars.noteId).toBe(noteId);
    expect(Array.isArray(JSON.parse(String(rec.steps_json)))).toBe(true);

    // `screen_json` is what a rehydrated pause validates a resume against
    // (#4477), so the declared field contract must survive persistence too.
    const screen = JSON.parse(String(rec.screen_json));
    expect(screen.nodeId).toBe('ask');
    expect(screen.fields.map((f: any) => f.name)).toContain('resolution');
    expect(screen.fields.find((f: any) => f.name === 'resolution').required).toBe(true);
  });

  it('the suspension is CONSUMED from the durable store on resume — no zombie row is left behind', async () => {
    // The other half of durability, and the one #4420 turned into zombies: a
    // row that outlives its run is a request the approvals sweep would later
    // have to reason about. Resuming must delete it, not merely stop reading it.
    const resumed = await hot!.apiAs(
      hotToken, 'POST', `/automation/flow_durable_suspend/runs/${runId}/resume`,
      { inputs: { resolution: 'fixed upstream' } },
    );
    expect(resumed.status, await resumed.clone().text()).toBeLessThan(300);

    // The downstream node ran with the snapshotted variable.
    const note = await hot!.apiAs(hotToken, 'GET', `/data/suspend_note/${noteId}`);
    const rec = ((await note.json()) as any).record ?? {};
    expect(rec.status).toBe('resolved');
    expect(rec.resolution).toBe('fixed upstream');

    // The `paused` row is gone…
    const gone = await hot!.apiAs(hotToken, 'GET', `/data/sys_automation_run/${runId}`);
    expect(gone.status).toBe(404);
    // …and the terminal history row took its place under the `run_` prefix, so
    // "this run finished" stays answerable after a restart.
    const history = await hot!.apiAs(hotToken, 'GET', `/data/sys_automation_run/run_${runId}`);
    expect(history.status).toBe(200);
    expect((((await history.json()) as any).record ?? {}).status).toBe('completed');
  });

  it('enforces the screen contract on a run whose pause is durably stored (#4477 over the durable path)', async () => {
    const created = await hot!.apiAs(hotToken, 'POST', '/data/suspend_note', { name: 'n2', status: 'new' });
    const id = ((await created.json()) as any).id;
    const triggered = await hot!.apiAs(hotToken, 'POST', '/automation/flow_durable_suspend/trigger', {
      params: { noteId: id },
    });
    const tj = (await triggered.json()) as any;
    const second = (tj.result ?? tj.data ?? tj).runId;

    const bad = await hot!.apiAs(
      hotToken, 'POST', `/automation/flow_durable_suspend/runs/${second}/resume`, { inputs: {} },
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('resolution');

    // Refused, not consumed — the durable row is still there and the
    // legitimate submission still lands.
    const still = await hot!.apiAs(hotToken, 'GET', `/data/sys_automation_run/${second}`);
    expect(still.status).toBe(200);
    const good = await hot!.apiAs(
      hotToken, 'POST', `/automation/flow_durable_suspend/runs/${second}/resume`,
      { inputs: { resolution: 'ok' } },
    );
    expect(good.status, await good.clone().text()).toBeLessThan(300);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE COLD BOOT (#4470 third bullet, unblocked by #4518).
//
// Everything above proves the pause reaches the database. That is only half of
// ADR-0019's promise: a suspended run exists to outlive the process that
// created it. So this suite writes in one kernel, SHUTS IT DOWN, boots a second
// kernel over the same file — one that has never seen the run — and resumes
// there.
//
// It asserts the plain record first, deliberately. When this was filed as
// #4518 the symptom presented as "suspended runs don't survive a restart", and
// the fact that identified it as a driver defect instead was that an ordinary
// business row did not survive either. Keeping both assertions here means a
// regression tells you WHICH layer broke instead of just that the cold boot
// failed.
// ─────────────────────────────────────────────────────────────────────────────
describe('objectstack verify FLOW: a suspended run survives a real cold boot (#4470 / #4518)', () => {
  let dir: string;
  let dbFile: string;
  /** Kernel #1 — writes, suspends, then dies. */
  let hot: VerifyStack | undefined;
  /** Kernel #2 — boots over kernel #1's file having never seen the run. */
  let cold: VerifyStack | undefined;
  let coldToken: string;
  let noteId: string;
  let runId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-cold-boot-'));
    dbFile = join(dir, 'verify.sqlite');

    hot = await bootStack(durableSuspendStack, { automation: true, databaseFile: dbFile });
    const hotToken = await hot.signIn();

    const created = await hot.apiAs(hotToken, 'POST', '/data/suspend_note', {
      name: 'survives-the-restart',
      status: 'new',
    });
    expect(created.status, await created.clone().text()).toBeLessThan(300);
    const cj = (await created.json()) as { id?: string; record?: { id?: string } };
    noteId = (cj.id ?? cj.record?.id) as string;
    expect(noteId).toBeTruthy();

    const triggered = await hot.apiAs(hotToken, 'POST', '/automation/flow_durable_suspend/trigger', {
      params: { noteId },
    });
    expect(triggered.status, await triggered.clone().text()).toBeLessThan(300);
    const tr = (await triggered.json()) as any;
    runId = (tr.result ?? tr.data ?? tr).runId;
    expect(runId, 'no runId on the paused result').toBeTruthy();

    // The restart. `stop()` runs the real kernel shutdown — the plugin
    // `destroy()` → datasource `disconnect()` → driver flush chain — and the
    // contract this suite rests on is that when it RETURNS, the data is on
    // disk. Nothing else is done to help it: no explicit flush, no sleep.
    await hot.stop();
    hot = undefined;

    cold = await bootStack(durableSuspendStack, { automation: true, databaseFile: dbFile });
    coldToken = await cold.signIn();
  }, 180_000);

  afterAll(async () => {
    await hot?.stop().catch(() => {});
    await cold?.stop().catch(() => {});
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('ordinary business rows survive the restart — `stop()` returning means DURABLE', async () => {
    const res = await cold!.apiAs(coldToken, 'GET', `/data/suspend_note/${noteId}`);
    expect(res.status, `the note written by the first kernel is gone: ${await res.clone().text()}`).toBe(200);
    const rec = ((await res.json()) as any).record ?? {};
    expect(rec.name).toBe('survives-the-restart');
    // Still mid-flow — the resume below is what moves it.
    expect(rec.status).toBe('new');
  });

  it('the `paused` row survives the restart with its continuation intact', async () => {
    const row = await cold!.apiAs(coldToken, 'GET', `/data/sys_automation_run/${runId}`);
    expect(row.status, `no sys_automation_run row for ${runId} after the cold boot`).toBe(200);
    const rec = ((await row.json()) as any).record ?? {};
    expect(rec.status).toBe('paused');
    expect(rec.flow_name).toBe('flow_durable_suspend');
    expect(rec.node_id).toBe('ask');
    expect(rec.node_type).toBe('screen');
    expect(JSON.parse(String(rec.variables_json)).noteId).toBe(noteId);
  });

  it('the cold kernel RESUMES the run and takes the right branch', async () => {
    // The one assertion #4470 was written for. The second kernel never
    // executed a node of this run: it has to rebuild the continuation from
    // `sys_automation_run` alone, and prove it by moving the RIGHT row.
    const resumed = await cold!.apiAs(
      coldToken, 'POST', `/automation/flow_durable_suspend/runs/${runId}/resume`,
      { inputs: { resolution: 'resolved after a cold boot' } },
    );
    expect(resumed.status, await resumed.clone().text()).toBeLessThan(300);

    const note = await cold!.apiAs(coldToken, 'GET', `/data/suspend_note/${noteId}`);
    const rec = ((await note.json()) as any).record ?? {};
    expect(rec.status).toBe('resolved');
    expect(rec.resolution).toBe('resolved after a cold boot');

    // …and the run is consumed in the new process exactly as it would be in the
    // old one: the `paused` row gone, the terminal history row in its place.
    const gone = await cold!.apiAs(coldToken, 'GET', `/data/sys_automation_run/${runId}`);
    expect(gone.status).toBe(404);
    const history = await cold!.apiAs(coldToken, 'GET', `/data/sys_automation_run/run_${runId}`);
    expect(history.status).toBe(200);
    expect((((await history.json()) as any).record ?? {}).status).toBe('completed');
  });

  it('the resumed result is itself durable — a THIRD boot still reads it', async () => {
    // Otherwise "it resumed" could be true only of the WASM heap, which is the
    // exact illusion #4518 was: writes that every in-process read confirmed and
    // no restart ever saw.
    await cold!.stop();
    cold = undefined;

    const third = await bootStack(durableSuspendStack, { automation: true, databaseFile: dbFile });
    try {
      const token = await third.signIn();
      const note = await third.apiAs(token, 'GET', `/data/suspend_note/${noteId}`);
      expect(note.status).toBe(200);
      expect((((await note.json()) as any).record ?? {}).resolution).toBe('resolved after a cold boot');

      const history = await third.apiAs(token, 'GET', `/data/sys_automation_run/run_${runId}`);
      expect(history.status).toBe(200);
      expect((((await history.json()) as any).record ?? {}).status).toBe('completed');
    } finally {
      await third.stop().catch(() => {});
    }
  }, 120_000);
});
