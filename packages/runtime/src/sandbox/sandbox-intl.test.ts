// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28898] A sandboxed body can do time-zone date maths: `Intl.DateTimeFormat`
 * exists inside the QuickJS sandbox and answers what the host's does.
 *
 * The reported job (duly#147) computes each duty's current period in that
 * duty's own IANA zone, which needs `Intl.DateTimeFormat` with `timeZone`. The
 * sandbox had no `Intl`, so the job could not leave the deprecated `handler`.
 *
 * Every expected value here is computed with the HOST's `Intl` in this test,
 * never written as a literal: the formatter's output moves with the ICU build
 * (CI's Node and a local one can differ), and the claim under test is "equals
 * the host's", not any particular spelling.
 */

import { describe, it, expect } from 'vitest';
import { QuickJSScriptRunner } from './quickjs-runner.js';
import { jobBodyRunnerFactory } from './body-runner.js';
import type { ScriptContext, ScriptRunOptions } from './script-runner.js';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000, actionTimeoutMs: 10_000, jobTimeoutMs: 10_000 });
const jobOpts: ScriptRunOptions = { origin: { kind: 'job', name: 'duty_dispatch' } };
const ctx = (): ScriptContext => ({ input: {} });

async function runJobBody(source: string): Promise<unknown> {
  const r = await runner.run({ language: 'js', source, capabilities: [] }, ctx(), jobOpts);
  return r.value;
}

/** What a body's `throw` reads as once it has left the sandbox. */
async function jobBodyThrow(source: string): Promise<string> {
  return runJobBody(source).then(
    (v) => `resolved: ${JSON.stringify(v)}`,
    (e: Error) => String(e.message),
  );
}

/** The host's own error for the same call, as `Name: message`. */
function hostThrow(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return `${(e as Error).name}: ${(e as Error).message}`;
  }
  return 'did not throw';
}

// 2026-03-08 is the US spring-forward: New York's 02:00 EST is 07:00Z, so the
// two instants one second apart sit either side of the DST edge.
const BEFORE_DST = Date.UTC(2026, 2, 8, 6, 59, 59);
const AFTER_DST = Date.UTC(2026, 2, 8, 7, 0, 0);
const PARTS_OPTIONS = {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23', timeZoneName: 'short',
} as const;

