// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FUNCTIONS_ENTRY_NO_BODY_REASON, lowerCallables } from '../src/utils/lower-callables.js';

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

// ─── [#22839] bodylessCallables — the population `--strict-body` counts ───
//
// `objectstack build --strict-body` prints `issues.length` as "N callable(s)
// lack a metadata body" and publishes `issues` under `--json`, with `issues`
// built from this list. It used to be the extraction warnings plus one
// placeholder row whenever `count - bodyExtracted > 0`, so one refused handler
// printed 2 and four printed 5, and `--json` carried a row that named no
// callable. The pins below hold the list to "one row per callable that ships
// with no body, each once". Each divergence case also asserts the old
// arithmetic's answer beside it, so it shows the two disagree on that input.

/** A handler the extractor refuses: it names a module-scope identifier. */
const refusedHook = (i: number) => ({
  name: `refused_${i}`,
  object: 'doc',
  events: ['beforeInsert'],
  handler: (ctx: any) => {
    ctx.record.slug = moduleHelper(ctx.record.name);
  },
});

/** A handler the extractor lowers: parameters and globals only. */
const cleanHook = (i: number) => ({
  name: `clean_${i}`,
  object: 'doc',
  events: ['beforeInsert'],
  handler: (ctx: any) => {
    ctx.record.id = Math.round(Number(ctx.record.raw));
  },
});

describe('[#22839] lowerCallables — bodylessCallables, one row per callable with no body', () => {
  it('CONTROL — every callable lowered: the list is empty', () => {
    const out = lowerCallables({ hooks: [cleanHook(1), cleanHook(2)] });
    expect(out.bodyExtracted).toBe(2);
    expect(out.bodylessCallables).toEqual([]);
  });

  it('one refused handler → one row, the refusal itself (no placeholder row)', () => {
    const out = lowerCallables({ hooks: [refusedHook(1)] });
    expect(out.bodylessCallables).toHaveLength(1);
    expect(out.bodylessCallables[0]).toBe(out.bodyExtractionWarnings[0]);
    expect(out.bodylessCallables[0].origin).toBe("hook 'refused_1'");
  });

  it('four refused handlers → four rows, one per hook, in walk order', () => {
    const out = lowerCallables({ hooks: [1, 2, 3, 4].map(refusedHook) });
    expect(out.bodylessCallables.map((r) => r.origin)).toEqual([
      "hook 'refused_1'",
      "hook 'refused_2'",
      "hook 'refused_3'",
      "hook 'refused_4'",
    ]);
  });

  it('a refused action is a row too, under its action origin', () => {
    const out = lowerCallables({
      objects: [{ name: 'doc', actions: [{ name: 'stamp', target: refusedHook(1).handler }] }],
    });
    expect(out.bodylessCallables.map((r) => r.origin)).toEqual(["action 'doc_stamp'"]);
  });

  it('a `functions` entry is a row although it leaves NO extraction warning', () => {
    // It has no `body` slot, so it is never extracted. `count - bodyExtracted`
    // saw it (the old placeholder row's only job); the warnings never did.
    const out = lowerCallables({
      functions: { score_lead: () => 1, stamp_writes: { handler: () => 2, effect: 'writes' } },
      hooks: [refusedHook(1)],
    });
    expect(out.bodyExtractionWarnings).toHaveLength(1);
    expect(out.count - out.bodyExtracted).toBe(3);
    expect(out.bodylessCallables).toEqual([
      expect.objectContaining({ origin: "hook 'refused_1'" }),
      { origin: "function 'score_lead'", reason: FUNCTIONS_ENTRY_NO_BODY_REASON },
      { origin: "function 'stamp_writes'", reason: FUNCTIONS_ENTRY_NO_BODY_REASON },
    ]);

    const arr = lowerCallables({ functions: [{ name: 'arr_fn', handler: () => 3 }] });
    expect(arr.bodylessCallables).toEqual([{ origin: "function 'arr_fn'", reason: FUNCTIONS_ENTRY_NO_BODY_REASON }]);
  });

  it('a hook whose author wrote its `body` is NOT a row, though `count - bodyExtracted` counts it', () => {
    const out = lowerCallables({
      hooks: [{ ...cleanHook(1), body: { language: 'js', source: 'ctx.record.id = 1;' } }],
    });
    expect(out.count - out.bodyExtracted).toBe(1);
    expect(out.bodylessCallables).toEqual([]);
  });

  describe('ADR-0130 D4 — a package callable is walked twice and still counted once', () => {
    it('one refused hook shared by the top level and a package body → one row, not two', () => {
      const h = refusedHook(1);
      const out = lowerCallables({ hooks: [h], packages: [{ manifest: { id: 'p.orders', hooks: [h] } }] });
      expect(out.bodyExtractionWarnings).toHaveLength(2);
      expect(out.bodylessCallables.map((r) => r.origin)).toEqual(["hook 'refused_1'"]);
    });

    it('a shared `functions` entry is still a row when a shared hook is lowered in both walks', () => {
      // The double-counted success hides the entry from `count - bodyExtracted`
      // (2 - 2 = 0); the old gate passed this artifact.
      const h = cleanHook(1);
      const fn = () => 3;
      const out = lowerCallables({
        hooks: [h],
        functions: { score_lead: fn },
        packages: [{ manifest: { id: 'p.orders', hooks: [h], functions: { score_lead: fn } } }],
      });
      expect(out.count - out.bodyExtracted).toBe(0);
      expect(out.bodylessCallables).toEqual([{ origin: "function 'score_lead'", reason: FUNCTIONS_ENTRY_NO_BODY_REASON }]);
    });
  });
});

/** Module-scope helper referenced by the #1876 bundle-fallback test. */
function moduleHelper(s: string): string {
  return String(s).toLowerCase().replace(/\s+/g, '-');
}
