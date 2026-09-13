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

/** Module-scope helper referenced by the #1876 bundle-fallback test. */
function moduleHelper(s: string): string {
  return String(s).toLowerCase().replace(/\s+/g, '-');
}
