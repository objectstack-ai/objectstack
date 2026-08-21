// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateHookBodyWrites,
  extractHookBodyWrites,
  extractHookBodyWriteSet,
  HOOK_BODY_WRITE_PATTERNS,
  HOOK_BODY_WRITE_PATTERN_IDS,
  HOOK_BODY_WRITE_EXCLUSIONS,
  HOOK_BODY_WRITE_UNKNOWN_FIELD,
  HOOK_BODY_WRITE_UNPROVISIONED_ANCHOR,
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

  // The ledger is the extractor's shape inventory, not this rule's — it now
  // carries a shape (`record-property-assign`) the hook surface does not have.
  // So this rule declares which shapes it consumes, and the two halves must
  // cover the ledger exactly: the next added shape fails here until someone
  // decides whether a hook body can even express it.
  it('partitions the ledger into what this rule consumes and what it leaves alone', () => {
    const declared = HOOK_BODY_WRITE_PATTERNS.map((p) => p.id).sort();
    const classified = [
      ...HOOK_BODY_WRITE_PATTERN_IDS,
      ...HOOK_BODY_WRITE_EXCLUSIONS.map((e) => e.id),
    ].sort();
    expect(classified).toEqual(declared);
    for (const exclusion of HOOK_BODY_WRITE_EXCLUSIONS) {
      expect(exclusion.reason.length, `exclusion '${exclusion.id}' carries no reason`).toBeGreaterThan(0);
    }
  });

  it('leaves an excluded shape extractable but unreported', () => {
    // `ctx.record` does not exist in a hook sandbox context at all, so the
    // expression throws at run time rather than silently no-op'ing — a loud
    // failure this advisory rule deliberately stays out of. What must NOT
    // happen is it landing in the ctx.input branch as "hook writes 'stage' to
    // its input", which is what an unpartitioned rule would have reported.
    expect(extractHookBodyWrites("ctx.record.stage = 'won';")).toEqual([
      { patternId: 'record-property-assign', field: 'stage' },
    ]);
    expect(validateHookBodyWrites(stackWith("ctx.record.stage = 'won'; ctx.record.nope = 1;"))).toEqual([]);
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

  // #4383 — an object that declares NO fields is an external object or a
  // datasource-introspected schema whose columns are resolved at runtime. Its
  // field map is not empty, it is UNKNOWN; treating the empty Set as an answer
  // reported every write to such an object as a missing field.
  it('a target declaring no fields at all is unjudgeable — silent, not "no such field"', () => {
    const stack = {
      objects: [{ name: 'legacy_deal', label: 'Legacy Deal', external: true }],
      hooks: [
        {
          name: 'h',
          object: 'legacy_deal',
          events: ['beforeInsert'],
          body: { language: 'js', source: "ctx.input.stage = 'won';" },
        },
      ],
    };
    expect(validateHookBodyWrites(stack)).toEqual([]);
  });

  it('one fields-less target makes a multi-target everywhere-miss unsound — silent', () => {
    // The finding fires only when a field is missing from EVERY target, and the
    // opaque target is one it might well exist on. Judging the rest would state
    // "missing everywhere" on evidence that does not cover everywhere.
    const stack = {
      objects: [dealObject, { name: 'legacy_deal', external: true }],
      hooks: [
        {
          name: 'h',
          object: ['crm_deal', 'legacy_deal'],
          events: ['beforeInsert'],
          body: { language: 'js', source: "ctx.input.nowhere_field = 'x';" },
        },
      ],
    };
    expect(validateHookBodyWrites(stack)).toEqual([]);
  });

  it('still warns when every target is judgeable', () => {
    // The guard above must not swallow the real finding: same shape, but both
    // targets declare fields.
    const findings = validateHookBodyWrites(
      stackWith("ctx.input.nowhere_field = 'x';", { object: ['crm_deal', 'crm_contact'] }),
    );
    expect(findings).toHaveLength(1);
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

  // #4383 — same unjudgeable class as a cross-package object, on the ctx.api side.
  it('stays silent on an object that declares no fields', () => {
    const stack = {
      objects: [dealObject, { name: 'legacy_deal', external: true }],
      hooks: [
        {
          name: 'h',
          object: 'crm_deal',
          events: ['afterInsert'],
          body: { language: 'js', source: "await ctx.api.object('legacy_deal').update({ stage: 'won' });" },
        },
      ],
    };
    expect(validateHookBodyWrites(stack)).toEqual([]);
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

describe('extractHookBodyWriteSet — the ctx.record liveness signal', () => {
  // One parse yields both the writes and whether `ctx.record` ever leaves the
  // body as a value. The action rule needs the second to tell a dead snapshot
  // write from a payload under construction; nothing else may consume it
  // without this distinction, so it is pinned here at the extractor.
  const escapes = (source: string) => extractHookBodyWriteSet(source).ctxRecordEscapes;

  it('does not escape when ctx.record is only read from and written to', () => {
    expect(escapes("var id = ctx.record.id; ctx.record.stage = 'won';")).toBe(false);
    expect(escapes("ctx.record['amount'] += 1; if (ctx.record.done) { return null; }")).toBe(false);
    expect(escapes('ctx.record.address.city = "SF";')).toBe(false);
  });

  it('does not escape through a truthiness or type test', () => {
    // The defensive idiom real bodies open with — the showcase's own mark_done
    // action is `ctx.recordId || (ctx.record && ctx.record.id)`. Reading a test
    // as an escape would silence the rule on most bodies that have a record
    // write at all.
    expect(escapes('var id = ctx.recordId || (ctx.record && ctx.record.id);')).toBe(false);
    expect(escapes('if (ctx.record) { ctx.record.stage = "won"; }')).toBe(false);
    expect(escapes('if (!ctx.record) return null;')).toBe(false);
    expect(escapes("if (typeof ctx.record === 'object') { ctx.record.x = 1; }")).toBe(false);
    expect(escapes('var v = ctx.record ? 1 : 2;')).toBe(false);
    expect(escapes('var v = ctx.record ?? {};')).toBe(false);
  });

  it('still escapes when a test position yields the object itself', () => {
    // Only the LEFT operand of &&/||/?? is a pure test; the right one is the
    // expression's value when the left is truthy/nullish.
    expect(escapes('var r = fallback || ctx.record;')).toBe(true);
    expect(escapes('var r = ctx.record ? ctx.record : {};')).toBe(true);
  });

  it('escapes when the object itself is handed to anything', () => {
    expect(escapes("await ctx.api.object('crm_deal').update(ctx.record);")).toBe(true); // argument
    expect(escapes('const r = ctx.record;')).toBe(true); // alias
    expect(escapes('return ctx.record;')).toBe(true); // returned
    expect(escapes('const copy = { ...ctx.record };')).toBe(true); // spread
    expect(escapes('Object.assign(ctx.record, { a: 1 });')).toBe(true); // assign target
  });

  it('is false when the body never mentions ctx.record, including the no-parse fast path', () => {
    expect(escapes("ctx.input.total = 1;")).toBe(false);
    expect(escapes('return 1;')).toBe(false); // prefiltered out before the parse
  });

  it('reports one escape for the whole body, not per write', () => {
    // A single escape anywhere disqualifies every record write in the body —
    // the signal is body-scoped by design (no data-flow analysis).
    const set = extractHookBodyWriteSet(
      "ctx.record.stage = 'won'; ctx.record.amount = 1; await ctx.api.object('d').update(ctx.record);",
    );
    expect(set.writes.filter((w) => w.patternId === 'record-property-assign')).toHaveLength(2);
    expect(set.ctxRecordEscapes).toBe(true);
  });
});

// ─── [#8663] Unprovisioned injected anchors on the WRITE axis ────────────────
//
// IMPLICIT_FIELDS is object-INDEPENDENT: it answers "could this name be
// implicitly writable somewhere", which on an ADR-0015 `external` object is not
// the same question as "did the platform provision a column for it here". The
// registry injects the anchors onto a federated object exactly as onto a local
// one, so the write sails past the engine's own write-path validator (which
// refuses an UNDECLARED name outright) and is rejected by the remote database
// instead — measured end to end when this rule was written.
//
// The `external` binding is what makes the anchors unprovisioned; the object
// still declares fields, so it stays judgeable and the existence check is live.
const federatedObject = {
  name: 'wh_order',
  datasource: 'warehouse',
  external: { remoteName: 'fact_orders' },
  fields: { order_id: { type: 'text' }, amount: { type: 'number' } },
};

/** The same object WITHOUT the external binding — every anchor provisioned. */
const localTwin = { name: 'wh_order', fields: { order_id: { type: 'text' }, amount: { type: 'number' } } };

function stackOver(object: Record<string, unknown>, source: string, hookOverrides: Record<string, unknown> = {}) {
  return {
    objects: [object, contactObject],
    hooks: [
      { name: 'stamp', object: 'wh_order', events: ['beforeInsert'], body: { language: 'js', source }, ...hookOverrides },
    ],
  };
}

describe('[#8663] validateHookBodyWrites — unprovisioned anchor writes', () => {
  it('warns on a ctx.input write to an injected anchor the federated object has no storage for', () => {
    const findings = validateHookBodyWrites(stackOver(federatedObject, "ctx.input.owner_id = ctx.user.id;"));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(HOOK_BODY_WRITE_UNPROVISIONED_ANCHOR);
    // Advisory, NOT the gating severity — the claim is about a remote schema.
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].where).toBe('hook "stamp" › body');
    expect(findings[0].path).toBe('hooks[0].body.source');
    expect(findings[0].message).toContain("'owner_id'");
    expect(findings[0].message).toContain('external object (ADR-0015)');
    // The measured consequence, not the read-axis one: the value cannot land.
    expect(findings[0].message).toContain('can never land');
    expect(findings[0].hint).toContain("declare it in wh_order's own fields");
  });

  it('the SAME write on the same object without the external binding is silent', () => {
    expect(validateHookBodyWrites(stackOver(localTwin, "ctx.input.owner_id = ctx.user.id;"))).toEqual([]);
  });

  it('warns on the ctx.api surface too, naming the method', () => {
    const findings = validateHookBodyWrites(
      stackOver(federatedObject, "await ctx.api.object('wh_order').updateById(id, { organization_id: 'org_1' });"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(HOOK_BODY_WRITE_UNPROVISIONED_ANCHOR);
    expect(findings[0].message).toContain('updateById');
    expect(findings[0].message).toContain("'organization_id'");
  });

  it('an AUTHOR-DECLARED column of the same name is the author\'s — never flagged', () => {
    // #7859's direction: on a federated object a declared `owner_id` maps a
    // remote column the author vouches for, so provenance is `author` and both
    // findings must stay silent.
    const declared = {
      ...federatedObject,
      fields: { ...federatedObject.fields, owner_id: { type: 'text' } },
    };
    expect(validateHookBodyWrites(stackOver(declared, "ctx.input.owner_id = ctx.user.id;"))).toEqual([]);
  });

  it('multi-target: an anchor real on ONE target is a legitimate per-object branch', () => {
    // `crm_contact` is local, so its owner_id IS provisioned — the body may
    // branch on ctx.object, and "can never land" would be false.
    const findings = validateHookBodyWrites(
      stackOver(federatedObject, "ctx.input.owner_id = ctx.user.id;", { object: ['wh_order', 'crm_contact'] }),
    );
    expect(findings).toEqual([]);
  });

  it('leaves the ordinary unknown-field finding on the same object untouched', () => {
    const findings = validateHookBodyWrites(stackOver(federatedObject, "ctx.input.ordr_id = 'x';"));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(HOOK_BODY_WRITE_UNKNOWN_FIELD);
    expect(findings[0].severity).toBe('warning');
  });

  it('a rule-local exemption that is NOT an injected anchor stays exempt on a federated object', () => {
    // `_id` / `space` / `record_type` are IMPLICIT_FIELDS extensions, not spec
    // system columns, so no provenance verdict exists for them and the blanket
    // exemption is still the whole answer.
    expect(validateHookBodyWrites(stackOver(federatedObject, "ctx.input._id = 'x'; ctx.input.record_type = 'y';"))).toEqual([]);
  });
});

// ── [#10653] The body that could not be READ ─────────────────────────────────
//
// This extractor's contract said "error-tolerant (a body with syntax errors
// simply yields fewer matches)". Fewer matches is indistinguishable, at the call
// site, from a body that writes nothing — so an unparseable body came back as a
// hook with nothing to report. It is the same silence the undeclared write has
// at run time, this time wearing the checker's badge.
//
// This site is the delicate one of the three, because it parses a SYNTHESISED
// wrapper: `async function __body(ctx) { … }`, the shape the runtime compiles a
// hook body into. So "unparseable" here could in principle mean the wrapper is
// wrong rather than the author's source, and blaming an author for the checker's
// own bug would be a worse defect than the one being fixed. `the wrapper is not
// what fails` below is the mechanical proof that it cannot be.
describe('an unparseable hook body is reported, not scored clean (#10653)', () => {
  // Same write in both halves; the only difference is the `/*` that eats it.
  const wrecked = "const x = 1;\n/* TODO\nctx.input.amout = 0;\n";
  const repaired = "const x = 1;\nctx.input.amout = 0;\n";

  it('POSITIVE CONTROL — the repaired body yields the write, so the wreck had something to lose', () => {
    expect(extractHookBodyWriteSet(repaired).writes).toEqual([{ patternId: 'input-property-assign', field: 'amout' }]);
    expect(extractHookBodyWriteSet(repaired).parseFailure).toBeUndefined();
  });

  it('the wrecked body loses the write — the harm, reproduced', () => {
    expect(extractHookBodyWriteSet(wrecked).writes).toEqual([]);
  });

  it('…and the set now carries the parse verdict instead of returning an empty write list', () => {
    const failure = extractHookBodyWriteSet(wrecked).parseFailure;
    expect(failure).toBeDefined();
    expect(failure!.count).toBeGreaterThan(0);
    expect(failure!.message.length).toBeGreaterThan(0);
  });

  it('reports the position in the BODY’s coordinates, never the wrapper’s', () => {
    // The author wrote the wreck on line 2 of their own body. The wrapper puts
    // it on line 3 of what is actually parsed.
    //
    // The `ctx` on line 1 is load-bearing, not scenery: without it the raw-text
    // pre-filter returns before any parse happens and there is no position to
    // report at all. (This fixture was first written without it, and this test
    // failed — the pre-filter contract holding, not a bug.)
    const failure = extractHookBodyWriteSet('ctx.input.a = 1;\nconst y = ;\n').parseFailure!;
    expect(failure.line).toBe(2);
  });

  it('the wrapper is not what fails — a parse failure is always the BODY’s (attribution proof)', () => {
    // The wrapper is a constant. If it were ill-formed, it would fail around a
    // trivially valid body too — and around every example the pattern ledger
    // declares. It does not, so a diagnostic can only come from the body.
    expect(extractHookBodyWriteSet('ctx.input.stage = 1;').parseFailure).toBeUndefined();
    expect(extractHookBodyWriteSet('Object.assign(ctx.input, {});').parseFailure).toBeUndefined();
    for (const pattern of HOOK_BODY_WRITE_PATTERNS) {
      expect(
        extractHookBodyWriteSet(pattern.example.source).parseFailure,
        `the wrapper fails around a declared ledger example (${pattern.id}) — the synthesis is what is broken, ` +
          `not the body, and this rule would be blaming the author for it`,
      ).toBeUndefined();
    }
  });

  it('a body the runtime itself could not compile is the author’s, and is reported', () => {
    // A hook body runs as `new AsyncFunction('ctx', source)`. `return`/`await`
    // are legal there and must stay legal here (they parse inside the wrapper),
    // while a body that is not a function body at all is a real author error.
    expect(extractHookBodyWriteSet('await ctx.api.object("a").insert({});\nreturn 1;').parseFailure).toBeUndefined();
    expect(extractHookBodyWriteSet('ctx.input.a = 1;\n}\n').parseFailure, 'a stray brace closes the wrapper early')
      .toBeDefined();
  });

  it('the rule surfaces it as a finding on the hook', () => {
    const findings = validateHookBodyWrites(stackOver(federatedObject, wrecked));
    const parseFindings = findings.filter((f) => f.rule === 'hook-body-source-unparseable');
    expect(parseFindings).toHaveLength(1);
    expect(parseFindings[0].severity).toBe('warning');
    expect(parseFindings[0].where).toBe('hook "stamp" › body');
    expect(parseFindings[0].path).toBe('hooks[0].body.source');
    expect(parseFindings[0].message).toContain('did not parse');
  });

  it('a body with no `ctx` and no `Object` is skipped WITHOUT a parse claim', () => {
    // The pre-filter is a raw-text scan and is sound whether or not the body
    // parses: no `ctx`/`Object` identifier means no pattern can match, however
    // it parses. So the skipped parse hides nothing and must claim nothing.
    expect(extractHookBodyWriteSet('const a = ;\n').parseFailure).toBeUndefined();
    expect(extractHookBodyWriteSet('const a = ;\n').writes).toEqual([]);
  });

  it('FALSE-POSITIVE CONTROL — no body that parses gains a parse finding', () => {
    const parseable = [
      "ctx.input.stage = 'won';",
      "await ctx.api.object('crm_deal').update({ stage: 'won' });",
      "const r = ctx.record; r.stage = 'won';",
      "if (ctx.input.amount > 0) { ctx.input.stage = 'won'; } else { ctx.input.stage = 'lost'; }",
      "for (const k of Object.keys(ctx.input)) { ctx.input[k] = ctx.input[k]; }",
      "try { await ctx.api.object('crm_deal').insert({ stage: 'x' }); } catch (e) { ctx.logger.warn(e); }",
      "ctx.input.stage = `won-${ctx.user.id}`;",
      ...HOOK_BODY_WRITE_PATTERNS.map((p) => p.example.source),
    ];
    for (const source of parseable) {
      expect(
        extractHookBodyWriteSet(source).parseFailure,
        `parseable body gained a parse failure:\n${source}`,
      ).toBeUndefined();
    }
  });
});
