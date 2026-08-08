// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `resumeAuthority` omission warning at descriptor registration (#5561).
 *
 * The #3801 resume gate only covers a pausing node type whose author remembered
 * to declare WHO may resume it. While `ActionDescriptorSchema.resumeAuthority`
 * carried `.default('any')`, an omission could not even be observed: Zod filled
 * the key inside `defineActionDescriptor`, producing a descriptor byte-identical
 * to an author's explicit `'any'`. So a forgotten declaration was fail-open and
 * unreportable — #3823 is the incident (a revise pause in a service-owned
 * position inherited `wait`'s legitimate `'any'`, and a raw resume walked past a
 * decision nothing had recorded).
 *
 * The default is gone, so absent means absent, and `registerNodeExecutor` says
 * so once per node type. Since step two absent also RESOLVES fail-closed
 * (`'service'`), so the warning now precedes a refusal rather than describing a
 * silence — this file still asserts about the LOG, and
 * `resume-authority-gate.test.ts` asserts the refusal it warns about.
 */

import { describe, it, expect } from 'vitest';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { ActionDescriptor } from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';

/** The stable substring this file counts findings by. */
const OMISSION = 'declares supportsPause but never declares';

/** An engine whose `logger.warn` lines land in `warnings`. */
function engineWith(warnings: string[]): AutomationEngine {
  return new AutomationEngine(loggerInto(warnings));
}

function loggerInto(warnings: string[]): any {
  const logger: any = {
    info() {},
    debug() {},
    error() {},
    warn(msg: string) { warnings.push(msg); },
    child() { return logger; },
  };
  return logger;
}

/** A registrable executor for `type`, publishing `descriptor` fields verbatim. */
function executor(type: string, fields: Partial<ActionDescriptor>) {
  return {
    type,
    descriptor: defineActionDescriptor({ type, version: '1.0.0', name: type, ...fields }),
    async execute() { return { success: true }; },
  };
}

function omissions(warnings: string[]): string[] {
  return warnings.filter((w) => w.includes(OMISSION));
}

