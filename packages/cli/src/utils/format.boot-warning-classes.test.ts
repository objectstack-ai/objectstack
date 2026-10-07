// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiteKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { AutomationServicePlugin } from '@objectstack/service-automation';
import { SCHEDULED_WORK_DISABLED_REASON, SCHEDULED_WORK_ENV } from '@objectstack/types';
import {
  printBootDiagnostics,
  printServerReady,
  type AutomationReadySummary,
  type ServerReadyOptions,
} from './format.js';
import { BootLogCapture } from './boot-log-capture.js';
import { collectAutomationSummary } from '../commands/serve.js';

/**
 * #22073 — one boot line per warning class, and each warning printed once.
 *
 * ## What the boot looked like
 *
 * Measured on hotcrm (17.7.0): an app with eight package-authored scheduled
 * flows, on a deployment with scheduled work off (the default), printed the
 * same ~600-character paragraph SIXTEEN times — once per flow in the banner's
 * `Flows:` list, and once per flow again in *Boot diagnostics*, which replays
 * `@objectstack/service-automation`'s own `kernel:bootstrapped` audit warning
 * for the same flows. Sixteen of a 66-line boot, burying the five real
 * warnings beside them.
 *
 * ## The pins (triage ruling on #22073)
 *
 *   - an app with eight scheduled flows prints ONE schedule line;
 *   - no warning appears twice — banner list OR Boot diagnostics, not both;
 *   - (the loopback OAuth line is `@objectstack/plugin-auth`'s, pinned in
 *     its own `mcp-oauth-plaintext-notice.test.ts`).
 *
 * ## Why one leg boots the REAL producer
 *
 * The print-once rule works by the banner naming the logger records it
 * restated, so it is only as good as its agreement with the wording
 * `@objectstack/service-automation` actually emits. A formatter test fed
 * hand-written records would stay green through a reworded producer while
 * the boot doubled again. So the first describe block boots the real
 * `AutomationServicePlugin` on a `LiteKernel`, captures its stdout through the
 * same `BootLogCapture` `serve` uses, reads the summary through the same
 * `collectAutomationSummary`, and holds both pins against ONE transcript. The
 * formatter legs after it cover the shapes a real boot does not reach cheaply.
 *
 * ⚠️ The two `@objectstack/*` package imports resolve to their built `dist`
 * (both are already in `KNOWN_UNALIASED_TEST_IMPORTS['@objectstack/cli']`;
 * `turbo.json` builds dependencies before `@objectstack/cli#test`).
 */

/** Eight names, none a substring of another, so a per-name line count is exact. */
const SCHEDULED_FLOWS = [
  'digest_daily',
  'reminder_weekly',
  'cleanup_nightly',
  'renewal_check',
  'sla_monitor',
  'invoice_sweep',
  'backup_ping',
  'quota_reset',
];

/** The deployment-policy reason's SECOND sentence — the long explanation. */
const LONG_EXPLANATION = 'This is not a binding failure';

const BASE: ServerReadyOptions = {
  externalBaseOrigin: 'http://localhost:3000',
  isDev: true,
  pluginCount: 3,
};

let transcript: string[];
let errSpy: ReturnType<typeof vi.spyOn>;

/** Strip SGR so assertions hold whether or not chalk colors this run. */
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

const linesWith = (needle: string) => transcript.filter((line) => line.includes(needle));

beforeEach(() => {
  transcript = [];
  errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    for (const line of plain(args.join(' ')).split('\n')) transcript.push(line);
  });
});

afterEach(() => {
  errSpy.mockRestore();
});

