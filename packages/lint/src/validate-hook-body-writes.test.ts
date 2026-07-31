// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateHookBodyWrites,
  extractHookBodyWrites,
  HOOK_BODY_WRITE_PATTERNS,
  HOOK_BODY_WRITE_UNKNOWN_FIELD,
} from './validate-hook-body-writes.js';

// Target objects: array-shaped and map-shaped `fields`, plus a second object
// for cross-object `ctx.api` writes and multi-target hooks.
const dealObject = {
  name: 'crm_deal',
  fields: [
    { name: 'stage', type: 'text' },
    { name: 'amount', type: 'currency' },
    { name: 'discount_total', type: 'currency' },
  ],
};
const contactObject = {
  name: 'crm_contact',
  fields: {
    email: { type: 'text' },
    amount: { type: 'currency' }, // shared with crm_deal, for partial-miss cases
  },
};

/** A stack with a single JS-body hook (hooks[0]) over `source`. */
function stackWith(source: string, hookOverrides: Record<string, unknown> = {}) {
  return {
    objects: [dealObject, contactObject],
    hooks: [
      {
        name: 'normalize_deal',
        object: 'crm_deal',
        events: ['beforeInsert'],
        body: { language: 'js', source },
        ...hookOverrides,
      },
    ],
  };
}

