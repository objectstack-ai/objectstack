// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29059] The boot banner counts declared flows the engine REFUSED at
// registration, beside the declared count.
//
// A flow `registerFlow` refuses is logged once at WARN and the boot goes on
// without it (#28893's second ask; that is unchanged here). Before this the
// banner's Flows line counted only what armed, so a refused flow showed only
// as a per-flow line under Boot diagnostics, and a boot whose every declared
// flow was refused printed no Flows line at all.
//
// The count is read off the engine's own record: the host's sync calls
// `recordFlowRefusal` when `registerFlow` throws, and the banner asks
// `getFlowRegistration(name)` for each declared name, the read the metadata
// door already serves. So the engine here is the REAL one (dist, already in
// `KNOWN_UNALIASED_TEST_IMPORTS['@objectstack/cli']`), refusing a real
// malformed region, not a fake that answers `refused` by fiat. Locally: build
// `@objectstack/service-automation` before running this.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationEngine } from '@objectstack/service-automation';
import { collectAutomationSummary } from './serve.js';
import { printServerReady, type ServerReadyOptions } from '../utils/format.js';

const quiet = () => ({ debug() {}, info() {}, warn() {}, error() {} }) as never;

const kernelWith = (automation: unknown) => ({
  getService(name: string) {
    if (name === 'automation') return automation;
    throw new Error(`Service '${name}' not found`);
  },
});

const n = (id: string, type = 'assignment', extra: Record<string, unknown> = {}) => ({ id, type, label: id, ...extra });
const e = (id: string, source: string, target: string) => ({ id, source, target, type: 'default' });

/** An autolaunched flow: start → <middle> → end. */
const flow = (name: string, middle: Record<string, unknown>) => ({
  name, label: name, type: 'autolaunched', status: 'active',
  nodes: [n('start', 'start'), middle, n('end', 'end')],
  edges: [e('e1', 'start', String(middle.id)), e('e2', String(middle.id), 'end')],
});

/** A `parallel` with one branch: `validateControlFlow` refuses it at registration. */
const refusedFlow = (name: string) => flow(name, n('fan', 'parallel', { config: { branches: [{ nodes: [n('only')], edges: [] }] } }));
const goodFlow = (name: string) => flow(name, n('work'));

/** Register each flow the way the host's sync does: a refusal is recorded, never thrown on. */
function engineWith(flows: Array<{ name: string }>): AutomationEngine {
  const engine = new AutomationEngine(quiet());
  for (const def of flows) {
    try {
      engine.registerFlow(def.name, def as never);
    } catch (err) {
      engine.recordFlowRefusal(def.name, err);
    }
  }
  return engine;
}

const base: ServerReadyOptions = {
  externalBaseOrigin: 'http://localhost:3000',
  httpServer: 'composed',
  configFile: 'objectstack.config.ts',
  isDev: true,
  pluginCount: 1,
};

describe('[#29059] the boot banner counts flows refused at registration', () => {
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

  const flowsLines = () => lines.filter((l) => l.includes('Flows:'));

  it('one of two declared flows refused: the count rides beside the declared count', () => {
    const declared = [goodFlow('ok_flow'), refusedFlow('fan_flow')];
    const engine = engineWith(declared);
    // The engine really refused it: the record is its own, not the test's.
    expect(engine.getFlowRegistration('fan_flow').state).toBe('refused');

    const summary = collectAutomationSummary(kernelWith(engine), declared.length, declared.map((f) => f.name))!;
    expect(summary).toMatchObject({ declaredFlowCount: 2, refusedCount: 1, flowCount: 1 });

    printServerReady({ ...base, automation: summary });
    expect(flowsLines().filter((l) => l.includes('2 flow(s) declared, 1 refused at registration'))).toHaveLength(1);
  });

  it('every declared flow refused: the banner still says so, though nothing registered', () => {
    const declared = [refusedFlow('fan_flow')];
    const summary = collectAutomationSummary(kernelWith(engineWith(declared)), 1, ['fan_flow'])!;
    expect(summary).toMatchObject({ declaredFlowCount: 1, refusedCount: 1, flowCount: 0 });

    printServerReady({ ...base, automation: summary });
    expect(flowsLines().filter((l) => l.includes('1 flow(s) declared, 1 refused at registration'))).toHaveLength(1);
  });

  it('CONTROL: nothing refused prints no refused line', () => {
    const declared = [goodFlow('ok_flow')];
    const summary = collectAutomationSummary(kernelWith(engineWith(declared)), 1, ['ok_flow'])!;
    expect(summary.refusedCount).toBe(0);

    printServerReady({ ...base, automation: summary });
    expect(lines.filter((l) => l.includes('refused at registration'))).toEqual([]);
    expect(flowsLines()).toHaveLength(1);
  });

  it('an engine that does not answer the read degrades to a zero count, not a crash', () => {
    const older = { getFlowRuntimeStates: () => [{ name: 'ok_flow', enabled: true, bound: false }] };
    const summary = collectAutomationSummary(kernelWith(older), 2, ['ok_flow', 'fan_flow'])!;
    expect(summary.refusedCount).toBe(0);
  });
});