/** A package-authored `schedule` flow — the shape every hotcrm flow had. */
const scheduleFlow = (name: string) => ({
  name,
  label: name,
  type: 'schedule',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { schedule: '0 8 * * *' } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/**
 * The one `objectql` seam the automation plugin's boot pull reads — the same
 * stand-in `@objectstack/service-automation`'s own plugin-path tests use, so
 * the flows register on the real `start()` path.
 */
function fakeObjectqlPlugin(flows: unknown[]): Plugin {
  return {
    name: 'fake-objectql',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      (ctx as unknown as { registerService(n: string, s: unknown): void }).registerService('objectql', {
        registry: {
          listItems: (type: string) => (type === 'flow' ? flows : []),
          getObject: () => undefined,
        },
      });
    },
  };
}

describe('a real automation boot with eight scheduled flows and scheduled work off', () => {
  let priorSwitch: string | undefined;
  beforeEach(() => {
    priorSwitch = process.env[SCHEDULED_WORK_ENV];
    delete process.env[SCHEDULED_WORK_ENV];
  });
  afterEach(() => {
    if (priorSwitch === undefined) delete process.env[SCHEDULED_WORK_ENV];
    else process.env[SCHEDULED_WORK_ENV] = priorSwitch;
  });

  /**
   * Boot under a capture of stdout exactly as `serve`'s boot-quiet window
   * does, then print the real banner from the real engine.
   */
  async function bootAndPrintBanner(): Promise<{ captured: string[] }> {
    const capture = new BootLogCapture();
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, encoding?: unknown) => {
      capture.write(chunk as string | Uint8Array, typeof encoding === 'string' ? encoding : undefined);
      return true;
    }) as never);
    const kernel = new LiteKernel();
    kernel.use(fakeObjectqlPlugin(SCHEDULED_FLOWS.map(scheduleFlow)));
    kernel.use(new AutomationServicePlugin());
    try {
      await kernel.bootstrap();
    } finally {
      outSpy.mockRestore();
    }
    try {
      const captured = capture.diagnostics();
      printServerReady({
        ...BASE,
        automation: collectAutomationSummary(kernel, SCHEDULED_FLOWS.length),
        bootDiagnostics: { lines: captured, dropped: capture.droppedCount },
      });
      return { captured };
    } finally {
      await kernel.shutdown();
    }
  }

  it('prints ONE schedule line, naming all eight flows', async () => {
    const { captured } = await bootAndPrintBanner();

    // The premise, asserted first: the producer really warned once per flow
    // into the capture — without it the print-once assertion below is vacuous.
    for (const name of SCHEDULED_FLOWS) {
      expect(
        captured.filter((record) => record.includes(`'${name}'`) && record.includes('NOT bound')),
        `the automation plugin emitted no bootstrap warning for '${name}'`,
      ).toHaveLength(1);
    }

    const scheduleLines = linesWith("a 'schedule' trigger");
    expect(scheduleLines, transcript.join('\n')).toHaveLength(1);
    expect(scheduleLines[0]).toContain('8 flows declare');
    expect(scheduleLines[0]).toContain('NOT bound');
    for (const name of SCHEDULED_FLOWS) expect(scheduleLines[0]).toContain(name);
    // The class's short text is the reason's first sentence — cause and switch.
    expect(scheduleLines[0]).toContain('disabled by deployment policy');
    expect(scheduleLines[0]).toContain(SCHEDULED_WORK_ENV);
  });

  it('prints no warning twice — every flow named on exactly one line', async () => {
    await bootAndPrintBanner();

    for (const name of SCHEDULED_FLOWS) {
      expect(linesWith(name), `'${name}' is named on more than one line:\n${transcript.join('\n')}`).toHaveLength(1);
    }
    // The long explanation is not on the default-level screen at all; it is
    // what `--log-level debug` streams (the producer's own per-flow line).
    expect(linesWith(LONG_EXPLANATION)).toEqual([]);
  });
});

/** The audit entries the engine reports for flows refused by deployment policy. */
const policyRefused = (names: string[], triggerType = 'schedule'): AutomationReadySummary['unbound'] =>
  names.map((flowName) => ({ flowName, triggerType, reason: SCHEDULED_WORK_DISABLED_REASON }));

const summary = (over: Partial<AutomationReadySummary>): AutomationReadySummary => ({
  enabled: true,
  declaredFlowCount: 0,
  flowCount: 10,
  boundCount: 0,
  triggerTypes: ['schedule', 'record_change'],
  unbound: [],
  unknownObject: [],
  shadowed: [],
  draftCount: 0,
  ...over,
});

/**
 * One captured record as `ObjectLogger`'s pretty format renders it — the shape
 * `BootLogCapture` retains (the real-boot block above reads the real one).
 */
