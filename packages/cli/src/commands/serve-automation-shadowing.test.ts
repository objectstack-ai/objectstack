// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The startup banner names a contested flow name, and says WHICH body is armed
 * (#12028).
 *
 * ── The hole this closes ─────────────────────────────────────────────────
 *
 * The engine's flow map is keyed by BARE name. When a packaged flow and a
 * runtime-authored `sys_metadata` overlay both claim one name, ADR-0005
 * precedence arms one of them and the loser is not in the map — so it is not in
 * `listFlows()`, not in `getFlowRuntimeStates()`'s row set, and therefore not in
 * ANY count this banner prints. `3 flow(s), 3 bound to triggers` is a true
 * sentence about a set that does not contain the definition the operator just
 * edited, and nothing on the banner contradicts it.
 *
 * #11997 gave the engine the receipt (`getShadowedFlows()`, plus `armedFrom` /
 * `shadowed` on each runtime-state row). The automation plugin warns from it at
 * `kernel:bootstrapped` — but that is a `logger.warn`, and the whole reason this
 * banner reads engine STATE rather than scraping output is that the boot-quiet
 * stdout window swallows exactly those lines. The banner was the reliable
 * channel and it was silent.
 *
 * ── Why these pins read the RENDERED line ────────────────────────────────
 *
 * Asserting that `collectAutomationSummary` "read the field" would pass with a
 * banner that prints nothing, which is the defect. So every pin below drives a
 * shadowing receipt through the real `collectAutomationSummary` and the real
 * `printServerReady`, and reads the stderr line an operator sees — the shape
 * `format.seed-summary.test.ts` and `serve-organizations-message-spelling.test.ts`
 * already use on this surface.
 *
 * ── The instrument must be able to say no ────────────────────────────────
 *
 * `prints no shadowing line …` is not filler. The banner is read on every
 * `os dev` / `os start`; a warning that also appears when nothing is wrong is a
 * warning readers learn to skip, and the next real one goes with it. An
 * always-firing implementation passes every positive pin in this file, so the
 * absence legs are what actually constrain it.
 *
 * ── The fakes ────────────────────────────────────────────────────────────
 *
 * `getShadowedFlows()` returns `FlowShadowingRecord[]` — `{ name, armed,
 * shadowed }`, where a contender is `{ source: 'package' | 'runtime';
 * packageId?: string }` (`packages/services/service-automation/src/engine.ts`,
 * `FlowContender` / `FlowShadowingRecord`). Hand-rolled here rather than
 * imported, matching the sibling `serve-automation-summary.test.ts`: the probe
 * under test is feature-detected against an OLDER automation package, so typing
 * these fakes against the current one would defeat the tolerance legs below.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { collectAutomationSummary } from './serve.js';
import { printServerReady, type ServerReadyOptions } from '../utils/format.js';

type Contender = { source: 'package' | 'runtime'; packageId?: string };
type ShadowRecord = { name: string; armed: Contender; shadowed: Contender[] };

type FlowState = {
  name: string;
  enabled: boolean;
  bound: boolean;
  status?: string;
  triggerType?: string;
  object?: string;
};

function fakeKernel(services: Record<string, unknown>) {
  return {
    getService(name: string) {
      if (!(name in services)) throw new Error(`Service '${name}' not found`);
      return services[name];
    },
  };
}

/** An engine that knows about shadowing — i.e. anything from #11997 onwards. */
function fakeAutomation(states: FlowState[], shadowing: ShadowRecord[] = []) {
  return {
    getFlowRuntimeStates: () =>
      states.map((s) => {
        const record = shadowing.find((r) => r.name === s.name);
        // The engine attaches the receipt to the row too, for a name still in
        // the flow map. Mirrored here so the fake is not quietly narrower than
        // the thing it stands in for.
        return record ? { ...s, armedFrom: record.armed, shadowed: record.shadowed } : s;
      }),
    getRegisteredTriggerTypes: () => ['record_change'],
    getTriggerBindingAudit: () => [],
    getShadowedFlows: () => shadowing,
  };
}

const armed = (states: FlowState[], shadowing: ShadowRecord[] = []) =>
  collectAutomationSummary(fakeKernel({ automation: fakeAutomation(states, shadowing) }), states.length);

const flow = (name: string): FlowState => ({
  name,
  enabled: true,
  bound: true,
  status: 'active',
  triggerType: 'record_change',
  object: 'lead',
});

/**
 * The realistic pair, in the direction ADR-0005 actually resolves: a runtime
 * overlay row OUTRANKS the packaged body, so the definition shipped in the
 * package is the one that stopped running.
 */
const CONTESTED: ShadowRecord = {
  name: 'send-welcome',
  armed: { source: 'runtime' },
  shadowed: [{ source: 'package', packageId: 'crm' }],
};

