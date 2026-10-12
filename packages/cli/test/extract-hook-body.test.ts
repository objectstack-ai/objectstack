// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { extractHookBody, extractLoweredBody, HookBodyExtractionError } from '../src/utils/extract-hook-body.js';
import { lowerCallables } from '../src/utils/lower-callables.js';

describe('extractHookBody', () => {
  it('extracts a block-body arrow', () => {
    const fn = (ctx: any) => {
      ctx.input.x = 1;
      return ctx.input;
    };
    const ext = extractHookBody(fn, 'hook test');
    expect(ext.source).toContain('ctx.input.x = 1');
    expect(ext.source).toContain('return ctx.input');
    expect(ext.isExpression).toBe(false);
  });

  it('extracts an expression-body arrow as `return (...)`', () => {
    const fn: any = (ctx: any) => ctx.input.x + 1;
    const ext = extractHookBody(fn, 'hook test');
    expect(ext.isExpression).toBe(true);
    expect(ext.source).toMatch(/return \(.*ctx\.input\.x \+ 1.*\);/);
  });

  it('extracts a function expression body', () => {
    const fn = function (ctx: any) {
      ctx.input.y = 2;
    };
    const ext = extractHookBody(fn, 'hook fnexpr');
    expect(ext.source).toContain('ctx.input.y = 2');
  });

  it('infers api.read capability', () => {
    const fn = async (ctx: any) => {
      const n = await ctx.api.object('foo').count({});
      return n;
    };
    const ext = extractHookBody(fn, 'hook a');
    expect(ext.capabilities).toContain('api.read');
  });

  it('infers api.read on aliased ctx.api', () => {
    const fn = async (ctx: any) => {
      const api = ctx.api;
      return await api.object('foo').count({});
    };
    const ext = extractHookBody(fn, 'hook b');
    expect(ext.capabilities).toContain('api.read');
  });

  it('infers api.write', () => {
    const fn = async (ctx: any) => {
      await ctx.api.object('foo').update('id', {});
    };
    expect(extractHookBody(fn, 'hook c').capabilities).toContain('api.write');
  });

  it('infers log', () => {
    const fn = (ctx: any) => {
      ctx.log.info('hi');
    };
    expect(extractHookBody(fn, 'hook d').capabilities).toContain('log');
  });

  it('rejects fetch()', () => {
    const fn = async (_ctx: any) => {
      await fetch('https://example.com');
    };
    expect(() => extractHookBody(fn, 'hook bad')).toThrow(/fetch/);
  });

  // #10678 — BOTH spellings, one reason. A TS config never reaches the
  // extractor spelling `require(`: `loadConfig` runs it through bundle-require
  // -> esbuild, whose ESM interop shim rewrites it to `__require("node:os")`
  // first. Matching only the source spelling left the promised require()-reason
  // unreachable from the real authoring path — the refusal still fired, but as
  // the generic #1876 free-identifier message naming an identifier the author
  // never typed. These two cases are written with the call built at runtime so
  // the test file itself is not rewritten by its own bundler.
  it('rejects require() — the spelling the author writes', () => {
    const fn = new Function('ctx', "const os = require('node:os'); return os;") as (...a: unknown[]) => unknown;
    expect(() => extractHookBody(fn, 'hook bad')).toThrow(/`require\(\)` is not allowed/);
  });

  it('rejects __require() — the spelling esbuild leaves behind (#10678)', () => {
    const fn = new Function('ctx', 'const os = __require("node:os"); return os;') as (...a: unknown[]) => unknown;
    // The require()-specific reason, NOT the free-identifier fallback. If this
    // ever reads "not in scope at runtime" again, the reason went unreachable.
    expect(() => extractHookBody(fn, 'hook bad')).toThrow(/`require\(\)` is not allowed/);
    expect(() => extractHookBody(fn, 'hook bad')).not.toThrow(/not in scope at runtime/);
  });

  it('does NOT widen to an identifier merely ending in `require` (#10678)', () => {
    // `\b(?:__)?require\s*\(` has no word boundary inside `myrequire`, so the
    // pattern cannot swallow an author's own helper. Guards the widening.
    const fn = new Function('ctx', 'return ctx.myrequire ? 1 : 0;') as (...a: unknown[]) => unknown;
    expect(() => extractHookBody(fn, 'hook ok')).not.toThrow();
  });

  it('rejects process access', () => {
    const fn = (_ctx: any) => {
      const env = (process as any).env.X;
      return env;
    };
    expect(() => extractHookBody(fn, 'hook bad')).toThrow(/process/);
  });

  it('rejects eval', () => {
    const fn = (_ctx: any) => {
      // eslint-disable-next-line no-eval
      eval('1');
    };
    expect(() => extractHookBody(fn, 'hook bad')).toThrow(/eval/);
  });

  // ── the `@capabilities` directive, RETIRED (commit 7940de5e0) ───────────
  //
  // Ruled under ADR-0049 enforce-or-remove: the comment-borne override was read
  // off `String(fn)`, and every ordinary authoring path (`.ts`, `.js`, `.mjs`,
  // an imported handler) runs through esbuild, which strips `//` comments before
  // the handler is ever a runtime function. It therefore did nothing, silently,
  // for every author — while THIS file's raw JS literals kept their comments and
  // made it read as working. Two tests pinning that override were deleted with
  // the branch; this one replaces them.
  //
  // ⚠️ NON-VACUITY, both halves asserted below, because "the directive has no
  // effect" is exactly the claim that also passes when nothing was measured:
  //   1. the comment SURVIVED into the extracted source — so this test really is
  //      standing on the one shape where the override used to fire. If a future
  //      transform starts stripping comments here, this fails loudly instead of
  //      passing for the wrong reason.
  //   2. inference still ran on the same body and produced `api.read` — so an
  //      empty/narrow capability list is a decision about the directive, not a
  //      body that never reached the extractor.
  it('ignores the retired `@capabilities` directive even when the comment survives into String(fn) (#10917)', () => {
    const fn = (ctx: any) => {
      // @capabilities api.write crypto.uuid log
      return ctx.api.object('x').find({});
    };
    const ext = extractHookBody(fn, 'hook retired-directive');

    // (1) the directive is genuinely present in what the extractor read.
    expect(ext.source).toContain('@capabilities');

    // (2) inference ran and won on its own; the directive contributed nothing.
    expect(ext.capabilities).toEqual(['api.read']);
    expect(ext.capabilities).not.toContain('api.write');
    expect(ext.capabilities).not.toContain('crypto.uuid');
    expect(ext.capabilities).not.toContain('log');
  });

  // ── `crypto.hash` inference retired (#4391) ──────────────────────────────
  //
  // This inference was the amplifier that kept the missing implementation
  // alive: writing `ctx.crypto.hash(...)` made the extractor GRANT the
  // capability, so `os build` went green on a body guaranteed to throw at the
  // first record write. The token left `HookBodyCapability` in spec 17, so
  // re-adding the pattern would now emit a body the spec itself rejects.

  it('does NOT infer a capability from ctx.crypto.hash (#4391)', () => {
    const fn = async (ctx: any) => {
      ctx.input.fingerprint = await ctx.crypto.hash('sha256', ctx.input.email);
    };
    const ext = extractHookBody(fn, 'hook hash');
    expect(ext.capabilities).toEqual([]);
    expect(ext.capabilities).not.toContain('crypto.hash');
    // The source still travels verbatim — the extractor's job is not to rewrite
    // the body, and the dead call is the author's to delete (the spec parse
    // error on the declared token is what tells them so).
    expect(ext.source).toContain('ctx.crypto.hash');
  });

  // The #4391 sibling that pinned `crypto.hash` being filtered OUT of an
  // explicit `@capabilities` override went with the directive (commit 7940de5e0): with no
  // override branch there is no token list to filter, so the guarantee is now
  // structural rather than a case. The inference half of #4391 is still pinned
  // by the test above, which is the route `crypto.hash` could still arrive on.

  it('still infers crypto.uuid — the sibling that IS implemented (#4391)', () => {
    const fn = (ctx: any) => {
      ctx.input.trace = ctx.crypto.randomUUID();
    };
    expect(extractHookBody(fn, 'hook uuid').capabilities).toContain('crypto.uuid');
  });

  // #1876 — a handler that references a module-scope helper is not self-
  // contained; extraction must throw so lowerCallables falls back to bundling
  // (which carries the closure) instead of shipping a body that ReferenceErrors.
  it('rejects a handler that references a module-scope helper (#1876)', () => {
    const fn = (ctx: any) => {
      ctx.record.slug = moduleScopeHelper(ctx.record.name);
    };
    expect(() => extractHookBody(fn, 'hook free')).toThrow(/not in scope at runtime|moduleScopeHelper/);
  });

  // ── #14301 — a global the NODE HOST has and the sandbox does not ────────
  //
  // The reported shape. `Intl` was allowlisted beside `JSON`, so this handler
  // had no free identifier at all: it lowered, `validate`/`typecheck`/`test`/
  // `build` were all green (the in-process test runs the RAW function in Node),
  // and the body threw `ReferenceError: Intl is not defined` in production —
  // under a hook's default `onError: 'abort'`, refusing every write to the
  // object. Refusing here routes it through the SAME path as #1876: the
  // callable is still bundled and still runs in-process, only the unrunnable
  // body is declined.
  it('refuses a handler referencing Intl, with the reason named (#14301)', () => {
    const fn = (ctx: any) => {
      const f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' });
      ctx.input.due_label = f.format(new Date(ctx.input.due_at));
    };
    let err: any;
    try {
      extractHookBody(fn as any, "hook 'stamp_due_label'");
    } catch (e) {
      err = e;
    }
    expect(err, 'the handler must be REFUSED, not lowered').toBeDefined();
    expect(err.kind).toBe('free-identifiers');
    expect(err.freeIdentifiers).toEqual(['Intl']);
    // The classification the refusing rule already had, carried beside the
    // prose rather than buried in it — `os lint` reads this, not the sentence.
    expect(err.nodeOnlyIdentifiers).toEqual(['Intl']);
    // The reason NAMES the identifier and the remedy, and the remedy is not
    // the module-scope one: there is nothing to inline `Intl` from.
    expect(err.message).toContain('Intl');
    expect(err.message).toContain('not available in the hook sandbox');
    expect(err.message).toContain('string handler ref');
    expect(err.message).toContain('validation rule');
    expect(err.message).not.toContain('Module-scope helpers/imports');
  });

  // The reverse leg: the sibling globals the sandbox DOES provide must still
  // lower, or the fix would have traded a silent production failure for a
  // repo-wide fallback to bundling.
  it('still extracts a handler using sandbox-provided globals only (#14301)', () => {
    const fn = (ctx: any) => {
      ctx.input.at = new Date(ctx.input.raw).toISOString();
      ctx.input.tags = JSON.stringify(ctx.input.list ?? []);
      ctx.input.n = Math.round(Number(ctx.input.n));
    };
    const ext = extractHookBody(fn as any, 'hook plain globals');
    expect(ext.source).toContain('toISOString');
  });

  // ⛔ The module-scope sentence is quoted verbatim by
  // `content/docs/automation/hook-bodies.mdx`, by `os build`'s warn-and-bundle
  // line and by `--strict-body`'s per-callable diagnostic. #14301 added a
  // second branch beside it; this pin is what keeps the branch from rewriting
  // the original.
  it('leaves the module-scope refusal sentence byte-identical (#14301)', () => {
    const fn = (ctx: any) => {
      ctx.record.slug = moduleScopeHelper(ctx.record.name);
    };
    let err: any;
    try {
      extractHookBody(fn as any, 'hook free');
    } catch (e) {
      err = e;
    }
    expect(err.nodeOnlyIdentifiers).toEqual([]);
    expect(err.message).toBe(
      "[hook-body-extract] hook free: handler references identifier(s) not in scope at runtime: " +
        "moduleScopeHelper. Module-scope helpers/imports aren't shipped with a metadata-only body, " +
        "so this handler will be BUNDLED instead (no behavior change). To make it body-only, inline " +
        "the helper(s) into the handler or move the logic behind `ctx` (e.g. `ctx.api`).",
    );
  });

  it('names both halves when a handler has each kind of free name (#14301)', () => {
    const fn = (ctx: any) => {
      ctx.record.slug = moduleScopeHelper(ctx.record.name);
      ctx.record.fmt = Intl.NumberFormat;
    };
    let err: any;
    try {
      extractHookBody(fn as any, 'hook mixed');
    } catch (e) {
      err = e;
    }
    expect(err.freeIdentifiers).toEqual(['Intl', 'moduleScopeHelper']);
    expect(err.nodeOnlyIdentifiers).toEqual(['Intl']);
    // Each half gets ITS remedy; neither is printed for the other.
    expect(err.message).toContain('not available in the hook sandbox');
    expect(err.message).toContain('module-scope helpers/imports');
    expect(err.message).toContain('moduleScopeHelper');
  });

  // ── `sudo()` is not a body-reachable member (#14010) ────────────────────
  //
  // `ScopedContext.sudo()` is REAL in-process and absent from the VM's
  // `ctx.api`, so the same handler source passes a native `hook.handler(ctx)`
  // test and TypeErrors once the build lowers it into a body. Refusing the
  // extraction is what keeps the two runtimes honest: `lowerCallables` catches
  // this throw and ships the callable through the .mjs bundle, so the handler
  // keeps working in-process — only the unrunnable body is declined.
  it('rejects a handler calling ctx.api.sudo() (#14010)', () => {
    const fn = async (ctx: any) => {
      await ctx.api.sudo().object('crm_account').update({ id: ctx.input.id, current_grade: 'A' });
    };
    expect(() => extractHookBody(fn, 'hook elevate')).toThrow(/`sudo\(\)` is not reachable/);
  });

  it('rejects the aliased receiver too — `const api = ctx.api; api.sudo()` (#14010)', () => {
    // Receiver-loose on purpose: under-refusing here is the failure that only
    // production sees, which is the whole defect.
    const fn = async (ctx: any) => {
      const api = ctx.api;
      await api.sudo().object('crm_account').update({ id: ctx.input.id, x: 1 });
    };
    expect(() => extractHookBody(fn, 'hook elevate alias')).toThrow(/`sudo\(\)` is not reachable/);
  });

  // The reverse leg: without the pattern this body extracts CLEANLY and the
  // build emits a `body.source` that TypeErrors in the sandbox. Asserting the
  // ordinary shape still passes is what proves the pattern did not widen into
  // the majority case it sits beside.
  it('still extracts an ordinary non-elevated ctx.api write (#14010)', () => {
    const fn = async (ctx: any) => {
      await ctx.api.object('crm_account').update({ id: ctx.input.id, current_grade: 'A' });
    };
    const ext = extractHookBody(fn, 'hook plain');
    expect(ext.capabilities).toContain('api.write');
    // Quote-agnostic: this file is itself bundled, and esbuild rewrites the
    // literal's quotes before `String(fn)` ever runs.
    expect(ext.source).toMatch(/object\((['"])crm_account\1\)/);
  });

  it('extracts a self-contained handler that only uses params + globals (#1876)', () => {
    const fn = (ctx: any) => {
      ctx.record.id = Math.round(Number(ctx.record.raw));
      ctx.record.tags = JSON.stringify(ctx.record.list ?? []);
    };
    const ext = extractHookBody(fn, 'hook contained');
    expect(ext.source).toContain('Math.round');
  });

  // ── `create()` is not a body-reachable member (#16249) ───────────────────
  //
  // Same family as `sudo()` above, one layer over. The host `ObjectRepository`
  // aliases `create(data)` to `insert(data)` and the spec contract
  // `IScopedObjectRepository` declares `insert` only, while the VM installs
  // `insert / update / delete / updateMany / deleteMany / upsert` and no
  // `create` leaf — so a lowered body's `.create()` TypeErrors on its first
  // run and, under a hook's default `onError: 'abort'`, aborts the triggering
  // write. What made it worse than an omission: the extractor ledger in
  // `@objectstack/lint` ADVERTISED `.create({…})` as legal syntax, so the one
  // layer that actively told an author how to write it named a spelling that
  // cannot run. That entry is withdrawn in the same change; these cases pin the
  // build-time half.
  it('rejects a handler calling ctx.api.object(x).create() (#16249)', () => {
    const fn = async (ctx: any) => {
      await ctx.api.object('crm_account').create({ name: ctx.input.name });
    };
    expect(() => extractHookBody(fn, 'hook seed')).toThrow(/`create\(\)` is not reachable/);
  });

  // The reason has to name the spelling the sandbox HAS — a refusal that only
  // says "no" leaves the author where the blind `TypeError` left them.
  it('names `.insert()` as the remedy, and the leaves the VM installs (#16249)', () => {
    const fn = async (ctx: any) => {
      await ctx.api.object('crm_account').create({ name: ctx.input.name });
    };
    let message = '';
    try {
      extractHookBody(fn, 'hook seed');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/`\.insert\(\{ \.\.\. \}\)`/);
    expect(message).toMatch(/`insert` \/ `update` \/ `delete` \/ `updateMany` \/ `deleteMany` \/ `upsert`/);
    expect(message).toMatch(/no `create` leaf/);
    // The carve-out is stated in the refusal itself, so an author who hits it
    // over an `Object.create()` false positive is told it is not the subject.
    expect(message).toMatch(/`Object\.create\(\)` is unaffected/);
  });

  it('rejects the aliased receiver too — `const repo = ctx.api.object(x); repo.create()` (#16249)', () => {
    // Receiver-loose, decided by `.sudo(` and not re-decided here: under-refusing
    // is the failure only production sees.
    const fn = async (ctx: any) => {
      const repo = ctx.api.object('crm_account');
      await repo.create({ name: ctx.input.name });
    };
    expect(() => extractHookBody(fn, 'hook seed alias')).toThrow(/`create\(\)` is not reachable/);
  });

  // ⭐ The carve-out, and the ONE thing `.sudo(` needed no equivalent of:
  // `Object` is a real sandbox global (pinned in `SANDBOX_GLOBALS`), so
  // `Object.create(null)` is working, lowerable code. A bare receiver-loose
  // rule would refuse it — turning a correct body into a bundled closure, and a
  // hard failure under `--strict-body`. That is a false refusal, not the safe
  // direction, so the lookbehind excludes that ONE receiver.
  it('does NOT refuse `Object.create(null)` — a real sandbox global (#16249)', () => {
    const fn = (ctx: any) => {
      const seen = Object.create(null);
      seen[ctx.input.email] = true;
      ctx.input.dedupe_key = Object.keys(seen).join(',');
    };
    const ext = extractHookBody(fn, 'hook dedupe');
    expect(ext.source).toContain('Object.create(null)');
  });

  // The reverse leg, as `.sudo(` has: the majority case must still lower.
  it('still extracts an ordinary ctx.api insert (#16249)', () => {
    const fn = async (ctx: any) => {
      await ctx.api.object('audit_log').insert({ event: ctx.input.event });
    };
    const ext = extractHookBody(fn, 'hook audit');
    expect(ext.capabilities).toContain('api.write');
    expect(ext.source).toMatch(/object\((['"])audit_log\1\)\.insert/);
  });
});

// ── `ctx.dispatch.scope` and `ctx.submitted` are not body members (#22810) ──
//
// Same family as `sudo()` / `create()`, on the context itself: the spec
// declares the body face WITHOUT them (`HookContextSchema.dispatch` carries
// `{ mode, index }` "and not `scope`"; `submitted` is "NOT marshalled into the
// sandboxed `body` face"), so a lowered body TypeErrors on a `scope` write and
// reads `undefined` for `submitted` — while the in-process handler works. These
// pin the build-time half: the kind, the origin and the named member, never the
// remedy prose.
describe('extractHookBody refuses the context members the body face does not carry (#22810)', () => {
  const refusal = (fn: (...a: any[]) => unknown, label: string): HookBodyExtractionError => {
    try {
      extractHookBody(fn as (...a: unknown[]) => unknown, label);
    } catch (err) {
      if (err instanceof HookBodyExtractionError) return err;
      throw err;
    }
    throw new Error(`expected ${label} to be refused, but it lowered`);
  };

  it('refuses a body writing `ctx.dispatch.scope`', () => {
    const err = refusal(async (ctx: any) => {
      ctx.dispatch.scope.stashed = ctx.input.name;
    }, "hook 'stash'");
    expect(err.kind).toBe('forbidden-token');
    expect(err.originLabel).toBe("hook 'stash'");
    expect(err.message).toContain('`ctx.dispatch.scope`');
  });

  it('refuses the aliased marker too — `const d = ctx.dispatch; d.scope`', () => {
    const err = refusal(async (ctx: any) => {
      const d = ctx.dispatch;
      d.scope.stashed = ctx.input.name;
    }, "hook 'stash alias'");
    expect(err.kind).toBe('forbidden-token');
    expect(err.message).toContain('`ctx.dispatch.scope`');
  });

  it('refuses a body reading `ctx.submitted`', () => {
    const err = refusal(async (ctx: any) => {
      if (ctx.submitted?.name) ctx.input.note = 'renamed';
    }, "hook 'guard'");
    expect(err.kind).toBe('forbidden-token');
    expect(err.originLabel).toBe("hook 'guard'");
    expect(err.message).toContain('`ctx.submitted`');
  });

  it('refuses `submitted` destructured off the context', () => {
    const err = refusal(async (ctx: any) => {
      const { input, submitted } = ctx;
      input.note = String(submitted);
    }, "hook 'guard destructured'");
    expect(err.kind).toBe('forbidden-token');
    expect(err.message).toContain('`ctx.submitted`');
  });

  // CONTROL: the two members the body face DOES carry still lower — the
  // pattern is about `scope`, not about naming `dispatch`.
  it('still lowers `ctx.dispatch.mode` and `ctx.dispatch.index`', () => {
    const ext = extractHookBody(async (ctx: any) => {
      if (ctx.dispatch?.mode === 'per-row' && ctx.dispatch.index === 0) ctx.input.note = 'first';
    }, "hook 'batch_once'");
    expect(ext.source).toContain('dispatch?.mode');
    expect(ext.source).toContain('dispatch.index');
  });

  // CONTROL: `scope` and `submitted` are also ordinary FIELD names (platform
  // objects declare `scope`). A field read through a record image the body
  // does receive is working code, and stays lowerable even beside `dispatch`.
  it('still lowers a field named `scope` or `submitted` read through ctx.input / ctx.previous', () => {
    const ext = extractHookBody(async (ctx: any) => {
      if (ctx.dispatch?.mode === 'record') {
        ctx.input.note = String(ctx.input.scope ?? ctx.previous?.scope) + String(ctx.previous?.submitted);
      }
    }, "hook 'fields'");
    expect(ext.source).toContain('input.scope');
    expect(ext.source).toContain('previous?.submitted');
  });
});

// CONTROL: the same handler in-process is unchanged. A refusal costs the BUILD
// the body, never the handler: `lowerCallables` records the refusal, registers
// the very function for the `.mjs` bundle, and emits a handler ref, so the
// handler still runs where `dispatch.scope` is real.
describe('lowerCallables keeps a refused `scope` handler as the in-process callable (#22810)', () => {
  it('records the refusal, emits no body, and bundles the original function', () => {
    const handler = async (ctx: any) => {
      ctx.dispatch.scope.stashed = ctx.input.name;
      ctx.input.note = 'stashed';
    };
    const lowering = lowerCallables({
      hooks: [{ name: 'stash', object: 'note', events: ['beforeInsert'], handler }],
    });
    const hook = (lowering.lowered.hooks as Array<Record<string, unknown>>)[0];
    expect(hook.body).toBeUndefined();
    expect(hook.handler).toBe('stash');
    expect(lowering.functions.stash).toBe(handler);
    expect(lowering.bodyExtractionWarnings.map((w) => [w.origin, w.kind])).toEqual([
      ["hook 'stash'", 'forbidden-token'],
    ]);
  });

  it('and that callable still stashes on a host-shaped context', async () => {
    const handler = async (ctx: any) => {
      ctx.dispatch.scope.stashed = ctx.input.name;
      ctx.input.note = 'stashed';
    };
    const lowering = lowerCallables({
      hooks: [{ name: 'stash', object: 'note', events: ['beforeInsert'], handler }],
    });
    const ctx = { input: { name: 'alpha' } as Record<string, unknown>, dispatch: { mode: 'record', index: 0, scope: {} as Record<string, unknown> } };
    await lowering.functions.stash(ctx);
    expect(ctx.dispatch.scope.stashed).toBe('alpha');
    expect(ctx.input.note).toBe('stashed');
  });
});

// ── #22860: the body is read off the handler's parse, not by counting braces ──
//
// The peel used to find the body by counting `{`/`}` and `(`/`)` through the
// text, blind to strings, templates, regexes and comments, and took the first
// parenthesised `=>` anywhere as the handler's header. Each handler below lowered
// at build exit 0 to a body that is not its own: a SyntaxError on the body's
// first run, or (the pattern parameter, the block-bodied inner arrow, the
// comment) a body that runs and does none of the handler's work. Each pin runs
// the handler in-process and its lowered body the way the runtime's L2 wrapper
// does — `(async (ctx) => { SOURCE })(ctx)` — and asserts the two agree on a
// concrete value, so "both did nothing" cannot pass. The artifact door for the
// same shapes is `packages/qa/dogfood/test/lowered-body-door.dogfood.test.ts`.
describe("the lowered body is read off the handler's parse, not by counting braces (#22860)", () => {
  type Handler = (...a: any[]) => unknown;
  const runLowered = async (source: string, ctx: unknown): Promise<unknown> =>
    (new Function(`return (async (ctx) => { ${source} });`)() as (c: unknown) => Promise<unknown>)(ctx);
  const fresh = () => ({ input: { name: 'alpha' } as Record<string, unknown> });
  const bothWays = async (handler: Handler) => {
    const ext = extractHookBody(handler as (...a: unknown[]) => unknown, "hook 'h'");
    const inProcess = fresh();
    await handler(inProcess);
    const lowered = fresh();
    await runLowered(ext.source, lowered);
    return { ext, inProcess: inProcess.input, lowered: lowered.input };
  };

  it('a `}` inside a string: the lowered body runs, as the handler does', async () => {
    const r = await bothWays(async (ctx: any) => {
      ctx.input.note = 'a}b';
    });
    expect(r.ext.isExpression).toBe(false);
    expect(r.lowered.note).toBe('a}b');
    expect(r.lowered).toEqual(r.inProcess);
  });

  it('a template literal with `${…}`, and one whose text carries a `}`: both run', async () => {
    const balanced = await bothWays(async (ctx: any) => {
      ctx.input.note = `t:${String(ctx.input.name)}!`;
    });
    expect(balanced.lowered.note).toBe('t:alpha!');
    expect(balanced.lowered).toEqual(balanced.inProcess);

    const brace = await bothWays(async (ctx: any) => {
      ctx.input.note = `}${String(ctx.input.name)}`;
    });
    expect(brace.lowered.note).toBe('}alpha');
    expect(brace.lowered).toEqual(brace.inProcess);
  });

  it('a `}` inside a regex literal, and inside a comment: both run', async () => {
    const regex = await bothWays(async (ctx: any) => {
      ctx.input.note = String(ctx.input.name).replace(/}/g, '') + '!';
    });
    expect(regex.lowered.note).toBe('alpha!');
    expect(regex.lowered).toEqual(regex.inProcess);

    // A comment survives into `String(fn)` only where nothing transformed the
    // handler, so this one is built at run time (esbuild strips the comment out
    // of a literal in this file).
    const commented = await bothWays(
      new Function('ctx', "// a } in a comment\nctx.input.note = 'c:' + ctx.input.name;") as Handler,
    );
    expect(commented.lowered.note).toBe('c:alpha');
    expect(commented.lowered).toEqual(commented.inProcess);
  });

  it("a statement-level inner arrow: the body is the handler's block, not the arrow's", async () => {
    const expression = await bothWays(async function (ctx: any) {
      const exclaim = (a: string) => a + '!';
      ctx.input.note = exclaim(String(ctx.input.name));
    });
    expect(expression.ext.isExpression).toBe(false);
    expect(expression.ext.source).toContain('const exclaim =');
    expect(expression.lowered.note).toBe('alpha!');
    expect(expression.lowered).toEqual(expression.inProcess);

    // Block-bodied, the old reading shipped the INNER arrow's statements — a
    // body that compiled, ran, and wrote nothing.
    const block = await bothWays(async function (ctx: any) {
      const exclaim = (a: string) => {
        return a + '!';
      };
      ctx.input.note = exclaim(String(ctx.input.name));
    });
    expect(block.ext.source).toContain('ctx.input.note = exclaim(');
    expect(block.lowered.note).toBe('alpha!');
    expect(block.lowered).toEqual(block.inProcess);

    const method = await bothWays(
      {
        async handler(ctx: any) {
          const ask = (a: string) => a + '?';
          ctx.input.note = ask(String(ctx.input.name));
        },
      }.handler,
    );
    expect(method.lowered.note).toBe('alpha?');
    expect(method.lowered).toEqual(method.inProcess);
  });

  it('a `function` handler whose parameter is a pattern: the body is its block, not the pattern', async () => {
    const r = await bothWays(async function ({ input }: any) {
      input.note = 'fn:' + String(input.name);
    });
    expect(r.ext.source.startsWith('var { input } = ctx;')).toBe(true);
    expect(r.ext.source).toContain('input.note =');
    expect(r.lowered.note).toBe('fn:alpha');
    expect(r.lowered).toEqual(r.inProcess);
  });

  // The old scan's "safe case": an unbalanced `{` left it with no body at all,
  // so the handler was refused as `unparseable` and bundled. It now lowers.
  it('a `{` inside a string, formerly refused as unparseable and bundled, now lowers and runs', async () => {
    const handler = async (ctx: any) => {
      ctx.input.note = 'a{b';
    };
    const lowering = lowerCallables({
      hooks: [{ name: 'open_brace', object: 'note', events: ['beforeInsert'], handler }],
    });
    expect(lowering.bodyExtractionWarnings).toEqual([]);
    expect((lowering.lowered.hooks as Array<Record<string, unknown>>)[0].body).toEqual(
      expect.objectContaining({ source: expect.any(String) }),
    );
    const r = await bothWays(handler);
    expect(r.lowered.note).toBe('a{b');
    expect(r.lowered).toEqual(r.inProcess);
  });
});

// CONTROL (#22860): on every shape the brace count read correctly, the parse
// reads the same bytes. Each expected `source` below was MEASURED by running the
// replaced scan (`origin/main` 69d4218058) over the exact text it is keyed by —
// ⛔ never re-derive one from the current implementation, which would make this
// pin agree with whatever the code does. The handlers are built from source
// strings so `String(fn)` is exactly that text (asserted), whatever transform
// this file goes through.
describe('CONTROL: a shape the brace count read correctly lowers byte-identically (#22860)', () => {
  type Lowerable = (...a: unknown[]) => unknown;
  interface Shape {
    text: string;
    source: string;
    isExpression?: boolean;
    method?: true;
    face?: 'action';
  }
  const shapes: Shape[] = [
    { text: 'async (ctx) => {\n  ctx.input.note = String(ctx.input.name);\n}', source: '\n  ctx.input.note = String(ctx.input.name);\n' },
    { text: '(ctx) => ctx.input.name', source: 'return (ctx.input.name);', isExpression: true },
    { text: '(ctx) =>   ({ note: ctx.input.name })', source: 'return (({ note: ctx.input.name }));', isExpression: true },
    { text: '(ctx) => /* lead */ ctx.input.name', source: 'return (/* lead */ ctx.input.name);', isExpression: true },
    { text: 'function (ctx) {\n  ctx.input.y = 2;\n}', source: '\n  ctx.input.y = 2;\n' },
    { text: 'async function named(ctx) { if (ctx.input.a) { ctx.input.b = { c: 1 }; } }', source: ' if (ctx.input.a) { ctx.input.b = { c: 1 }; } ' },
    { text: 'async h(ctx) {\n  ctx.input.n = [1].map((i) => i).length;\n}', source: '\n  ctx.input.n = [1].map((i) => i).length;\n', method: true },
    { text: 'async (ctx) => { ctx.input.note = `t:${ctx.input.name}`; }', source: ' ctx.input.note = `t:${ctx.input.name}`; ' },
    { text: 'async (ctx) => {\n  // a comment\n  ctx.input.c = 1;\n}', source: '\n  // a comment\n  ctx.input.c = 1;\n' },
    { text: 'async () => { return 1; }', source: ' return 1; ' },
    { text: 'async (input, ctx) => { return { ok: input.id, by: ctx.user }; }', source: ' return { ok: input.id, by: ctx.user }; ', face: 'action' },
  ];
  const build = ({ text, method }: Shape): Lowerable =>
    method
      ? Object.values(new Function(`return ({ ${text} });`)() as Record<string, Lowerable>)[0]
      : (new Function(`return (${text});`)() as Lowerable);

  for (const shape of shapes) {
    const face = shape.face ?? 'hook';
    it(`${face}: ${JSON.stringify(shape.text)}`, () => {
      const fn = build(shape);
      expect(String(fn)).toBe(shape.text);
      expect(extractLoweredBody(fn, "hook 'h'", face)).toEqual({
        source: shape.source,
        capabilities: [],
        isExpression: shape.isExpression ?? false,
      });
    });
  }

  it("hook: `new Function`'s own shape, `function anonymous(ctx\\n) {…}`", () => {
    const fn = new Function('ctx', 'ctx.input.z = 3;') as Lowerable;
    expect(String(fn)).toBe('function anonymous(ctx\n) {\nctx.input.z = 3;\n}');
    expect(extractHookBody(fn, "hook 'h'")).toEqual({ source: '\nctx.input.z = 3;\n', capabilities: [], isExpression: false });
  });
});

/** Module-scope helper used by the #1876 free-identifier test above. */
function moduleScopeHelper(s: string): string {
  return String(s).toLowerCase();
}