const record = (message: string) => `2026-10-07T13:47:40.255Z WARN ${message}`;

/** `@objectstack/service-automation`'s bootstrap audit line for one flow. */
const auditRecord = (name: string, triggerType = 'schedule', reason = SCHEDULED_WORK_DISABLED_REASON) =>
  record(`[Automation] flow '${name}' declares a '${triggerType}' trigger but is NOT bound — it will never auto-launch. ${reason}`);

describe('one line per warning class (formatter)', () => {
  it('keeps distinct (trigger type, reason) classes on distinct lines, in first-seen order', () => {
    const missingTrigger =
      "no 'schedule' trigger is registered — add requires: ['triggers'] (record_change/schedule/time_relative/api ship in @objectstack/trigger-*)";
    const bindingFailed = "trigger 'record_change' is registered but binding failed — see earlier warnings";
    printServerReady({
      ...BASE,
      automation: summary({
        unbound: [
          ...policyRefused(['a_flow', 'b_flow']),
          { flowName: 'c_flow', triggerType: 'schedule', reason: missingTrigger },
          { flowName: 'd_flow', triggerType: 'record_change', reason: bindingFailed },
          ...policyRefused(['e_flow'], 'time_relative'),
        ],
      }),
    });

    const classLines = linesWith('NOT bound');
    expect(classLines).toHaveLength(4);
    expect(classLines[0]).toContain("2 flows declare a 'schedule' trigger but are NOT bound — disabled by deployment policy");
    expect(classLines[0]).toMatch(/: a_flow, b_flow$/);
    // A one-sentence reason comes back whole — its remedy included.
    expect(classLines[1]).toBe(`  ⚠ 1 flow declares a 'schedule' trigger but is NOT bound — ${missingTrigger}: c_flow`);
    expect(classLines[2]).toBe(`  ⚠ 1 flow declares a 'record_change' trigger but is NOT bound — ${bindingFailed}: d_flow`);
    // Same reason, different trigger type ⇒ its own class.
    expect(classLines[3]).toContain("1 flow declares a 'time_relative' trigger but is NOT bound — disabled by deployment policy");
  });

  it('cuts a long reason to its first sentence, and says where the rest prints', () => {
    printServerReady({ ...BASE, automation: summary({ unbound: policyRefused(['a_flow']) }) });

    const firstSentence = SCHEDULED_WORK_DISABLED_REASON.slice(0, SCHEDULED_WORK_DISABLED_REASON.indexOf('. This'));
    expect(linesWith('NOT bound')).toEqual([
      `  ⚠ 1 flow declares a 'schedule' trigger but is NOT bound — ${firstSentence}: a_flow`,
    ]);
    expect(linesWith(LONG_EXPLANATION)).toEqual([]);
    expect(linesWith('--log-level debug')).toHaveLength(1);
  });

  it('prints no shortening hint when every reason is already one sentence', () => {
    printServerReady({
      ...BASE,
      automation: summary({
        unbound: [{ flowName: 'a_flow', triggerType: 'api', reason: "no 'api' trigger is registered — add requires: ['triggers']" }],
      }),
    });
    expect(linesWith('NOT bound')).toHaveLength(1);
    expect(linesWith('--log-level debug')).toEqual([]);
  });
});

