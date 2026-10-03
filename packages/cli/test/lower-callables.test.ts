// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { lowerCallables } from '../src/utils/lower-callables.js';

describe('lowerCallables', () => {
  it('replaces Hook.handler functions with their hook name and registers the original', () => {
    const fnA = async () => 'a';
    const fnB = async () => 'b';
    const input = {
      hooks: [
        { name: 'account_protection', handler: fnA, events: ['beforeInsert'], object: 'account' },
        { name: 'lead_qualification', handler: fnB, events: ['afterInsert'], object: 'lead' },
      ],
    };

    const out = lowerCallables(input);

    expect(out.count).toBe(2);
    expect(out.functions.account_protection).toBe(fnA);
    expect(out.functions.lead_qualification).toBe(fnB);
    expect((out.lowered.hooks as any[])[0].handler).toBe('account_protection');
    expect((out.lowered.hooks as any[])[1].handler).toBe('lead_qualification');
    // Original input is not mutated.
    expect(input.hooks[0].handler).toBe(fnA);
  });

  it('leaves string handlers untouched', () => {
    const input = {
      hooks: [
        { name: 'preserve_me', handler: 'external_fn', events: ['beforeInsert'], object: 'x' },
      ],
    };
    const out = lowerCallables(input);
    expect(out.count).toBe(0);
    expect(Object.keys(out.functions)).toHaveLength(0);
    expect((out.lowered.hooks as any[])[0].handler).toBe('external_fn');
  });

  it('lowers top-level functions map and array shapes', () => {
    const m = () => 1;
    const a = () => 2;
    const out = lowerCallables({
      functions: { my_map_fn: m },
      hooks: [],
    });
    expect(out.count).toBe(1);
    expect(out.functions.my_map_fn).toBe(m);
    expect((out.lowered.functions as Record<string, string>).my_map_fn).toBe('my_map_fn');

    const out2 = lowerCallables({
      functions: [{ name: 'my_arr_fn', handler: a }],
    });
    expect(out2.count).toBe(1);
    expect(out2.functions.my_arr_fn).toBe(a);
    expect((out2.lowered.functions as any[])[0].handler).toBe('my_arr_fn');
  });

  it('disambiguates colliding names with a numeric suffix', () => {
    const f1 = () => 1;
    const f2 = () => 2;
    const out = lowerCallables({
      hooks: [
        { name: 'dup', handler: f1, events: ['beforeInsert'], object: 'x' },
      ],
      functions: { dup: f2 },
    });
    expect(out.count).toBe(2);
    expect(out.functions.dup).toBe(f1);
    expect(out.functions.dup__2).toBe(f2);
  });

  // #1876 — a handler referencing a module-scope helper must NOT be lowered to a
  // metadata body (it would ReferenceError at runtime). Instead it stays
  // registered for BUNDLING (closure preserved) and a body-extraction warning is
  // recorded naming the offending identifier.
  it('does not body-lower a handler that references a module-scope helper; keeps it for bundling (#1876)', () => {
    const handler = (ctx: any) => {
      ctx.record.slug = moduleHelper(ctx.record.name);
    };
    const out = lowerCallables({
      hooks: [{ name: 'slugify_hook', handler, events: ['beforeInsert'], object: 'doc' }],
    });
    // Still registered (so the bundle carries the real closure)…
    expect(out.functions.slugify_hook).toBe(handler);
    expect((out.lowered.hooks as any[])[0].handler).toBe('slugify_hook');
    // …but NOT shipped as a metadata-only body…
    expect((out.lowered.hooks as any[])[0].body).toBeUndefined();
    expect(out.bodyExtracted).toBe(0);
    // …and the reason is recorded, naming the free identifier.
    expect(out.bodyExtractionWarnings).toHaveLength(1);
    expect(out.bodyExtractionWarnings[0].reason).toMatch(/moduleHelper|not in scope at runtime/);
  });

  it('still body-lowers a self-contained handler (params + globals only) (#1876)', () => {
    const handler = (ctx: any) => {
      ctx.record.id = Math.round(Number(ctx.record.raw));
    };
    const out = lowerCallables({
      hooks: [{ name: 'contained_hook', handler, events: ['beforeInsert'], object: 'doc' }],
    });
    expect(out.bodyExtracted).toBe(1);
    expect((out.lowered.hooks as any[])[0].body).toBeDefined();
    // [#16546] The ref this hook was minted under (its own name here, no
    // collision) is recorded as body-from-handler — what the two hook
    // write-set rules read to redirect their finding's `path`.
    expect((out.lowered.hooks as any[])[0].handler).toBe('contained_hook');
    expect(out.loweredHookRefs.has('contained_hook')).toBe(true);
    expect(out.loweredHookRefs.size).toBe(1);
  });

  it('[#16546] does NOT mark the ref when body extraction fails — no body was minted to misreport', () => {
    const handler = (ctx: any) => {
      ctx.record.slug = moduleHelper(ctx.record.name);
    };
    const out = lowerCallables({
      hooks: [{ name: 'slugify_hook_2', handler, events: ['beforeInsert'], object: 'doc' }],
    });
    expect(out.bodyExtracted).toBe(0);
    expect(out.loweredHookRefs.size).toBe(0);
  });

  it('[#16546] does NOT mark the ref when the hook already carries an author-written `body`', () => {
    // `lowerCallables` never extracts over an existing `body` (`if (!hook.body)`)
    // — the `handler` is still lowered to a ref for bundling, but the body
    // judged by the write-set rules is the one the author wrote, so its `path`
    // must stay `body.source`.
    const handler = (ctx: any) => {
      ctx.record.id = Math.round(Number(ctx.record.raw));
    };
    const out = lowerCallables({
      hooks: [
        {
          name: 'authored_body_hook',
          handler,
          events: ['beforeInsert'],
          object: 'doc',
          body: { language: 'js', source: 'ctx.record.id = 1;' },
        },
      ],
    });
    expect((out.lowered.hooks as any[])[0].handler).toBe('authored_body_hook');
    expect((out.lowered.hooks as any[])[0].body).toEqual({ language: 'js', source: 'ctx.record.id = 1;' });
    expect(out.loweredHookRefs.size).toBe(0);
  });

  it('produces a JSON-serializable lowered shape', () => {
    const out = lowerCallables({
      hooks: [
        { name: 'h', handler: () => 1, events: ['beforeInsert'], object: 'x' },
      ],
    });
    // Round-trip through JSON.stringify must not throw or drop fields.
    const json = JSON.stringify(out.lowered);
    expect(JSON.parse(json).hooks[0].handler).toBe('h');
  });
});