describe('resumeAuthority omission warning (#5561)', () => {
  it('names a pausing node type that never declared resumeAuthority, exactly once', () => {
    const warnings: string[] = [];
    const engine = engineWith(warnings);

    engine.registerNodeExecutor(executor('plugin_pause', { supportsPause: true }));

    const found = omissions(warnings);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("'plugin_pause'");
  });

  it('names the consequence (refusal) and the declaration that lifts it', () => {
    const warnings: string[] = [];
    engineWith(warnings).registerNodeExecutor(executor('plugin_pause', { supportsPause: true }));

    const [line] = omissions(warnings);
    // Single self-sufficient line: the two legal values, the incident, and what
    // now actually happens to this type's pauses. Step one's wording — that
    // declaring 'any' "changes no behaviour" — is exactly what step two made
    // false, and a warning that still said it would send an author away from the
    // one field that restores their resume route.
    expect(line).toContain("'any'");
    expect(line).toContain("'service'");
    expect(line).toContain('#3801');
    expect(line).toContain('#3823');
    expect(line).toContain('REFUSES');
    expect(line).toContain("Declaring 'any' is what RESTORES the generic route");
    expect(line).not.toContain('changes no behaviour');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('does not double-count a re-registration of the same type (hot reload, multi-tenant seed)', () => {
    const warnings: string[] = [];
    const engine = engineWith(warnings);

    engine.registerNodeExecutor(executor('plugin_pause', { supportsPause: true }));
    engine.registerNodeExecutor(executor('plugin_pause', { supportsPause: true }));
    engine.registerNodeExecutor(executor('plugin_pause', { supportsPause: true }));

    expect(omissions(warnings)).toHaveLength(1);
  });

  it('dedupes per TYPE, not per engine — a second omission is a second finding', () => {
    const warnings: string[] = [];
    const engine = engineWith(warnings);

    engine.registerNodeExecutor(executor('pause_a', { supportsPause: true }));
    engine.registerNodeExecutor(executor('pause_b', { supportsPause: true }));

    const found = omissions(warnings);
    expect(found).toHaveLength(2);
    expect(found.some((w) => w.includes("'pause_a'"))).toBe(true);
    expect(found.some((w) => w.includes("'pause_b'"))).toBe(true);
  });

  it('is per engine instance — an embedded host that builds one engine per tenant hears it each time', () => {
    const first: string[] = [];
    const second: string[] = [];

    engineWith(first).registerNodeExecutor(executor('plugin_pause', { supportsPause: true }));
    engineWith(second).registerNodeExecutor(executor('plugin_pause', { supportsPause: true }));

    expect(omissions(first)).toHaveLength(1);
    expect(omissions(second)).toHaveLength(1);
  });

  it("stays silent when 'any' is declared explicitly — same value, a decision instead of a gap", () => {
    const warnings: string[] = [];
    const engine = engineWith(warnings);

    engine.registerNodeExecutor(executor('open_pause', { supportsPause: true, resumeAuthority: 'any' }));

    expect(omissions(warnings)).toHaveLength(0);
  });

  it("stays silent when 'service' is declared", () => {
    const warnings: string[] = [];
    const engine = engineWith(warnings);

    engine.registerNodeExecutor(executor('gated_pause', { supportsPause: true, resumeAuthority: 'service' }));

    expect(omissions(warnings)).toHaveLength(0);
  });

  it('stays silent for a non-pausing type that omits it — there is no pause to authorize', () => {
    const warnings: string[] = [];
    const engine = engineWith(warnings);

    // Omitted entirely (the common case) and declared false (explicit).
    engine.registerNodeExecutor(executor('send_sms', {}));
    engine.registerNodeExecutor(executor('send_fax', { supportsPause: false }));

    expect(omissions(warnings)).toHaveLength(0);
  });

  it('stays silent for an executor that publishes no descriptor at all', () => {
    const warnings: string[] = [];
    const engine = engineWith(warnings);

    engine.registerNodeExecutor({ type: 'bare', async execute() { return { success: true }; } });

    expect(omissions(warnings)).toHaveLength(0);
  });

  /**
   * The zero this step lands at: every built-in pausing type now declares its
   * authority, so a real boot names nothing. Asserted together with the
   * inventory it depends on — a zero that came from registering no pausing
   * descriptors at all would be the empty-green trap, passing because nothing
   * was produced rather than because the declarations are there.
   */
  it('names nothing on a full built-in install, and the four pausing built-ins are why', () => {
    const warnings: string[] = [];
    const engine = engineWith(warnings);
    const ctx: any = { logger: loggerInto([]), getService() { return undefined; } };

    installBuiltinNodes(engine, ctx);

    const pausing = engine.getActionDescriptors().filter((d) => d.supportsPause === true);
    expect(pausing.map((d) => d.type).sort()).toEqual(['map', 'screen', 'subflow', 'wait']);
    for (const d of pausing) {
      expect(d.resumeAuthority, `${d.type} must declare its resume authority`).toBe('any');
    }
    expect(omissions(warnings)).toHaveLength(0);
  });
});

describe('resumeAuthority resolution is fail-closed by omission (#5561 step two)', () => {
  /**
   * The breaking half. `resolveResumeAuthority`'s fallback used to be `'any'` —
   * inherited from the schema default step one removed — and is now `'service'`,
   * so an undeclared pausing type is closed to the generic resume route instead
   * of open to it. This is the ONE expression the whole flip lives in, which is
   * why it is pinned directly here as well as end-to-end in
   * `resume-authority-gate.test.ts`.
   */
  const resolverOf = (engine: AutomationEngine) =>
    (engine as unknown as {
      resolveResumeAuthority(t: string): 'any' | 'service';
    }).resolveResumeAuthority.bind(engine);

  it("resolves an undeclared pausing type to 'service' — the opposite of the removed default", () => {
    const engine = engineWith([]);
    engine.registerNodeExecutor(executor('plugin_pause', { supportsPause: true }));

    const resolve = resolverOf(engine);

    expect(resolve('plugin_pause')).toBe('service');
    // A type nothing ever registered declared nothing either, so it answers the
    // same way. The gate still speaks only to authorization: a run whose node
    // type cannot be resolved at all never reaches this, and machine-state
    // errors stay `resumeInternal`'s to report.
    expect(resolve('never_registered')).toBe('service');
  });

  it('leaves an explicit declaration untouched in both directions', () => {
    const engine = engineWith([]);
    engine.registerNodeExecutor(executor('open_pause', { supportsPause: true, resumeAuthority: 'any' }));
    engine.registerNodeExecutor(executor('gated_pause', { supportsPause: true, resumeAuthority: 'service' }));

    const resolve = resolverOf(engine);

    // The flip moves the fallback only — a declared value is a decision, and
    // `'any'` must keep meaning `'any'` or the migration prescription is a lie.
    expect(resolve('open_pause')).toBe('any');
    expect(resolve('gated_pause')).toBe('service');
  });

  it('reads the four pausing built-ins as open, because each declares so', () => {
    // The repo-is-unchanged proof, at the resolver rather than through the
    // engine: every shipped pausing type declared `'any'` in step one, so the
    // flip moves nothing in this tree. A green suite alone could not tell that
    // apart from "no pausing type was reachable" (the empty-green trap), so the
    // inventory is asserted with it.
    const engine = engineWith([]);
    const ctx: any = { logger: loggerInto([]), getService() { return undefined; } };
    installBuiltinNodes(engine, ctx);

    const resolve = resolverOf(engine);
    const pausing = engine.getActionDescriptors().filter((d) => d.supportsPause === true);

    expect(pausing.map((d) => d.type).sort()).toEqual(['map', 'screen', 'subflow', 'wait']);
    for (const d of pausing) {
      expect(resolve(d.type), `${d.type} must resolve open, from its own declaration`).toBe('any');
    }
  });
});