describe('HOOK_BODY_WRITE_PATTERNS — ledger ⇄ extractor reconciliation', () => {
  // The ledger is the published answer to "which writes does the lint see?".
  // Each entry's example must round-trip through the real extractor — a
  // declared-but-unextracted pattern (#3528's death) fails here.
  it('declares unique pattern ids', () => {
    const ids = HOOK_BODY_WRITE_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const pattern of HOOK_BODY_WRITE_PATTERNS) {
    it(`extracts exactly the declared writes for '${pattern.id}'`, () => {
      const extracted = extractHookBodyWrites(pattern.example.source);
      // Every extraction from the canonical example carries this entry's id —
      // examples stay pure per-pattern.
      expect(extracted.map((w) => w.patternId)).toEqual(extracted.map(() => pattern.id));
      expect(extracted.map(({ field, object }) => (object ? { field, object } : { field })))
        .toEqual(pattern.example.writes);
    });
  }
});

describe('validateHookBodyWrites — ctx.input writes', () => {
  it('warns on a field the target object never declares, with a did-you-mean', () => {
    const findings = validateHookBodyWrites(stackWith("ctx.input.discont_total = 0;"));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(HOOK_BODY_WRITE_UNKNOWN_FIELD);
    expect(findings[0].where).toBe('hook "normalize_deal" › body');
    expect(findings[0].path).toBe('hooks[0].body.source');
    expect(findings[0].message).toContain("discont_total");
    expect(findings[0].message).toContain('crm_deal');
    expect(findings[0].message).toContain('#4271');
    expect(findings[0].hint).toContain("'discount_total'");
  });

  it('accepts declared fields, system columns, and envelope keys', () => {
    const findings = validateHookBodyWrites(
      stackWith(
        "ctx.input.stage = 'won'; ctx.input.updated_by = ctx.user.id; " +
          "ctx.input.options = { skip: true }; ctx.input.data = {}; ctx.input.ast = null;",
      ),
    );
    expect(findings).toEqual([]);
  });

  it("catches bracket-literal and compound/logical assignments", () => {
    const findings = validateHookBodyWrites(
      stackWith("ctx.input['stge'] = 'won'; ctx.input.amout += 1; ctx.input.emial ??= 'x';"),
    );
    expect(findings.map((f) => f.message.match(/'(\w+)'/)?.[1])).toEqual(['stge', 'amout', 'emial']);
  });

  it('catches Object.assign literal keys (shorthand included) and skips its opaque members', () => {
    const findings = validateHookBodyWrites(
      stackWith("const extra = {}; Object.assign(ctx.input, extra, { amount: 1, totl: 2, ...extra });"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("'totl'");
  });

  it('stays silent on statically-opaque writes: computed keys, nested paths, aliased input', () => {
    const findings = validateHookBodyWrites(
      stackWith(
        // computed key; nested sub-object write; the documented v1 known miss
        // (one-level alias) — all bail silently rather than guess.
        "const k = 'x'; ctx.input[k] = 1; ctx.input.address.city = 'SF'; " +
          'const doc = ctx.input; doc.not_a_field = 1;',
      ),
    );
    expect(findings).toEqual([]);
  });

  it("skips ctx.input writes on wildcard hooks — but still checks their ctx.api writes", () => {
    const findings = validateHookBodyWrites(
      stackWith(
        "ctx.input.anything = 1; await ctx.api.object('crm_contact').update({ emial: 'x' });",
        { object: '*' },
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('crm_contact');
    expect(findings[0].message).toContain("'emial'");
  });

  it('skips hooks targeting an object this stack does not declare', () => {
    const findings = validateHookBodyWrites(stackWith('ctx.input.whatever = 1;', { object: 'pkg_external' }));
    expect(findings).toEqual([]);
  });

  it('multi-target: a field on SOME target is a legitimate per-object branch — only an everywhere-miss warns', () => {
    const partial = validateHookBodyWrites(
      // `email` exists on crm_contact only; the body may guard on ctx.object.
      stackWith("ctx.input.email = 'x';", { object: ['crm_deal', 'crm_contact'] }),
    );
    expect(partial).toEqual([]);

    const everywhere = validateHookBodyWrites(
      stackWith("ctx.input.nowhere_field = 'x';", { object: ['crm_deal', 'crm_contact'] }),
    );
    expect(everywhere).toHaveLength(1);
    expect(everywhere[0].message).toContain('crm_deal, crm_contact');
  });

  it('multi-target with any cross-package member is unjudgeable — silent', () => {
    const findings = validateHookBodyWrites(
      stackWith("ctx.input.nowhere_field = 'x';", { object: ['crm_deal', 'pkg_external'] }),
    );
    expect(findings).toEqual([]);
  });
});

describe('validateHookBodyWrites — ctx.api writes', () => {
  it('checks insert/create/update payloads (argument 0) against the named object', () => {
    const findings = validateHookBodyWrites(
      stackWith(
        "await ctx.api.object('crm_contact').insert({ emial: 'a' }); " +
          "await ctx.api.object('crm_contact').create({ email: 'b' }); " +
          "await ctx.api.object('crm_contact').update({ id, email: 'c' });",
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("ctx.api.object('crm_contact').insert");
    expect(findings[0].hint).toContain("'email'");
  });

  it('checks updateById payloads at argument 1, not 0', () => {
    const findings = validateHookBodyWrites(
      stackWith("await ctx.api.object('crm_deal').updateById(ctx.input.id, { stag: 'won' });"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('updateById');
    expect(findings[0].message).toContain("'stag'");
  });

  it('stays silent on dynamic object names, unknown objects, and non-literal payloads', () => {
    const findings = validateHookBodyWrites(
      stackWith(
        "await ctx.api.object(target).update({ nope: 1 }); " + // dynamic name
          "await ctx.api.object('pkg_external').insert({ nope: 1 }); " + // other package
          "await ctx.api.object('crm_deal').update(payload); " + // opaque payload
          "await ctx.api.object('crm_deal').delete({ where: { id } });", // not a write-payload method
      ),
    );
    expect(findings).toEqual([]);
  });
});

describe('validateHookBodyWrites — scope and shape tolerance', () => {
  it('ignores hooks with no body, L1 expression bodies, and empty sources', () => {
    expect(
      validateHookBodyWrites({
        objects: [dealObject],
        hooks: [
          { name: 'a', object: 'crm_deal', events: ['beforeInsert'], handler: 'legacy_fn' },
          {
            name: 'b',
            object: 'crm_deal',
            events: ['beforeInsert'],
            body: { language: 'expression', source: 'input.amount > 0' },
          },
          { name: 'c', object: 'crm_deal', events: ['beforeInsert'], body: { language: 'js', source: '   ' } },
        ],
      }),
    ).toEqual([]);
  });

  it('returns [] for stacks with no hooks at all', () => {
    expect(validateHookBodyWrites({})).toEqual([]);
    expect(validateHookBodyWrites({ hooks: [] })).toEqual([]);
  });

  it('reports each unknown field once per hook, even when written repeatedly', () => {
    const findings = validateHookBodyWrites(
      stackWith('ctx.input.totl = 1; ctx.input.totl = 2; Object.assign(ctx.input, { totl: 3 });'),
    );
    expect(findings).toHaveLength(1);
  });

  it('accepts map-shaped hooks collections (name injected)', () => {
    const findings = validateHookBodyWrites({
      objects: [dealObject],
      hooks: {
        normalize_deal: {
          object: 'crm_deal',
          events: ['beforeInsert'],
          body: { language: 'js', source: 'ctx.input.totl = 1;' },
        },
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('hook "normalize_deal" › body');
  });

  it('does not throw on source with syntax errors — fewer matches, never a crash', () => {
    expect(() => validateHookBodyWrites(stackWith('ctx.input.x = ; if ('))).not.toThrow();
  });
});