describe('print-once: Boot diagnostics withholds what the banner restated (formatter)', () => {
  // A boot warning no banner section restates. Shaped as the runtime-assets
  // plugin's branding warning (`describeUnservedBrandingAssets` in
  // `console.ts`, #22071) renders it — the first new boot warning to land
  // beside this rule, which must keep it single.
  const unrelated = record(
    "Branding asset not served: app 'crm' (branding.logo, branding.favicon) → /runtime/assets/icon.svg, but " +
      'the directory searched, /srv/app/assets (the cwd/assets default, since OS_RUNTIME_ASSETS_DIR is unset), ' +
      'does not exist, so /runtime/assets/ is not mounted this run; the console will draw a broken image. To fix, ' +
      'put icon.svg in that directory and restart, or set OS_RUNTIME_ASSETS_DIR to the directory that holds it.',
  );

  it('replays every other record exactly once, and counts the withheld ones', () => {
    const names = ['a_flow', 'b_flow', 'c_flow'];
    printServerReady({
      ...BASE,
      automation: summary({ unbound: policyRefused(names) }),
      bootDiagnostics: { lines: [...names.map((n) => auditRecord(n)), unrelated] },
    });

    for (const name of names) expect(linesWith(name), transcript.join('\n')).toHaveLength(1);
    // A boot warning no banner section restates — the branding warning #22071
    // added included — prints once, in Boot diagnostics: neither doubled nor
    // dropped.
    expect(linesWith('Branding asset not served')).toHaveLength(1);
    expect(linesWith('/runtime/assets/icon.svg')).toHaveLength(1);
    expect(linesWith('Boot diagnostics')).toEqual([
      '  ⚠ Boot diagnostics — 1 warning logged during startup (3 more already listed above):',
    ]);
  });

  it('prints no Boot diagnostics block when the banner restated every record', () => {
    printServerReady({
      ...BASE,
      automation: summary({ unbound: policyRefused(['a_flow']) }),
      bootDiagnostics: { lines: [auditRecord('a_flow')] },
    });
    expect(linesWith('Boot diagnostics')).toEqual([]);
    expect(linesWith('a_flow')).toHaveLength(1);
  });

  it('withholds a JSON-format record too', () => {
    const json = JSON.stringify({
      time: '2026-10-07T13:47:40.255Z',
      level: 'warn',
      msg: `[Automation] flow 'a_flow' declares a 'schedule' trigger but is NOT bound — it will never auto-launch. ${SCHEDULED_WORK_DISABLED_REASON}`,
    });
    printServerReady({
      ...BASE,
      automation: summary({ unbound: policyRefused(['a_flow']) }),
      bootDiagnostics: { lines: [json, unrelated] },
    });
    expect(linesWith('a_flow')).toHaveLength(1);
  });

  it('⛔ never withholds a record the banner did NOT restate — a flow it does not list stays', () => {
    printServerReady({
      ...BASE,
      automation: summary({ unbound: policyRefused(['a_flow']) }),
      // b_flow's record without a banner line naming it: printed, not dropped.
      bootDiagnostics: { lines: [auditRecord('a_flow'), auditRecord('b_flow')] },
    });
    expect(linesWith('b_flow')).toHaveLength(1);
    expect(linesWith('b_flow')[0]).toContain("[Automation] flow 'b_flow'");
  });

  it('withholds the shadowed-flow restatement, and keeps the pull-time collision record that explains it', () => {
    const restatement = record(
      "[Automation] flow 'dup_flow' is claimed by 2 definitions — package 'crm' is ARMED and a runtime-authored " +
        'row (sys_metadata) is shadowed (see the flow name collision warning for the rule that armed it). ' +
        'Only the armed definition dispatches.',
    );
    const collision = record(
      "[Automation] Flow name collision: 'dup_flow' is claimed by 2 definitions (package 'crm', a runtime-authored " +
        "row (sys_metadata)); arming package 'crm' by package id, and shadowing 1 other definition(s). " +
        'Only the armed definition dispatches. Rename one of them.',
    );
    printServerReady({
      ...BASE,
      automation: summary({
        shadowed: [{ flowName: 'dup_flow', armed: { source: 'package', packageId: 'crm' }, shadowedCount: 1 }],
      }),
      bootDiagnostics: { lines: [collision, restatement] },
    });
    expect(linesWith('is ARMED')).toHaveLength(1); // the banner's line
    expect(linesWith('Flow name collision')).toHaveLength(1);
    expect(linesWith('Boot diagnostics')).toEqual([
      '  ⚠ Boot diagnostics — 1 warning logged during startup (1 more already listed above):',
    ]);
  });

  it('with no banner (the failed-boot path) replays every record', () => {
    printBootDiagnostics({ lines: [auditRecord('a_flow'), unrelated] });
    expect(linesWith('a_flow')).toHaveLength(1);
    expect(linesWith('Boot diagnostics')).toEqual(['  ⚠ Boot diagnostics — 2 warnings logged during startup:']);
  });
});