// A job names a `functions` entry instead of holding a function, so the job
// lowering mints a `body` from THAT entry's callable — only when the callable is
// a body as written: `extractHookBody`'s refusals, plus a function written
// against the in-process job context (`ql` / `logger` / `bundle`, a destructured
// or renamed parameter), whose peeled body would throw on its first sandbox run.
describe('lowerCallables — job bodies from the function a job names', () => {
  const schedule = { type: 'interval', intervalMs: 60000 };
  const jobsOf = (out: { lowered: Record<string, unknown> }) => out.lowered.jobs as any[];

  it('mints a body from a self-contained function written against the sandbox ctx, keeping `handler`', () => {
    const sweep = async (ctx: any) => {
      const open = await ctx.api.object('task').find({ where: { status: 'open' } });
      ctx.log.info('open tasks', { count: open.length });
    };
    const out = lowerCallables({
      functions: { sweep },
      jobs: [{ name: 'nightly_sweep', schedule, handler: 'sweep' }],
    });
    const [job] = jobsOf(out);
    expect(job.handler).toBe('sweep');
    expect(job.body).toMatchObject({ language: 'js', capabilities: ['api.read', 'log'] });
    expect(job.body.source).toContain("ctx.api.object(");
    expect(out.bodyExtractionWarnings).toEqual([]);
    // The function itself is still registered for the runtime bundle…
    expect(out.functions.sweep).toBe(sweep);
    expect((out.lowered.functions as Record<string, string>).sweep).toBe('sweep');
  });

  it('does not count a job body in `bodyExtracted` — the function it came from still needs the bundle', () => {
    const sweep = async (ctx: any) => { ctx.log.info('tick'); };
    const out = lowerCallables({
      functions: { sweep },
      jobs: [{ name: 'tick_job', schedule, handler: 'sweep' }],
    });
    expect(jobsOf(out)[0].body).toBeDefined();
    // `os build` skips emitting the runtime module when this reaches zero; the
    // job is still scheduled through `sweep` until the runtime binds bodies.
    expect(out.count - out.bodyExtracted).toBe(1);
  });

  it('records a refusal (free identifier) as a warning and mints no body', () => {
    const sweep = async (ctx: any) => { ctx.log.info(moduleHelper('Nightly Run')); };
    const out = lowerCallables({
      functions: { sweep },
      jobs: [{ name: 'helper_job', schedule, handler: 'sweep' }],
    });
    expect(jobsOf(out)[0].body).toBeUndefined();
    expect(jobsOf(out)[0].handler).toBe('sweep');
    expect(out.bodyExtractionWarnings).toHaveLength(1);
    expect(out.bodyExtractionWarnings[0].origin).toBe("job 'helper_job'");
    expect(out.bodyExtractionWarnings[0].kind).toBe('free-identifiers');
    expect(out.bodyExtractionWarnings[0].freeIdentifiers).toEqual(['moduleHelper']);
  });

  it('refuses the documented JobHandlerContext form — a destructured argument would be unbound in the sandbox', () => {
    const sweep = async ({ jobId, ql, logger }: any) => {
      const rows = await ql.find('task', { where: {} });
      logger.info('swept', { job: jobId, count: rows.length });
    };
    const out = lowerCallables({
      functions: { sweep: { handler: sweep, effect: 'writes' } },
      jobs: [{ name: 'documented_job', schedule, handler: 'sweep' }],
    });
    expect(jobsOf(out)[0].body).toBeUndefined();
    expect(out.bodyExtractionWarnings.map((w) => [w.origin, w.kind])).toEqual([["job 'documented_job'", 'forbidden-token']]);
  });

  it('refuses a read of a member only the in-process job context has', () => {
    const sweep = async (ctx: any) => {
      const { logger } = ctx;
      await ctx.ql.find('task', {});
      logger.info(String(ctx['bundle']));
    };
    const out = lowerCallables({
      functions: [{ name: 'sweep', handler: sweep }],
      jobs: [{ name: 'host_job', schedule, handler: 'sweep' }],
    });
    expect(jobsOf(out)[0].body).toBeUndefined();
    expect(out.bodyExtractionWarnings).toHaveLength(1);
    expect(out.bodyExtractionWarnings[0].kind).toBe('forbidden-token');
    for (const member of ['ctx.bundle', 'ctx.logger', 'ctx.ql']) {
      expect(out.bodyExtractionWarnings[0].reason).toContain(member);
    }
  });

  it('refuses a parameter not named `ctx` — the sandbox binds the context under that one name', () => {
    const sweep = async (context: any) => { context.log.info('tick'); };
    const out = lowerCallables({
      functions: { sweep },
      jobs: [{ name: 'renamed_job', schedule, handler: 'sweep' }],
    });
    expect(jobsOf(out)[0].body).toBeUndefined();
    expect(out.bodyExtractionWarnings[0].kind).toBe('forbidden-token');
  });

  it('never replaces an author-written body, and mints nothing for a name that resolves to no callable', () => {
    const sweep = async (ctx: any) => { ctx.log.info('tick'); };
    const authored = { language: 'js', source: "ctx.log.info('authored');", capabilities: ['log'] };
    const out = lowerCallables({
      functions: { sweep, already: 'already' },
      jobs: [
        { name: 'authored_job', schedule, handler: 'sweep', body: authored },
        { name: 'lowered_ref_job', schedule, handler: 'already' },
        { name: 'missing_job', schedule, handler: 'nowhere' },
        { name: 'proto_job', schedule, handler: 'constructor' },
      ],
    });
    const jobs = jobsOf(out);
    expect(jobs[0].body).toBe(authored);
    expect(jobs.slice(1).map((j) => j.body)).toEqual([undefined, undefined, undefined]);
    expect(out.bodyExtractionWarnings).toEqual([]);
  });

  it('is idempotent — lowering the lowered stack again changes no job', () => {
    const sweep = async (ctx: any) => { ctx.log.info('tick'); };
    const once = lowerCallables({ functions: { sweep }, jobs: [{ name: 'tick_job', schedule, handler: 'sweep' }] });
    const twice = lowerCallables(once.lowered);
    expect(JSON.stringify(twice.lowered.jobs)).toBe(JSON.stringify(once.lowered.jobs));
  });

  it('lowers a job inside an ADR-0130 package body through the same walk', () => {
    const sweep = async (ctx: any) => { ctx.log.info('tick'); };
    const out = lowerCallables({
      packages: [{ manifest: { functions: { sweep }, jobs: [{ name: 'pkg_job', schedule, handler: 'sweep' }] } }],
    });
    const pkgJobs = ((out.lowered.packages as any[])[0].manifest.jobs) as any[];
    expect(pkgJobs[0].body).toMatchObject({ language: 'js', capabilities: ['log'] });
  });

  it('leaves a stack without jobs exactly as it lowered before — no `jobs` key appears', () => {
    const out = lowerCallables({
      hooks: [{ name: 'h', handler: (ctx: any) => { ctx.input.x = 1; }, events: ['beforeInsert'], object: 'x' }],
      functions: { f: () => 1 },
    });
    expect('jobs' in out.lowered).toBe(false);
    expect(JSON.parse(JSON.stringify(out.lowered))).toEqual({
      hooks: [{
        name: 'h',
        handler: 'h',
        events: ['beforeInsert'],
        object: 'x',
        body: { language: 'js', source: (out.lowered.hooks as any[])[0].body.source, capabilities: [] },
      }],
      functions: { f: 'f' },
    });
    expect(out.bodyExtractionWarnings).toEqual([]);
  });
});

/** Module-scope helper referenced by the #1876 bundle-fallback test. */
function moduleHelper(s: string): string {
  return String(s).toLowerCase().replace(/\s+/g, '-');
}
