// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10556 (a)] `SecurityPlugin`'s OWN report sink is console-backed by default —
 * loud until a host injects one.
 *
 * ## The shape this pins, and why it is a design call rather than a `?` deletion
 *
 * The plugin reports its fail-closed refusals through `this.logger`, a private
 * field it owns. That field was declared `{ info?; warn?; error? }` and
 * INITIALISED `= {}`, so every one of those reports — `getReadFilter … denying
 * (fail-closed, #2852)`, `checkAuthoredRowWrite … abstaining`, the ADR-0123
 * tenant-wall refusal — went nowhere at all until a host happened to inject a
 * sink. `#9754`'s rule (an optional `error` must sit beside a NON-optional
 * `warn`) cannot be satisfied by dropping a `?` here: a required `warn` on a
 * field initialised `= {}` is a type that lies. The maintainer ruled
 * (2026-08-24) that the DEFAULT becomes a console-backed sink, and that
 * silent-by-declaration is rejected.
 *
 * ## Why these three cases and not a field poke
 *
 * Case 1 drives a REAL report site on a bare instance, so the pin is about what
 * an operator sees rather than about a field's contents. `getReadFilter` with an
 * on-behalf-of context is the one refusal reachable with no `ql`, no `metadata`
 * and no `start()`: it fails closed on the unimplemented D10 delegator
 * intersection (#2852) and reports through `this.logger.error?.()`.
 *
 * Case 2 pins the channel the LEDGER row is about. `error` stays optional by
 * #9754's own ruling (hosts inject reduced sinks); `warn` is the channel a
 * durability report degrades to, so it is the one that must exist in every
 * value of the type — including the default.
 *
 * Case 3 is the half that keeps case 1 and 2 from being a regression: a host
 * that DOES inject a sink must get its own sink, not the console default beside
 * it. `start()` binds `ctx.logger` above both of its early bail-outs (#10706),
 * so this holds on a degraded boot too.
 *
 * ⚠️ There is deliberately no `@ts-expect-error` compile-time pin here.
 * `packages/plugins/plugin-security/tsconfig.json` EXCLUDES every `*.test.ts`
 * file under `src`
 * (TEST_DEBT ledger), so a `@ts-expect-error` in this package evaluates never —
 * it is not a weak pin, it is no pin. The compile-time half is carried by
 * `pnpm check:optional-error-sink`, which runs on every PR with no `paths:`
 * filter and turns RED the moment `warn` goes back to optional on this sink.
 */

import { describe, expect, it, vi } from 'vitest';

import { SecurityPlugin } from './security-plugin.js';

describe('[#10556 (a)] SecurityPlugin default report sink', () => {
  it('reports a fail-closed refusal to the console when no host sink was injected', async () => {
    const plugin = new SecurityPlugin();
    const seen: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      seen.push(args);
    });

    let filter: Record<string, unknown> | undefined;
    try {
      // No `start()`, no `ctx` — a bare instance, which is exactly the state in
      // which the `= {}` default used to swallow this refusal.
      filter = await plugin.getReadFilter('sys_task', {
        userId: 'agent-1',
        onBehalfOf: { userId: 'delegator-1' },
      });
    } finally {
      spy.mockRestore();
    }

    // The refusal itself is unchanged — this card moves where the REPORT goes,
    // never whether the plugin denies.
    expect(filter).toBeDefined();

    expect(seen).toHaveLength(1);
    expect(String(seen[0]?.[0])).toContain('denying (fail-closed, #2852)');
  });

  it('guarantees a `warn` channel on the default sink, and routes it to the console', () => {
    const plugin = new SecurityPlugin();
    const sink = (plugin as unknown as { logger: { warn?: (...a: unknown[]) => void } }).logger;

    expect(typeof sink.warn).toBe('function');

    const seen: unknown[][] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      seen.push(args);
    });
    try {
      sink.warn?.('[security] a durability report with nowhere else to land');
    } finally {
      spy.mockRestore();
    }

    expect(seen).toHaveLength(1);
    expect(String(seen[0]?.[0])).toContain('a durability report with nowhere else to land');
  });

  it('is REPLACED by the host sink `start()` binds, not kept beside it', async () => {
    const plugin = new SecurityPlugin();
    const hostSeen: unknown[][] = [];
    const consoleSeen: unknown[][] = [];
    const hostLogger = {
      debug: () => {},
      info: () => {},
      warn: (...args: unknown[]) => { hostSeen.push(args); },
      error: () => {},
    };
    const ctx = {
      logger: hostLogger,
      // Both `getService` calls in `start()` throw here, so `start()` takes its
      // FIRST early bail-out. #10706 hoisted the sink binding ABOVE both bails,
      // and this case is what keeps that hoist from silently regressing: on a
      // degraded boot the host sink must still be the one bound.
      getService: () => { throw new Error('no services in this test kernel'); },
      registerService: () => {},
    };

    await plugin.start(ctx as unknown as Parameters<SecurityPlugin['start']>[0]);

    // The bail-out itself reports through `ctx.logger` directly; count from
    // here so this case measures only where the FIELD now points.
    const beforeCount = hostSeen.length;

    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      consoleSeen.push(args);
    });
    try {
      const sink = (plugin as unknown as { logger: { warn?: (...a: unknown[]) => void } }).logger;
      sink.warn?.('[security] routed to the host, not to the console');
    } finally {
      spy.mockRestore();
    }

    expect(hostSeen).toHaveLength(beforeCount + 1);
    expect(String(hostSeen[beforeCount]?.[0])).toContain('routed to the host, not to the console');
    // ⚠️ Asserted through a captured array, never `expect(spy).not.toHaveBeenCalled()`:
    // `mockRestore()` CLEARS a vitest spy's call history, so that spelling passes
    // whether the console was written to or not.
    expect(consoleSeen).toHaveLength(0);
  });
});
