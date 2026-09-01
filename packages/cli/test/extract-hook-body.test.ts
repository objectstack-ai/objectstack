// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { extractHookBody } from '../src/utils/extract-hook-body.js';

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

  // ── the `@capabilities` directive, RETIRED (#10917) ─────────────────────
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
  // explicit `@capabilities` override went with the directive (#10917): with no
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
});

/** Module-scope helper used by the #1876 free-identifier test above. */
function moduleScopeHelper(s: string): string {
  return String(s).toLowerCase();
}