describe('job body sandbox — Intl.DateTimeFormat (#28898)', () => {
  it('the card reproduction: formatToParts in two IANA zones across a DST edge equals the host', async () => {
    const zones = ['America/New_York', 'Asia/Shanghai'];
    const value = await runJobBody(`
      const zones = ${JSON.stringify(zones)};
      const instants = [${BEFORE_DST}, ${AFTER_DST}];
      const out = {};
      for (const tz of zones) {
        const f = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, ${JSON.stringify(PARTS_OPTIONS)}));
        out[tz] = instants.map((t) => f.formatToParts(new Date(t)));
      }
      return out;
    `);

    const expected: Record<string, Intl.DateTimeFormatPart[][]> = {};
    for (const tz of zones) {
      const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...PARTS_OPTIONS });
      expected[tz] = [BEFORE_DST, AFTER_DST].map((t) => f.formatToParts(new Date(t)));
    }
    expect(value).toEqual(expected);
    // Anti-vacuity: the edge is really crossed in New York and not in Shanghai.
    const tzName = (parts: Intl.DateTimeFormatPart[]) => parts.find((p) => p.type === 'timeZoneName')?.value;
    expect(tzName(expected['America/New_York'][0])).not.toBe(tzName(expected['America/New_York'][1]));
    expect(tzName(expected['Asia/Shanghai'][0])).toBe(tzName(expected['Asia/Shanghai'][1]));
  });

  it('format, resolvedOptions, formatRange and formatRangeToParts equal the host', async () => {
    const opts = { timeZone: 'Asia/Shanghai', dateStyle: 'full', timeStyle: 'long' } as const;
    const value = await runJobBody(`
      const f = new Intl.DateTimeFormat('de-DE', ${JSON.stringify(opts)});
      return {
        format: f.format(${BEFORE_DST}),
        resolved: f.resolvedOptions(),
        range: f.formatRange(${BEFORE_DST}, ${AFTER_DST} + 86400000),
        rangeParts: f.formatRangeToParts(new Date(${BEFORE_DST}), new Date(${AFTER_DST})),
      };
    `);
    const f = new Intl.DateTimeFormat('de-DE', opts);
    expect(value).toEqual({
      format: f.format(BEFORE_DST),
      resolved: f.resolvedOptions(),
      range: f.formatRange(BEFORE_DST, AFTER_DST + 86_400_000),
      rangeParts: f.formatRangeToParts(new Date(BEFORE_DST), new Date(AFTER_DST)),
    });
  });

  it('the period-start shape the reported job needs: the calendar date of an instant in its duty zone', async () => {
    const value = await runJobBody(`
      const ymd = (t, tz) => {
        const p = {};
        for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t)) p[x.type] = x.value;
        return p.year + '-' + p.month + '-' + p.day;
      };
      // 2026-03-08T20:00Z is still the 8th in New York and already the 9th in Shanghai.
      const t = Date.UTC(2026, 2, 8, 20);
      return [ymd(t, 'America/New_York'), ymd(t, 'Asia/Shanghai')];
    `);
    expect(value).toEqual(['2026-03-08', '2026-03-09']);
  });

  it('behaves as the built-in does: callable without new, a bound format getter, instanceof, toStringTag', async () => {
    const value = await runJobBody(`
      const f = Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric' });
      return {
        typeofCtor: typeof Intl.DateTimeFormat,
        isInstance: f instanceof Intl.DateTimeFormat,
        sameFormat: f.format === f.format,
        mapped: [${BEFORE_DST}, ${AFTER_DST}].map(f.format),
        tag: Object.prototype.toString.call(f),
        intlTag: Object.prototype.toString.call(Intl),
        supported: Intl.DateTimeFormat.supportedLocalesOf(['en-US', 'de-DE']),
      };
    `);
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric' });
    expect(value).toEqual({
      typeofCtor: 'function',
      isInstance: true,
      sameFormat: true,
      mapped: [BEFORE_DST, AFTER_DST].map(f.format),
      tag: '[object Intl.DateTimeFormat]',
      intlTag: '[object Intl]',
      supported: Intl.DateTimeFormat.supportedLocalesOf(['en-US', 'de-DE']),
    });
  });

  it('options are read at construction: a later mutation of the options object changes nothing', async () => {
    const value = await runJobBody(`
      const o = { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' };
      const f = new Intl.DateTimeFormat('en-US', o);
      o.timeZone = 'America/New_York';
      return f.format(${AFTER_DST});
    `);
    expect(value).toBe(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(AFTER_DST));
  });

  it('an invalid timeZone throws the RangeError the host throws, as a RangeError inside the body', async () => {
    const value = await runJobBody(`
      try { new Intl.DateTimeFormat('en-US', { timeZone: 'Mars/Olympus_Mons' }); return 'no throw'; }
      catch (e) { return { isRange: e instanceof RangeError, name: e.name, message: e.message }; }
    `);
    const host = hostThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: 'Mars/Olympus_Mons' }));
    expect(value).toEqual({ isRange: true, name: 'RangeError', message: host.replace(/^RangeError: /, '') });

    // Uncaught, it fails the run with the host's sentence, like any body throw.
    const thrown = await jobBodyThrow(`new Intl.DateTimeFormat('en-US', { timeZone: 'Mars/Olympus_Mons' });`);
    expect(thrown).toContain(host);
  });

  it('an invalid time value and a missing range end throw what the host throws', async () => {
    const value = await runJobBody(`
      const f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' });
      const grab = (fn) => { try { fn(); return 'no throw'; } catch (e) { return e.name + ': ' + e.message; } };
      return [grab(() => f.format(NaN)), grab(() => f.formatRange(0)), grab(() => f.formatToParts('not a date'))];
    `);
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' });
    expect(value).toEqual([
      hostThrow(() => f.format(NaN)),
      hostThrow(() => (f.formatRange as (a: number) => string)(0)),
      hostThrow(() => f.formatToParts('not a date' as unknown as number)),
    ]);
  });

  it('the rest of Intl is absent, not half-working: DateTimeFormat is the one member', async () => {
    const value = await runJobBody(`
      return {
        own: Object.getOwnPropertyNames(Intl),
        numberFormat: typeof Intl.NumberFormat,
        intlEnumerable: Object.keys(globalThis).includes('Intl'),
      };
    `);
    expect(value).toEqual({ own: ['DateTimeFormat'], numberFormat: 'undefined', intlEnumerable: false });
  });

  it('no host object crosses: answers are VM-made plain values, the bridge is unreachable, and a foreign receiver is refused', async () => {
    const value = await runJobBody(`
      const f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' });
      const ro = f.resolvedOptions();
      const parts = f.formatToParts(0);
      let foreign;
      try { Intl.DateTimeFormat.prototype.formatToParts.call({}, 0); foreign = 'no throw'; } catch (e) { foreign = e.name; }
      return {
        roIsVmObject: Object.getPrototypeOf(ro) === Object.prototype,
        partsIsVmArray: Array.isArray(parts) && Object.getPrototypeOf(parts) === Array.prototype,
        freshCopy: f.resolvedOptions() !== ro,
        // The bridge is a closure of the installed shim, never a global.
        bridgeGlobals: Object.getOwnPropertyNames(globalThis).filter((n) => /intl|bridge/i.test(n)),
        foreign,
      };
    `);
    expect(value).toEqual({ roIsVmObject: true, partsIsVmArray: true, freshCopy: true, bridgeGlobals: ['Intl'], foreign: 'TypeError' });
  });

  it('a body that replaces JSON.stringify / Date.now cannot steer the bridge', async () => {
    const value = await runJobBody(`
      const realStringify = JSON.stringify;
      JSON.stringify = () => '{"l":"en-US","o":{"timeZone":"America/New_York"}}';
      Date.now = () => 0;
      const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' });
      const zone = f.resolvedOptions().timeZone;
      const year = f.format();
      // Put it back: the runner reads the body's return value through it.
      JSON.stringify = realStringify;
      return { zone, year };
    `);
    // format() with no argument took "now" from the VM clock captured at
    // install, not from the body's replacement (which would have said 1970).
    expect(value).toEqual({ zone: 'Asia/Shanghai', year: new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(Date.now()) });
  });

  it('hook and action bodies share the runner, so they get the same Intl.DateTimeFormat', async () => {
    const source = `return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(${AFTER_DST});`;
    const expected = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(AFTER_DST);
    for (const kind of ['hook', 'action'] as const) {
      const r = await runner.run({ language: 'js', source, capabilities: [] }, ctx(), { origin: { kind, name: 't' } });
      expect(r.value, kind).toBe(expected);
    }
  });

  it('through the job door: a bound job body reports a zone-local date in its outcome', async () => {
    const handler = jobBodyRunnerFactory(runner, { ql: {} as never, appId: 'duly' })({
      name: 'duty_dispatch',
      body: {
        language: 'js',
        source: `
          const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.UTC(2026, 2, 8, 20));
          return { outcome: 'completed', reason: 'period ' + d };
        `,
        capabilities: [],
      },
    });
    expect(handler, 'the job body must bind').toBeTypeOf('function');
    await expect(handler!({ jobId: 'run_1' })).resolves.toEqual({ outcome: 'completed', reason: 'period 2026-03-09' });
  });
});
