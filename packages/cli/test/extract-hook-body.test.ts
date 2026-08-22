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

  it('honours explicit @capabilities override', () => {
    const fn = (_ctx: any) => {
      // @capabilities api.read api.write log
      return 1;
    };
    const ext = extractHookBody(fn, 'hook e');
    expect(ext.capabilities.sort()).toEqual(['api.read', 'api.write', 'log']);
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

  it('ignores crypto.hash in an explicit @capabilities override (#4391)', () => {
    const fn = (_ctx: any) => {
      // @capabilities api.read crypto.hash log
      return 1;
    };
    const ext = extractHookBody(fn, 'hook f');
    expect(ext.capabilities.sort()).toEqual(['api.read', 'log']);
    expect(ext.capabilities).not.toContain('crypto.hash');
  });

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
