// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — an install-local uninstall (`DELETE
// /api/v1/marketplace/install-local/:manifestId`) withdraws the package's flows
// from the automation engine in the same step, on the real showcase
// composition (#27395).
//
// ## What was measured before the fix
//
// QA run #27392, twice at `c4c515ad`, with two packages: after the uninstall the
// package's flow was gone from the metadata registry (`GET /meta/flow/NAME`
// 404), but the engine still held it — `GET /automation/NAME` answered 200
// with `status: active` and the uninstalled package's `_packageId`, and
// `POST /automation/NAME/trigger` wrote a run row and dispatched the flow.
// The flow, and every trigger it armed, stayed live until something else
// announced `metadata:reloaded`. The door's own note said the package was
// "withdrawn from the running kernel".
//
// The engine withdraws a flow only in its re-sync on `metadata:reloaded`
// (`resyncFlowsFromProtocol`, which tears down every flow the protocol's view
// no longer lists). The install door announces that re-sync; the uninstall
// door withdrew the package from the registry and announced nothing. Triage's
// ruling: the uninstall drives the same unregister path a reload uses — one
// teardown, not a second engine-side list.
//
// ## What this file pins, on one boot
//
//   1. the install hot-loads a package that ships two flows: one run by name,
//      one bound to a record trigger on a showcase object — both served by
//      the engine as the package's, both run once (precondition, measured:
//      the run-by-name flow through the trigger door, the record-triggered one
//      by an insert), each leaving a run row;
//   2. the uninstall answers 200 with no failed outcome, and the registry no
//      longer serves the flow (`GET /meta/flow/NAME` 404 — the half that
//      already worked);
//   3. the engine no longer serves either flow (`GET /automation/NAME` 404);
//   4. the trigger door refuses the flow (404) and writes no run row;
//   5. the record trigger was unbound in the same step: an insert into the
//      watched object runs nothing.
//
// The run counts are read twice: from the engine's run listing, which holds a
// finished run as soon as the dispatch returns (the record trigger awaits its
// flow inside the insert), and from the durable `sys_automation_run` rows.
//
// Boots a fixture stack of its own (the install-local plugin mounted), so it
// stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as ExecutionContext;
const ROUTE = '/marketplace/install-local';
const PACKAGE_ID = 'com.example.qauninst';
/** A flow run by name, through the trigger door. */
const MANUAL_FLOW = 'qauninst_manual_probe';
/** A flow bound to a record trigger on a showcase object, which outlives the uninstall. */
const RECORD_FLOW = 'qauninst_category_created';
const WATCHED = 'showcase_category';
/** How long a run's durable history row is given to land after the dispatch returned. */
const ROW_SETTLE_MS = 1_000;