describe('collectAutomationSummary — flow-name shadowing (#12028)', () => {
  it('carries the contested name, the armed body and the displaced count', () => {
    const summary = armed([flow('send-welcome'), flow('score-lead')], [CONTESTED])!;
    expect(summary.shadowed).toEqual([
      { flowName: 'send-welcome', armed: { source: 'runtime' }, shadowedCount: 1 },
    ]);
  });

  it('is empty when no name is contested', () => {
    expect(armed([flow('send-welcome')])!.shadowed).toEqual([]);
  });

  it('drops a receipt that displaced nothing — that is not a contested name', () => {
    const summary = armed(
      [flow('send-welcome')],
      [{ name: 'send-welcome', armed: { source: 'runtime' }, shadowed: [] }],
    )!;
    expect(summary.shadowed).toEqual([]);
  });

  // The probe is feature-detected exactly like the `unbound` one beside it, and
  // with nothing more. These two legs are what "exactly" means: an automation
  // package predating #11997 has no `getShadowedFlows` at all, and the banner
  // must degrade to its plain counts rather than take the whole boot down.
  it('degrades on an engine that predates the receipt, without losing the banner', () => {
    const older = {
      getFlowRuntimeStates: () => [flow('send-welcome')],
      getRegisteredTriggerTypes: () => ['record_change'],
      getTriggerBindingAudit: () => [],
    };
    const summary = collectAutomationSummary(fakeKernel({ automation: older }), 1)!;
    expect(summary.shadowed).toEqual([]);
    expect(summary.flowCount).toBe(1);
  });

  it('degrades when the receipt probe throws', () => {
    const hostile = {
      getFlowRuntimeStates: () => [flow('send-welcome')],
      getRegisteredTriggerTypes: () => ['record_change'],
      getTriggerBindingAudit: () => [],
      getShadowedFlows: () => {
        throw new Error('older engine');
      },
    };
    const summary = collectAutomationSummary(fakeKernel({ automation: hostile }), 1)!;
    expect(summary.shadowed).toEqual([]);
    expect(summary.flowCount).toBe(1);
  });
});

describe('startup banner — what an operator reads when a flow name is contested (#12028)', () => {
  const base: ServerReadyOptions = {
    externalBaseOrigin: 'http://localhost:3000',
    configFile: 'objectstack.config.ts',
    isDev: true,
    pluginCount: 1,
  };
  let lines: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lines = [];
    // stderr, not stdout (#7915) — the whole banner is a diagnostic.
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
  });
  afterEach(() => spy.mockRestore());

  const render = (states: FlowState[], shadowing: ShadowRecord[] = []) => {
    printServerReady({ ...base, automation: armed(states, shadowing) });
    return lines.filter((l) => l.includes('is claimed by'));
  };

  it('names the contested flow, WHICH definition is armed, and how many were shadowed', () => {
    const shown = render([flow('send-welcome'), flow('score-lead')], [CONTESTED]);
    expect(shown).toHaveLength(1);
    // All three facts, in the one line the operator gets. The middle one is the
    // point of the card: a line that reports the count and stops has told an
    // admin something is wrong and withheld which body is running.
    expect(shown[0]).toContain("flow 'send-welcome'");                        // which name
    expect(shown[0]).toContain('a runtime-authored row (sys_metadata) is ARMED'); // which body
    expect(shown[0]).toContain('1 shadowed');                                 // how many lost
    expect(shown[0]).toContain('is claimed by 2 definitions');
    expect(shown[0]).toContain('only the armed definition dispatches');
  });

  it('names the package when the packaged body is the one that armed', () => {
    const shown = render(
      [flow('send-welcome')],
      [{ name: 'send-welcome', armed: { source: 'package', packageId: 'crm' }, shadowed: [{ source: 'runtime' }] }],
    );
    expect(shown[0]).toContain("package 'crm' is ARMED");
  });

  it('never interpolates an absent package id into the sentence', () => {
    const shown = render(
      [flow('send-welcome')],
      [{ name: 'send-welcome', armed: { source: 'package' }, shadowed: [{ source: 'runtime' }] }],
    );
    expect(shown[0]).toContain('a code-shipped package (id unknown) is ARMED');
    expect(shown[0]).not.toContain('undefined');
  });

  it('counts every displaced definition, not just the first', () => {
    const shown = render(
      [flow('send-welcome')],
      [{
        name: 'send-welcome',
        armed: { source: 'runtime' },
        shadowed: [{ source: 'package', packageId: 'crm' }, { source: 'package', packageId: 'marketing' }],
      }],
    );
    expect(shown[0]).toContain('is claimed by 3 definitions');
    expect(shown[0]).toContain('2 shadowed');
  });

  it('reports one line per contested name', () => {
    const shown = render(
      [flow('send-welcome'), flow('score-lead')],
      [
        CONTESTED,
        { name: 'score-lead', armed: { source: 'runtime' }, shadowed: [{ source: 'package', packageId: 'crm' }] },
      ],
    );
    expect(shown).toHaveLength(2);
    expect(shown.join('\n')).toContain("flow 'score-lead'");
  });

  // ── The instrument can say no ──────────────────────────────────────────
  it('prints no shadowing line on a healthy boot, while still printing the counts', () => {
    expect(render([flow('send-welcome'), flow('score-lead')])).toEqual([]);
    // Not silent about everything — the ordinary Flows: row is still there, so
    // the absence above is the line being withheld, not the banner being off.
    expect(lines.some((l) => l.includes('Flows:') && l.includes('2 flow(s)'))).toBe(true);
  });

  it('prints no shadowing line for a receipt that displaced nothing', () => {
    expect(
      render([flow('send-welcome')], [{ name: 'send-welcome', armed: { source: 'runtime' }, shadowed: [] }]),
    ).toEqual([]);
  });

  it('prints no shadowing line when the automation engine is not enabled at all', () => {
    printServerReady({ ...base, automation: collectAutomationSummary(fakeKernel({}), 2) });
    expect(lines.filter((l) => l.includes('is claimed by'))).toEqual([]);
  });
});
