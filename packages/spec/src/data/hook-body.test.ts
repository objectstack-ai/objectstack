// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  HookBodySchema,
  ExpressionBodySchema,
  ScriptBodySchema,
  HookBodyCapability,
} from './hook-body.zod';

describe('HookBody', () => {
  describe('ExpressionBody (L1)', () => {
    it('accepts a non-empty expression', () => {
      const r = ExpressionBodySchema.safeParse({
        language: 'expression',
        source: "input.amount > 1000 && input.status == 'open'",
      });
      expect(r.success).toBe(true);
    });

    it('rejects empty source', () => {
      const r = ExpressionBodySchema.safeParse({ language: 'expression', source: '' });
      expect(r.success).toBe(false);
    });
  });

  describe('ScriptBody (L2)', () => {
    it('accepts a minimal script with default capabilities []', () => {
      const r = ScriptBodySchema.safeParse({
        language: 'js',
        source: 'ctx.input.email = ctx.input.email.toLowerCase();',
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.capabilities).toEqual([]);
    });

    it('accepts capabilities + timeout + memory', () => {
      const r = ScriptBodySchema.safeParse({
        language: 'js',
        source: 'await ctx.api.object("opportunity").count();',
        capabilities: ['api.read', 'log'],
        timeoutMs: 500,
        memoryMb: 64,
      });
      expect(r.success).toBe(true);
    });

    it('rejects unknown capabilities', () => {
      const r = ScriptBodySchema.safeParse({
        language: 'js',
        source: 'x = 1;',
        capabilities: ['http.fetch'],
      });
      expect(r.success).toBe(false);
    });

    // ── `crypto.hash` retirement pins (#4391) ───────────────────────────────
    //
    // The token was declared here, inferred by the CLI extractor and typed on
    // `ScriptContext`, while the sandbox installed only `randomUUID` — so the
    // one call it authorised always threw. All three declarations went in
    // #4391. These assertions are what must go red if any of them comes back
    // WITHOUT an implementation behind it.

    it('does not offer `crypto.hash` as a capability token (#4391)', () => {
      expect(HookBodyCapability.options).toEqual([
        'api.read',
        'api.write',
        'api.transaction',
        'crypto.uuid',
        'log',
      ]);
      expect(HookBodyCapability.options).not.toContain('crypto.hash');
    });

    it('rejects a body declaring `crypto.hash`, with the retirement prescription (#4391)', () => {
      const r = ScriptBodySchema.safeParse({
        language: 'js',
        source: "ctx.input.fp = await ctx.crypto.hash('sha256', ctx.input.email);",
        capabilities: ['crypto.hash'],
      });
      expect(r.success).toBe(false);
      const message = r.success ? '' : JSON.stringify(r.error.issues);
      // The prescription itself, not a bare "invalid enum value": it must name
      // the token, say it was removed, and tell the author what to do instead.
      expect(message).toMatch(/crypto\.hash.*was removed.*17.*ADR-0049/s);
      // Negative pin: the tracker id resolves to nothing for this audience.
      expect(message).not.toMatch(/#\d{3,5}\b/);
      expect(message).toMatch(/sandbox never implemented it/s);
      expect(message).toMatch(/Delete the capability/s);
    });

    it('still accepts `crypto.uuid` — the sibling that IS implemented (#4391)', () => {
      const r = ScriptBodySchema.safeParse({
        language: 'js',
        source: 'ctx.input.trace = ctx.crypto.randomUUID();',
        capabilities: ['crypto.uuid'],
      });
      expect(r.success).toBe(true);
    });

    it("gives an UNKNOWN token zod's own message, not the retirement one (#4391)", () => {
      // Only the value that used to be legal gets "was removed" — telling the
      // author of a typo that their token was retired would misinform.
      const r = ScriptBodySchema.safeParse({
        language: 'js',
        source: 'x = 1;',
        capabilities: ['crypto.hsah'],
      });
      expect(r.success).toBe(false);
      const message = r.success ? '' : JSON.stringify(r.error.issues);
      expect(message).not.toMatch(/was removed/);
    });

    it('rejects timeoutMs over the cap', () => {
      const r = ScriptBodySchema.safeParse({
        language: 'js',
        source: 'x = 1;',
        timeoutMs: 60_000,
      });
      expect(r.success).toBe(false);
    });

    it('rejects empty source', () => {
      const r = ScriptBodySchema.safeParse({ language: 'js', source: '' });
      expect(r.success).toBe(false);
    });
  });

  describe('HookBody (discriminated union)', () => {
    it('routes to expression on language: expression', () => {
      const r = HookBodySchema.safeParse({ language: 'expression', source: 'x > 0' });
      expect(r.success).toBe(true);
    });

    it('routes to script on language: js', () => {
      const r = HookBodySchema.safeParse({ language: 'js', source: 'return;' });
      expect(r.success).toBe(true);
    });

    it('rejects compiled-module form (L3 disabled)', () => {
      const r = HookBodySchema.safeParse({
        language: 'module',
        ref: 'bundle.functions.handler',
      } as unknown as Parameters<typeof HookBodySchema.safeParse>[0]);
      expect(r.success).toBe(false);
    });

    it('rejects an unknown language', () => {
      const r = HookBodySchema.safeParse({
        language: 'python',
        source: 'pass',
      } as unknown as Parameters<typeof HookBodySchema.safeParse>[0]);
      expect(r.success).toBe(false);
    });
  });
});
