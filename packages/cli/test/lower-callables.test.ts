// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  AUTHORED_BODY_BESIDE_FUNCTION_REASON,
  FUNCTIONS_ENTRY_NO_BODY_REASON,
  isExtractionRefusal,
  lowerCallables,
} from '../src/utils/lower-callables.js';

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

  it('a `functions` key equal to a hook name keeps its name and code; the hook\'s internal ref takes the suffix', () => {
    // Before: the hook kept `dup`, the authored key was re-keyed to `dup__2`
    // (which the runtime module never served), and the hook's ref resolved to
    // the `functions` entry's code at load.
    const f1 = () => 1;
    const f2 = () => 2;
    const out = lowerCallables({
      hooks: [
        { name: 'dup', handler: f1, events: ['beforeInsert'], object: 'x' },
      ],
      functions: { dup: f2 },
    });
    expect(out.count).toBe(2);
    expect(out.functions.dup).toBe(f2);
    expect(out.functions.dup__2).toBe(f1);
    expect(out.lowered.functions).toEqual({ dup: 'dup' });
    expect((out.lowered.hooks as any[])[0].handler).toBe('dup__2');
    expect((out.lowered.hooks as any[])[0].name).toBe('dup');
  });

  it('a `functions` key sharing its function with a hook keeps its name; the hook re-uses it', () => {
    // Before: the key was re-keyed to the hook's ref and the authored name was gone.
    const shared = () => 1;
    const out = lowerCallables({
      hooks: [{ name: 'tidy_hook', handler: shared, events: ['beforeInsert'], object: 'x' }],
      functions: { score: shared },
    });
    expect(out.count).toBe(1);
    expect(out.functions).toEqual({ score: shared });
    expect(out.lowered.functions).toEqual({ score: 'score' });
    expect((out.lowered.hooks as any[])[0].handler).toBe('score');
  });

  it('two `functions` keys bound to one function are two refs, each under its own name', () => {
    const shared = () => 1;
    const map = lowerCallables({ functions: { a: shared, b: { handler: shared, effect: 'writes' } } });
    expect(map.count).toBe(2);
    expect(map.lowered.functions).toEqual({ a: 'a', b: { handler: 'b', effect: 'writes' } });
    const arr = lowerCallables({ functions: [{ name: 'a', handler: shared }, { name: 'b', handler: shared }] });
    expect(arr.lowered.functions).toEqual([{ name: 'a', handler: 'a' }, { name: 'b', handler: 'b' }]);
    expect(Object.keys(arr.functions)).toEqual(['a', 'b']);
  });

  it('a `functions` key that carries no callable still owns its name: a hook named like it takes the suffix', () => {
    const fn = () => 1;
    const out = lowerCallables({
      hooks: [{ name: 'legacy', handler: fn, events: ['beforeInsert'], object: 'x' }],
      functions: { legacy: 'legacy' },
    });
    expect((out.lowered.hooks as any[])[0].handler).toBe('legacy__2');
    expect(out.lowered.functions).toEqual({ legacy: 'legacy' });
    expect(out.functions).toEqual({ legacy__2: fn });
  });

  it('[ADR-0130 D4] both walks of a contested name agree: the package body ships the refs the top level does', () => {
    const hookFn = () => 1;
    const entry = () => 2;
    const body = {
      hooks: [{ name: 'dup', handler: hookFn, events: ['beforeInsert'], object: 'x' }],
      functions: { dup: entry },
    };
    const out = lowerCallables({ ...body, packages: [{ manifest: { id: 'p.orders', ...body } }] });
    const pkg = (out.lowered.packages as any[])[0].manifest;
    expect(out.functions).toEqual({ dup__2: hookFn, dup: entry });
    expect((out.lowered.hooks as any[])[0].handler).toBe('dup__2');
    expect(pkg.hooks[0].handler).toBe('dup__2');
    expect(out.lowered.functions).toEqual({ dup: 'dup' });
    expect(pkg.functions).toEqual({ dup: 'dup' });
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
// callable. The pins below hold the list to "one row per registered callable
// the runtime module still has to carry, each once". It is also the list
// `objectstack build` decides that module from: a callable bound at a slot
// with no body (a `functions` entry, a refused extraction) stays on it even
// when another slot lowered the same function. The cases where the warnings
// miss a callable, or the old arithmetic miscounts one, also assert the old
// answer beside the new one.

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

describe('[#22839] lowerCallables — bodylessCallables, one row per callable no slot lowered', () => {
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

  it('an inline function beside an authored `body` is a row with no warning: it is bundled, never lowered', () => {
    // The old placeholder row was the only thing that counted this one too.
    // The verdict stays (the function still rides the runtime module); the
    // row now names the hook and says why.
    const out = lowerCallables({
      hooks: [{ ...cleanHook(1), body: { language: 'js', source: 'ctx.record.id = 1;' } }],
      objects: [
        { name: 'doc', actions: [{ name: 'stamp', target: cleanHook(2).handler, body: { language: 'js', source: 'return 1;' } }] },
      ],
    });
    expect(out.bodyExtractionWarnings).toEqual([]);
    expect(out.count - out.bodyExtracted).toBe(2);
    expect(out.bodylessCallables).toEqual([
      { origin: "hook 'clean_1'", reason: AUTHORED_BODY_BESIDE_FUNCTION_REASON },
      { origin: "action 'doc_stamp'", reason: AUTHORED_BODY_BESIDE_FUNCTION_REASON },
    ]);
  });

  it('single walk: the list is the old `count - bodyExtracted` population, itemized', () => {
    // One clean, one refused, one authored-body, one `functions` entry.
    const out = lowerCallables({
      hooks: [cleanHook(1), refusedHook(2), { ...cleanHook(3), body: { language: 'js', source: 'return;' } }],
      functions: { score_lead: () => 1 },
    });
    expect(out.bodylessCallables).toHaveLength(out.count - out.bodyExtracted);
    expect(out.bodylessCallables.map((r) => r.origin)).toEqual([
      "hook 'refused_2'",
      "hook 'clean_3'",
      "function 'score_lead'",
    ]);
  });

  it('a `functions` entry bound to a function some hook lowered is still a row: the hook body does not run the entry', () => {
    // One function object as a lowered hook handler AND a `functions` entry:
    // one ref, lowered once, so `count - bodyExtracted` read 0 and the
    // runtime module was skipped. The hook got a body; the entry has no body
    // slot and runs only from the module, so it is the row.
    const h = cleanHook(1);
    const out = lowerCallables({ hooks: [h], functions: { tidy: h.handler } });
    expect(out.count - out.bodyExtracted).toBe(0);
    expect((out.lowered.hooks as any[])[0].body).toBeDefined();
    expect(out.bodylessCallables).toEqual([{ origin: "function 'tidy'", reason: FUNCTIONS_ENTRY_NO_BODY_REASON }]);
  });

  it('a slot whose extraction was refused is still a row when another slot lowered the same function', () => {
    // The hook face refuses a second parameter; the action face lowers it.
    // The action got a body; the hook did not, and runs only from the module.
    const both = (a: any, b: any) => {
      a.input.title = String(b);
    };
    const out = lowerCallables({
      hooks: [{ name: 'two_params', object: 'doc', events: ['beforeInsert'], handler: both }],
      objects: [{ name: 'doc', actions: [{ name: 'stamp', target: both }] }],
    });
    expect((out.lowered.objects as any[])[0].actions[0].body).toBeDefined();
    expect((out.lowered.hooks as any[])[0].body).toBeUndefined();
    expect(out.bodylessCallables).toHaveLength(1);
    expect(out.bodylessCallables[0]).toBe(out.bodyExtractionWarnings[0]);
    expect(out.bodylessCallables[0].origin).toBe("hook 'two_params'");
  });

  it('an authored-`body` slot IS taken off the list by a lowering elsewhere: every slot then has a body', () => {
    const h = cleanHook(1);
    const out = lowerCallables({
      hooks: [{ ...h, name: 'authored', body: { language: 'js', source: 'ctx.record.id = 1;' } }, h],
    });
    expect((out.lowered.hooks as any[]).map((hook) => hook.body !== undefined)).toEqual([true, true]);
    expect(out.bodylessCallables).toEqual([]);
  });

  it('a function bound at several slots reports its strongest row: a refusal, then a `functions` entry, then an authored `body`', () => {
    const h = cleanHook(1);
    const beside = lowerCallables({
      hooks: [{ ...h, body: { language: 'js', source: 'ctx.record.id = 1;' } }],
      functions: { tidy: h.handler },
    });
    expect(beside.bodylessCallables).toEqual([{ origin: "function 'tidy'", reason: FUNCTIONS_ENTRY_NO_BODY_REASON }]);

    // A double walk reaches a package's hook AFTER the top level's `functions`.
    const r = refusedHook(1);
    const refused = lowerCallables({
      functions: { slug: r.handler },
      packages: [{ manifest: { id: 'p.orders', hooks: [r] } }],
    });
    expect(refused.bodylessCallables).toHaveLength(1);
    expect(refused.bodylessCallables[0]).toBe(refused.bodyExtractionWarnings[0]);
    expect(isExtractionRefusal(refused.bodylessCallables[0])).toBe(true);
  });

  it('one walk: a handler shared by two hooks no longer hides a `functions` entry from the count', () => {
    // One function object lowered at two slots counts as two lowered bodies
    // but one callable, so the old `count - bodyExtracted` read 0 with no
    // warning and the old gate passed. The `functions` entry beside it was
    // never lowered: it is the one row.
    const shared = cleanHook(1).handler;
    const out = lowerCallables({
      hooks: [{ ...cleanHook(1), handler: shared }, { ...cleanHook(2), handler: shared }],
      functions: { score_lead: () => 1 },
    });
    expect(out.count - out.bodyExtracted).toBe(0);
    expect(out.bodyExtractionWarnings).toEqual([]);
    expect(out.bodylessCallables).toEqual([{ origin: "function 'score_lead'", reason: FUNCTIONS_ENTRY_NO_BODY_REASON }]);
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

    it('CONTROL — a clean hook lowered in both walks, and nothing else: the list is empty', () => {
      const h = cleanHook(1);
      const out = lowerCallables({ hooks: [h], packages: [{ manifest: { id: 'p.orders', hooks: [h] } }] });
      expect(out.bodyExtracted).toBe(2);
      expect(out.bodylessCallables).toEqual([]);
    });
  });

  it('the list is non-empty wherever the old runtime-module test was true: the decision only moves from skip to write', () => {
    // `objectstack build` writes the module iff this list is non-empty. It
    // used to write it iff `count - bodyExtracted > 0` or a warning was
    // recorded. Every shape the old test wrote a module for still gets one.
    const r = refusedHook(1);
    const h = cleanHook(2);
    const shapes: Record<string, unknown>[] = [
      { hooks: [cleanHook(1)] },
      { hooks: [r] },
      { hooks: [r], packages: [{ manifest: { id: 'p', hooks: [r] } }] },
      { hooks: [{ ...h, body: { language: 'js', source: 'return;' } }] },
      { hooks: [{ ...h, body: { language: 'js', source: 'return;' } }, h] },
      { hooks: [h], functions: { tidy: h.handler } },
      { functions: { score_lead: () => 1 } },
      { objects: [{ name: 'doc', actions: [{ name: 'stamp', target: r.handler }] }] },
    ];
    for (const shape of shapes) {
      const out = lowerCallables(shape);
      const oldWrote = out.count - out.bodyExtracted > 0 || out.bodyExtractionWarnings.length > 0;
      if (oldWrote) expect(out.bodylessCallables.length, JSON.stringify(Object.keys(shape))).toBeGreaterThan(0);
      // Every refusal is a row of the list, so the warnings add nothing to the decision.
      if (out.bodyExtractionWarnings.length > 0) expect(out.bodylessCallables.some(isExtractionRefusal)).toBe(true);
    }
  });
});

/** Module-scope helper referenced by the #1876 bundle-fallback test. */
function moduleHelper(s: string): string {
  return String(s).toLowerCase().replace(/\s+/g, '-');
}
