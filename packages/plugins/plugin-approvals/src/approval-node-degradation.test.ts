// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4771 (second half) — the missing-automation degradation must be LOUD.
 *
 * `ApprovalsServicePlugin.start()` contributes the ADR-0019 `approval` node
 * executor to the flow engine. When there is no engine to contribute it to,
 * every approval flow in the deployment is dead on arrival — and that fact was
 * logged at `info`, while `os dev` runs at the default `warn` level. The one
 * line that mattered was invisible in exactly the deployment where it was true
 * (and #4632 already ruled that a silent degradation is a defect, not a style).
 *
 * The mirror-image assertion matters just as much: when the engine IS present
 * the executor is registered and nothing is warned about, because the pair is
 * what makes the log line diagnostic rather than decorative.
 */

import { describe, it, expect } from 'vitest';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { APPROVAL_NODE_TYPE } from '@objectstack/spec/automation';

/** Minimal ObjectQL stand-in — enough for start() to build the service. */
function fakeObjectql() {
  return {
    async find() { return []; },
    async insert(_o: string, d: any) { return { ...d }; },
    async update(_o: string, d: any) { return { ...d }; },
    async delete() { return { affected: 0 }; },
  };
}

function makeCtx(services: Record<string, unknown>) {
  const logs = { info: [] as string[], warn: [] as string[] };
  const ctx: any = {
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
      return services[name];
    },
    registerService: () => {},
    logger: {
      info: (msg: string) => logs.info.push(msg),
      warn: (msg: string) => logs.warn.push(msg),
      error: () => {},
      debug: () => {},
    },
  };
  return { ctx, logs };
}

describe('ApprovalsServicePlugin — missing automation engine is reported at warn (#4771)', () => {
  it('WARNS (not info) and names the consequence when no automation service exists', async () => {
    const { ctx, logs } = makeCtx({ objectql: fakeObjectql() });
    await new ApprovalsServicePlugin({ disableAutoHooks: true }).start(ctx);

    // The whole point: visible at the default dev log level.
    const warned = logs.warn.filter((m) => m.includes('no automation engine'));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(APPROVAL_NODE_TYPE);
    expect(warned[0]).toMatch(/NOT registered/);
    // It carries the remedy, not just the symptom.
    expect(warned[0]).toMatch(/@objectstack\/service-automation/);
    // …and it is no longer buried under a level dev never prints.
    expect(logs.info.some((m) => m.includes('no automation engine'))).toBe(false);
  });

  it('WARNS when an automation service exists but cannot take node executors', async () => {
    // A foreign/older `automation` service degrades identically — pre-fix this
    // branch logged nothing at all, at any level.
    const { ctx, logs } = makeCtx({ objectql: fakeObjectql(), automation: { resume: async () => undefined } });
    await new ApprovalsServicePlugin({ disableAutoHooks: true }).start(ctx);

    expect(logs.warn.filter((m) => m.includes('no automation engine'))).toHaveLength(1);
  });

  it('registers the `approval` executor and says nothing when the engine is present', async () => {
    const registered: string[] = [];
    const automation = {
      registerNodeExecutor: (e: { type: string }) => registered.push(e.type),
      resume: async () => undefined,
    };
    const { ctx, logs } = makeCtx({ objectql: fakeObjectql(), automation });
    await new ApprovalsServicePlugin({ disableAutoHooks: true }).start(ctx);

    expect(registered).toEqual([APPROVAL_NODE_TYPE]);
    expect(logs.warn.filter((m) => m.includes('no automation engine'))).toEqual([]);
  });
});
