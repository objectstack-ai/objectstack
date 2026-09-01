// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13651 — the refusal carries its classification, and the messages did not move.
 *
 * Two halves, and the second matters as much as the first: `os build`'s
 * warn-and-bundle line, `--strict-body`'s per-callable diagnostic and
 * `content/docs/automation/hook-bodies.mdx` all quote these sentences, so a
 * refactor that "only" reworded them would be a documentation break with a
 * green test suite.
 */

import { describe, it, expect } from 'vitest';
import { extractHookBody, HookBodyExtractionError } from './extract-hook-body.js';
import { lowerCallables } from './lower-callables.js';

const TERRITORY: Record<string, string> = { US: 'na', DE: 'eu' };

describe('HookBodyExtractionError', () => {
  it('classifies a module-scope reference as free-identifiers and names them', () => {
    let caught: unknown;
    try {
      extractHookBody(((ctx: any) => {
        ctx.input.territory = TERRITORY[ctx.input.country];
      }) as any, "hook 'x'");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(HookBodyExtractionError);
    const err = caught as HookBodyExtractionError;
    expect(err.kind).toBe('free-identifiers');
    expect(err.originLabel).toBe("hook 'x'");
    expect(err.freeIdentifiers).toContain('TERRITORY');
    // Message unchanged — the docs quote this sentence.
    expect(err.message).toContain('references identifier(s) not in scope at runtime');
  });

  it('classifies a sandbox-impossible token as forbidden-token', () => {
    let caught: unknown;
    try {
      extractHookBody((async (ctx: any) => {
        ctx.out = await fetch('https://example.invalid');
      }) as any, "hook 'y'");
    } catch (err) {
      caught = err;
    }

    const err = caught as HookBodyExtractionError;
    expect(err.kind).toBe('forbidden-token');
    expect(err.freeIdentifiers).toEqual([]);
    expect(err.message).toContain('`fetch()` is not allowed in hook/action bodies');
    // The offending-source dump the `--strict-body` diagnostic prints.
    expect(err.message).toContain('--- offending body source ---');
  });
});

describe('lowerCallables carries the classification without changing what it does', () => {
  const config = () => ({
    hooks: [
      {
        name: 'territory',
        object: 'account',
        events: ['beforeInsert'],
        handler: (ctx: any) => {
          ctx.input.territory = TERRITORY[ctx.input.country];
        },
      },
    ],
  });

  it('records the kind and the identifiers beside the unchanged reason', () => {
    const out = lowerCallables(config());

    expect(out.bodyExtractionWarnings).toHaveLength(1);
    const w = out.bodyExtractionWarnings[0];
    expect(w.origin).toBe("hook 'territory'");
    expect(w.kind).toBe('free-identifiers');
    expect(w.freeIdentifiers).toContain('TERRITORY');
    expect(w.reason).toContain('references identifier(s) not in scope at runtime');
  });

  it('STILL bundles the callable and still emits no body — the fallback is intact', () => {
    // The catch must survive this card. If a later change deletes it, the
    // legitimate "author deliberately wants a bundled closure" path dies with
    // the accidental one, and this assertion is what notices.
    const out = lowerCallables(config());

    expect(out.count).toBe(1);
    expect(out.bodyExtracted).toBe(0);
    expect(out.functions.territory).toBeTypeOf('function');
    expect((out.lowered.hooks as any[])[0].handler).toBe('territory');
    expect((out.lowered.hooks as any[])[0].body).toBeUndefined();
  });

  it('reports kind "unknown" when the extractor itself throws a bare Error', () => {
    // Not folded into `unparseable`: an instrument failure must stay
    // distinguishable from a verdict about the author's handler.
    const exploding = () => {
      throw new Error('boom');
    };
    Object.defineProperty(exploding, 'toString', {
      value: () => {
        throw new Error('cannot stringify');
      },
    });

    const out = lowerCallables({
      hooks: [{ name: 'boom', object: 'o', events: ['beforeInsert'], handler: exploding }],
    });

    expect(out.bodyExtractionWarnings).toHaveLength(1);
    expect(out.bodyExtractionWarnings[0].kind).toBe('unknown');
    expect(out.bodyExtractionWarnings[0].freeIdentifiers).toEqual([]);
  });
});