/** The install body `os package install` sends for an inline manifest that ships two flows and no object. */
const INSTALL_BODY = {
  manifest: {
    id: PACKAGE_ID,
    namespace: 'qauninst',
    name: 'QA uninstall flow withdrawal',
    version: '1.0.0',
    type: 'app',
    flows: [
      {
        name: MANUAL_FLOW,
        label: 'QA uninstall probe (run by name)',
        type: 'autolaunched',
        status: 'active',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
      {
        name: RECORD_FLOW,
        label: 'QA uninstall probe (record trigger)',
        type: 'record_change',
        status: 'active',
        nodes: [
          {
            id: 'start',
            type: 'start',
            label: 'On Category Created',
            config: { objectName: WATCHED, triggerType: 'record-after-insert' },
          },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
    ],
  },
};

type Answer = { status: number; body: any };

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

interface RunCounts { listed: number; rows: number }

describe('dogfood: an install-local uninstall withdraws the package\'s flows from the automation engine', () => {
  let stack: VerifyStack;
  let storageDir: string;
  let ql: IObjectQLEngine;
  let automation: { listRuns(name: string, options?: { limit?: number }): Promise<unknown[]> };

  let install: Answer;
  const before: Record<string, Answer> = {};
  let manualTriggered: Answer;
  let recordInsert: Answer;
  const runsAfterInstall: Record<string, RunCounts> = {};

  let uninstall: Answer;
  const after: Record<string, Answer> = {};
  let metaAfter: Answer;
  let manualTriggerAfter: Answer;
  let recordInsertAfter: Answer;
  const runsAfterUninstall: Record<string, RunCounts> = {};

  const runCounts = async (flow: string): Promise<RunCounts> => ({
    listed: (await automation.listRuns(flow, { limit: 100 })).length,
    rows: rowsOf(await ql.find('sys_automation_run', { where: { flow_name: flow }, context: SYS })).length,
  });

  /** Poll until the flow's durable run rows reach `atLeast` (the history write is not awaited by the dispatch). */
  const settledRunCounts = async (flow: string, atLeast: number): Promise<RunCounts> => {
    const deadline = Date.now() + 10_000;
    let counts = await runCounts(flow);
    while (counts.rows < atLeast && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      counts = await runCounts(flow);
    }
    return counts;
  };

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-install-local-uninstall-flows-'));
    stack = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    automation = stack.kernel.getService('automation') as typeof automation;
    const token = await stack.signIn();

    // ── install, and both flows run once ────────────────────────────────────
    install = await json(await stack.apiAs(token, 'POST', ROUTE, INSTALL_BODY));
    for (const flow of [MANUAL_FLOW, RECORD_FLOW]) {
      before[flow] = await json(await stack.apiAs(token, 'GET', `/automation/${flow}`));
    }
    manualTriggered = await json(await stack.apiAs(token, 'POST', `/automation/${MANUAL_FLOW}/trigger`, {}));
    recordInsert = await json(await stack.apiAs(token, 'POST', `/data/${WATCHED}`, { name: 'Before uninstall' }));
    runsAfterInstall[MANUAL_FLOW] = await settledRunCounts(MANUAL_FLOW, 1);
    runsAfterInstall[RECORD_FLOW] = await settledRunCounts(RECORD_FLOW, 1);

    // ── uninstall ──────────────────────────────────────────────────────────
    uninstall = await json(await stack.apiAs(token, 'DELETE', `${ROUTE}/${PACKAGE_ID}`));
    metaAfter = await json(await stack.apiAs(token, 'GET', `/meta/flow/${MANUAL_FLOW}`));
    for (const flow of [MANUAL_FLOW, RECORD_FLOW]) {
      after[flow] = await json(await stack.apiAs(token, 'GET', `/automation/${flow}`));
    }
    manualTriggerAfter = await json(await stack.apiAs(token, 'POST', `/automation/${MANUAL_FLOW}/trigger`, {}));
    recordInsertAfter = await json(await stack.apiAs(token, 'POST', `/data/${WATCHED}`, { name: 'After uninstall' }));
    // The engine's listing already holds any run these two requests finished;
    // the durable row trails it (its write is not awaited), so the row count is
    // read after a settle window.
    await new Promise((r) => setTimeout(r, ROW_SETTLE_MS));
    runsAfterUninstall[MANUAL_FLOW] = await runCounts(MANUAL_FLOW);
    runsAfterUninstall[RECORD_FLOW] = await runCounts(RECORD_FLOW);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('PRECONDITION: the install hot-loads both flows as the package\'s, and each runs once, leaving a run row', () => {
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.hotLoaded).toBe(true);
    for (const flow of [MANUAL_FLOW, RECORD_FLOW]) {
      expect(before[flow].status, `${flow}: ${JSON.stringify(before[flow].body)}`).toBe(200);
      expect(before[flow].body?.data?._packageId).toBe(PACKAGE_ID);
    }
    expect(manualTriggered.status, JSON.stringify(manualTriggered.body)).toBe(200);
    expect(recordInsert.status, JSON.stringify(recordInsert.body)).toBeLessThan(300);
    expect(runsAfterInstall).toEqual({
      [MANUAL_FLOW]: { listed: 1, rows: 1 },
      [RECORD_FLOW]: { listed: 1, rows: 1 },
    });
  });

  it('the uninstall answers 200 with no failed outcome, and the registry no longer serves the flow', () => {
    expect(uninstall.status, JSON.stringify(uninstall.body)).toBe(200);
    expect(uninstall.body?.success).toBe(true);
    const failed = (uninstall.body?.data?.cleanups ?? []).filter((o: { success?: unknown }) => o.success !== true);
    expect(failed).toEqual([]);
    expect(metaAfter.status, JSON.stringify(metaAfter.body)).toBe(404);
  });

  it('the engine no longer serves either flow: GET /automation/NAME answers 404', () => {
    for (const flow of [MANUAL_FLOW, RECORD_FLOW]) {
      expect(after[flow].status, `${flow}: ${JSON.stringify(after[flow].body)}`).toBe(404);
    }
  });

  it('the trigger door refuses the uninstalled flow with 404, and no run row is written', () => {
    expect(manualTriggerAfter.status, JSON.stringify(manualTriggerAfter.body)).toBe(404);
    expect(runsAfterUninstall[MANUAL_FLOW]).toEqual(runsAfterInstall[MANUAL_FLOW]);
  });

  it('the record trigger was unbound in the same step: an insert into the watched object runs nothing', () => {
    expect(recordInsertAfter.status, JSON.stringify(recordInsertAfter.body)).toBeLessThan(300);
    expect(runsAfterUninstall[RECORD_FLOW]).toEqual(runsAfterInstall[RECORD_FLOW]);
  });
});
