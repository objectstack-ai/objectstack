// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7448] The `['log']` capability must reach the host log stream.
 *
 * These tests assert OBSERVABILITY, not wiring. A null-check ("`ctx.log` is
 * not undefined") passes on a surface that swallows every call, which is the
 * exact defect #7448 recorded: QA run #7439 saw `[BodyRunner] hook fired` at
 * `--log-level debug` while the `ctx.log.info('task completed: …')` the body
 * emitted never appeared anywhere. So every assertion here is on what the
 * HOST LOGGER RECEIVED after a real QuickJS body ran.
 *
 * The captured logger is a `Logger`-contract double: `error` takes
 * `(message, error, meta)`, so a body's `data` landing in the `error` slot
 * would show up here as a lost `meta` rather than passing silently — the
 * shape-dispatch trap `hook-wrappers.ts` documents for `HookDiagnosticsLogger`.
 */

import { describe, it, expect } from 'vitest';
import { hookBodyRunnerFactory, actionBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

interface Line {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  error?: Error;
  meta?: Record<string, any>;
}

/** A `Logger`-contract double — note `error`'s three-arg signature. */
function captureLogger() {
  const lines: Line[] = [];
  return {
    lines,
    debug: (message: string, meta?: any) => { lines.push({ level: 'debug', message, meta }); },
    info: (message: string, meta?: any) => { lines.push({ level: 'info', message, meta }); },
    warn: (message: string, meta?: any) => { lines.push({ level: 'warn', message, meta }); },
    error: (message: string, error?: Error, meta?: any) => {
      lines.push({ level: 'error', message, error, meta });
    },
  };
}

describe('[#7448] hook body ctx.log reaches the host log stream', () => {
  const runner = new QuickJSScriptRunner();

  it('emits the body\'s info line on the logger the factory was constructed with', async () => {
    const logger = captureLogger();
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'showcase', logger });
    // The showcase's own `showcase_audit_task_completion` body, verbatim.
    const fn = factory({
      name: 'showcase_audit_task_completion',
      object: 'showcase_task',
      events: ['afterUpdate'],
      body: {
        language: 'js',
        source:
          "var r = ctx.result || ctx.input || {}; ctx.log.info('task completed: ' + (r.title || r.id || 'unknown'));",
        capabilities: ['log'],
      },
    } as any);
    expect(typeof fn).toBe('function');

    await fn!({ input: {}, result: { title: 'Ship the thing' } } as any);

    // The oracle QA run #7439 could not capture: the NAMED line, at info.
    const emitted = logger.lines.filter((l) => l.message.includes('task completed: Ship the thing'));
    expect(emitted.length).toBe(1);
    expect(emitted[0].level).toBe('info');
  });

  it('emits warn and error levels too, and keeps the body\'s data out of the Error slot', async () => {
    const logger = captureLogger();
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'showcase', logger });
    const fn = factory({
      name: 'showcase_warn_over_budget',
      object: 'showcase_project',
      events: ['afterUpdate'],
      body: {
        language: 'js',
        source:
          "ctx.log.warn('project over budget: Apollo'); " +
          "ctx.log.error('hard fail', { code: 'E1', spent: 120, tags: ['a', 'b'], at: { deep: true } });",
        capabilities: ['log'],
      },
    } as any);

    await fn!({ input: {} } as any);

    const warned = logger.lines.find((l) => l.message.includes('project over budget: Apollo'));
    expect(warned?.level).toBe('warn');

    const errored = logger.lines.find((l) => l.message.includes('hard fail'));
    expect(errored?.level).toBe('error');
    // `Logger.error` is `(message, error, meta)`. The body's data belongs in
    // `meta`; landing it in `error` is how a diagnostic loses every field.
    expect(errored?.error).toBeUndefined();
    // Structured data must cross the VM boundary as a VALUE. Before #7448 the
    // bridge read it with `vm.getString`, so this arrived as the string
    // `"[object Object]"` and every field below was gone.
    expect(errored?.meta).toEqual({ code: 'E1', spent: 120, tags: ['a', 'b'], at: { deep: true } });
  });

  it('attributes the line to the emitting hook', async () => {
    const logger = captureLogger();
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'showcase', logger });
    const fn = factory({
      name: 'showcase_audit_task_completion',
      object: 'showcase_task',
      events: ['afterUpdate'],
      body: { language: 'js', source: "ctx.log.info('hello');", capabilities: ['log'] },
    } as any);

    await fn!({ input: {} } as any);

    const line = logger.lines.find((l) => l.message.includes('hello'));
    expect(line).toBeDefined();
    // An author running ten hooks has to be able to tell which one spoke.
    expect(line!.message).toContain('showcase_audit_task_completion');
  });

  it('warns once, naming the hook, when the capability cannot be served', async () => {
    // No logger at all — the one shape where `['log']` genuinely cannot work.
    // It must not be silent about that; `console.warn` is the only stream left.
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: any[]) => { warnings.push(args.map(String).join(' ')); };
    try {
      const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'showcase' });
      const fn = factory({
        name: 'silent_hook',
        object: 'showcase_task',
        events: ['afterUpdate'],
        body: { language: 'js', source: "ctx.log.info('a'); ctx.log.info('b');", capabilities: ['log'] },
      } as any);
      await fn!({ input: {} } as any);
    } finally {
      console.warn = original;
    }

    const capabilityWarnings = warnings.filter((w) => w.includes('ctx.log output is discarded'));
    expect(capabilityWarnings.length).toBe(1); // once per body, not once per call
    expect(capabilityWarnings[0]).toContain('silent_hook');
  });
});

describe('[#7448] action body ctx.log reaches the host log stream', () => {
  const runner = new QuickJSScriptRunner();

  it('emits the body\'s log line on the factory logger', async () => {
    const logger = captureLogger();
    const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'showcase', logger });
    const fn = factory({
      name: 'recalculate_totals',
      object: 'showcase_project',
      type: 'script',
      body: {
        language: 'js',
        source: "ctx.log.info('recalculated: ' + ctx.input.n); return { ok: true };",
        capabilities: ['log'],
      },
    } as any);
    expect(typeof fn).toBe('function');

    const value = await fn!({ params: { n: 3 } } as any);
    expect(value).toEqual({ ok: true });

    const line = logger.lines.find((l) => l.message.includes('recalculated: 3'));
    expect(line?.level).toBe('info');
    expect(line!.message).toContain('recalculate_totals');
  });
});
