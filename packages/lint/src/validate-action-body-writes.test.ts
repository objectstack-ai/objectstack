// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateActionBodyWrites,
  ACTION_BODY_WRITE_PATTERNS,
  ACTION_BODY_WRITE_PATTERN_IDS,
  ACTION_RECORD_WRITE_PATTERNS,
  ACTION_RECORD_WRITE_PATTERN_IDS,
  ACTION_BODY_WRITE_EXCLUSIONS,
  ACTION_BODY_WRITE_UNKNOWN_FIELD,
  ACTION_BODY_WRITE_UNPROVISIONED_ANCHOR,
  ACTION_RECORD_WRITE_DISCARDED,
} from './validate-action-body-writes.js';
import {
  extractHookBodyWrites,
  HOOK_BODY_WRITE_PATTERNS,
  IMPLICIT_FIELDS,
} from './validate-hook-body-writes.js';

// Target objects: array-shaped and map-shaped `fields`, so both authoring
// shapes are resolved.
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
  },
};

/** A stack with a single top-level JS-body action (actions[0]) over `source`. */
function stackWith(source: string, actionOverrides: Record<string, unknown> = {}) {
  return {
    objects: [dealObject, contactObject],
    actions: [
      {
        name: 'close_deal',
        label: 'Close Deal',
        objectName: 'crm_deal',
        body: { language: 'js', source },
        ...actionOverrides,
      },
    ],
  };
}

describe('ACTION_BODY_WRITE_PATTERNS — ledger partition and reconciliation', () => {
  // The two halves are the declared answer to "which of the shared hook
  // patterns mean the same thing in an action body?". Their union must BE the
  // shared ledger: a fourth pattern landing on the hook side then fails here
  // until someone classifies it, instead of being silently assumed either way.
  it('partitions the shared hook ledger exactly — no phantom, no unclassified id', () => {
    const shared = HOOK_BODY_WRITE_PATTERNS.map((p) => p.id).sort();
    const classified = [
      ...ACTION_BODY_WRITE_PATTERN_IDS,
      ...ACTION_RECORD_WRITE_PATTERN_IDS,
      ...ACTION_BODY_WRITE_EXCLUSIONS.map((e) => e.id),
    ].sort();
    expect(classified).toEqual(shared);
  });

  it('assigns each ledger shape to at most one check', () => {
    const overlap = ACTION_BODY_WRITE_PATTERN_IDS.filter((id) =>
      ACTION_RECORD_WRITE_PATTERN_IDS.includes(id),
    );
    expect(overlap).toEqual([]);
  });

  it('derives each subset from the shared ledger, in ledger order', () => {
    expect(ACTION_BODY_WRITE_PATTERNS.map((p) => p.id)).toEqual([...ACTION_BODY_WRITE_PATTERN_IDS]);
    expect(ACTION_RECORD_WRITE_PATTERNS.map((p) => p.id)).toEqual([...ACTION_RECORD_WRITE_PATTERN_IDS]);
  });

  it('gives every exclusion a non-empty reason', () => {
    for (const exclusion of ACTION_BODY_WRITE_EXCLUSIONS) {
      expect(exclusion.reason.length, `exclusion '${exclusion.id}' carries no reason`).toBeGreaterThan(0);
    }
  });

  /** Objects for each distinct write target in an example, none declaring the written field. */
  const stackForExample = (pattern: (typeof HOOK_BODY_WRITE_PATTERNS)[number]) => ({
    objects: [
      ...new Set(pattern.example.writes.map((w) => w.object).filter((o): o is string => typeof o === 'string')),
    ].map((name) => ({ name, fields: [{ name: 'placeholder_only', type: 'text' }] })),
    actions: [{ name: 'run_it', label: 'Run', body: { language: 'js', source: pattern.example.source } }],
  });

  for (const pattern of ACTION_BODY_WRITE_PATTERNS) {
    // End-to-end, not just extraction: the cheap `api` prefilter, the
    // patternId filter and the field check all sit between the ledger example
    // and a finding, and any of them could silently drop the pattern.
    it(`reports every declared write of '${pattern.id}' through the full validator`, () => {
      const expected = new Set(
        pattern.example.writes
          .filter((w) => w.object !== undefined && !IMPLICIT_FIELDS.has(w.field))
          .map((w) => `${w.object} ${w.field}`),
      );
      expect(expected.size, `'${pattern.id}' declares no object-addressed write`).toBeGreaterThan(0);

      const findings = validateActionBodyWrites(stackForExample(pattern));
      expect(findings).toHaveLength(expected.size);
      for (const finding of findings) {
        expect(finding.severity).toBe('warning');
        expect(finding.rule).toBe(ACTION_BODY_WRITE_UNKNOWN_FIELD);
      }
    });
  }

  for (const pattern of ACTION_RECORD_WRITE_PATTERNS) {
    // Same end-to-end demand on the other check: prefilter, pattern filter and
    // the escape analysis all sit between the ledger example and a finding.
    it(`reports every declared write of '${pattern.id}' as a discarded record write`, () => {
      const fields = [...new Set(pattern.example.writes.map((w) => w.field))];
      expect(fields.length, `'${pattern.id}' declares no write`).toBeGreaterThan(0);

      const findings = validateActionBodyWrites(stackWith(pattern.example.source));
      expect(findings).toHaveLength(fields.length);
      for (const finding of findings) {
        expect(finding.severity).toBe('warning');
        expect(finding.rule).toBe(ACTION_RECORD_WRITE_DISCARDED);
      }
    });
  }

  for (const exclusion of ACTION_BODY_WRITE_EXCLUSIONS) {
    // An exclusion must be about APPLICABILITY, not about a pattern nothing
    // can extract — so the shared extractor still sees it, and this rule still
    // reports nothing for it.
    it(`excludes '${exclusion.id}': extractable by the shared extractor, silent here`, () => {
      const pattern = HOOK_BODY_WRITE_PATTERNS.find((p) => p.id === exclusion.id);
      expect(pattern, `exclusion '${exclusion.id}' names no shared pattern`).toBeDefined();
      expect(extractHookBodyWrites(pattern!.example.source).length).toBeGreaterThan(0);
      // The example body PLUS a clean `ctx.api` call, so the cheap `api`
      // prefilter passes and the source is genuinely parsed: what drops these
      // writes is the pattern filter, not a short-circuit before it. None of
      // the excluded examples' field names exists on crm_deal, so a filter that
      // stopped working would warn here.
      const findings = validateActionBodyWrites(
        stackWith(`${pattern!.example.source} await ctx.api.object('crm_deal').update({ stage: 'won' });`),
      );
      expect(findings).toEqual([]);
    });
  }
});

describe('validateActionBodyWrites — ctx.api writes', () => {
  it('warns on a field the named object never declares, with a did-you-mean', () => {
    const findings = validateActionBodyWrites(
      stackWith("await ctx.api.object('crm_deal').update({ discont_total: 0 });"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(ACTION_BODY_WRITE_UNKNOWN_FIELD);
    expect(findings[0].where).toBe('action "close_deal" › body');
    expect(findings[0].path).toBe('actions[0].body.source');
    expect(findings[0].message).toContain('discont_total');
    expect(findings[0].message).toContain('crm_deal');
    expect(findings[0].message).toContain('#4271');
    expect(findings[0].hint).toContain("'discount_total'");
  });

  it('checks insert/create/update payloads (argument 0) and updateById at argument 1', () => {
    const findings = validateActionBodyWrites(
      stackWith(
        "await ctx.api.object('crm_contact').insert({ emial: 'a' }); " +
          "await ctx.api.object('crm_contact').create({ email: 'b' }); " +
          "await ctx.api.object('crm_deal').updateById(ctx.recordId, { stag: 'won' });",
      ),
    );
    expect(findings.map((f) => f.message.match(/writing '(\w+)'/)?.[1])).toEqual(['emial', 'stag']);
    expect(findings[0].message).toContain("ctx.api.object('crm_contact').insert");
    expect(findings[1].message).toContain('updateById');
  });

  it('accepts declared fields and system columns', () => {
    const findings = validateActionBodyWrites(
      stackWith(
        "await ctx.api.object('crm_deal').update({ stage: 'won', amount: 1, updated_by: ctx.user.id });",
      ),
    );
    expect(findings).toEqual([]);
  });

  it('stays silent on dynamic object names, unknown objects, and non-literal payloads', () => {
    const findings = validateActionBodyWrites(
      stackWith(
        'await ctx.api.object(input.target).update({ nope: 1 }); ' + // dynamic name
          "await ctx.api.object('pkg_external').insert({ nope: 1 }); " + // other package
          "await ctx.api.object('crm_deal').update(input.payload); " + // opaque payload
          "await ctx.api.object('crm_deal').delete({ where: { id: ctx.recordId } });", // not a write-payload method
      ),
    );
    expect(findings).toEqual([]);
  });

  // #4383 — an object declaring NO fields (external / datasource-introspected,
  // columns resolved at runtime) is unjudgeable, not "has no such field". The
  // empty Set used to answer `has()` false for every write to it.
  it('stays silent on an object that declares no fields', () => {
    const stack = {
      objects: [dealObject, { name: 'legacy_deal', label: 'Legacy Deal', external: true }],
      actions: [
        {
          name: 'sync_legacy',
          label: 'Sync Legacy',
          objectName: 'crm_deal',
          body: { language: 'js', source: "await ctx.api.object('legacy_deal').update({ stage: 'won' });" },
        },
      ],
    };
    expect(validateActionBodyWrites(stack)).toEqual([]);
  });

  it('reports each unknown field once per action, even when written repeatedly', () => {
    const findings = validateActionBodyWrites(
      stackWith(
        "await ctx.api.object('crm_deal').update({ totl: 1 }); " +
          "await ctx.api.object('crm_deal').insert({ totl: 2 });",
      ),
    );
    expect(findings).toHaveLength(1);
  });
});

describe('validateActionBodyWrites — the params surface stays unchecked', () => {
  // `ctx.input` is the action's PARAMS bag, not a record: flagging a declared
  // parameter name against object fields is the false positive that would kill
  // the rule.
  it('ignores ctx.input writes, however they are spelled', () => {
    const findings = validateActionBodyWrites(
      stackWith(
        "ctx.input.not_a_field = 1; ctx.input['also_not'] = 2; ctx.input.count += 1; " +
          'Object.assign(ctx.input, { still_not: 3 });',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('still checks the ctx.api writes of a body that also writes params', () => {
    const findings = validateActionBodyWrites(
      stackWith("ctx.input.whatever = 1; await ctx.api.object('crm_deal').update({ stag: 'won' });"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(ACTION_BODY_WRITE_UNKNOWN_FIELD);
  });
});

describe('validateActionBodyWrites — discarded ctx.record writes (#4345)', () => {
  it('warns on a provably dead snapshot write, declared field or not', () => {
    // `stage` IS declared on crm_deal — and that is the point: the runner hands
    // the body a plain snapshot and never writes it back, so the assignment is
    // discarded either way. A rule that only flagged the undeclared half would
    // imply this one persists.
    const findings = validateActionBodyWrites(stackWith("ctx.record.stage = 'won';"));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(ACTION_RECORD_WRITE_DISCARDED);
    expect(findings[0].where).toBe('action "close_deal" › body');
    expect(findings[0].path).toBe('actions[0].body.source');
    expect(findings[0].message).toContain('ctx.record.stage');
    expect(findings[0].message).toContain('#4345');
    expect(findings[0].hint).toContain('updateById');
  });

  it('reads from ctx.record do not rescue the write', () => {
    const findings = validateActionBodyWrites(
      stackWith("var id = ctx.recordId || ctx.record.id; ctx.record.stage = 'won'; return { ok: true, id: id };"),
    );
    expect(findings.map((f) => f.rule)).toEqual([ACTION_RECORD_WRITE_DISCARDED]);
  });

  it('stays silent when the snapshot is a payload under construction', () => {
    // The legitimate idiom: mutate the snapshot, then persist it. The writes
    // are live, and flagging them would be the false positive that kills an
    // advisory rule.
    expect(
      validateActionBodyWrites(
        stackWith("ctx.record.stage = 'won'; await ctx.api.object('crm_deal').update(ctx.record);"),
      ),
    ).toEqual([]);
    // …and every other way the object can leave the body.
    for (const escape of ['return ctx.record;', 'const r = ctx.record;', 'const c = { ...ctx.record };']) {
      expect(validateActionBodyWrites(stackWith(`ctx.record.stage = 'won'; ${escape}`)), escape).toEqual([]);
    }
  });

  it('reports each field once, and both rule ids from one body', () => {
    const findings = validateActionBodyWrites(
      stackWith(
        "ctx.record.stage = 'won'; ctx.record.stage = 'lost'; ctx.record['amount'] += 1; " +
          "await ctx.api.object('crm_deal').update({ stag: 'won' });",
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual([
      ACTION_RECORD_WRITE_DISCARDED,
      ACTION_RECORD_WRITE_DISCARDED,
      ACTION_BODY_WRITE_UNKNOWN_FIELD,
    ]);
    expect(findings.slice(0, 2).map((f) => f.message.match(/ctx\.record\.(\w+)/)?.[1])).toEqual([
      'stage',
      'amount',
    ]);
  });

  it('stays silent on statically-opaque record writes', () => {
    const findings = validateActionBodyWrites(
      // computed key; nested sub-object write — neither is a literal field write
      stackWith("const k = 'x'; ctx.record[k] = 1; ctx.record.address.city = 'SF';"),
    );
    expect(findings).toEqual([]);
  });
});

describe('validateActionBodyWrites — where action bodies live', () => {
  it('checks object-embedded actions and reports them at their own path', () => {
    const findings = validateActionBodyWrites({
      objects: [
        dealObject,
        {
          ...contactObject,
          actions: [
            {
              name: 'sync_contact',
              label: 'Sync',
              body: { language: 'js', source: "await ctx.api.object('crm_contact').update({ emial: 'x' });" },
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('action "sync_contact" › body');
    expect(findings[0].path).toBe('objects[1].actions[0].body.source');
  });

  it('reports a defineStack-merged action once, at its authored path', () => {
    // `mergeObjectActions` appends the action to its object's `actions` while
    // preserving the top-level entry, so it is reachable twice. Two structurally
    // equal but DISTINCT objects, because that is what the suite actually sees:
    // it runs on the schema-parsed stack, and parsing rebuilds every node — an
    // identity-based dedupe passes a shared-reference fixture and then reports
    // the showcase app's one warning twice.
    const action = () => ({
      name: 'close_deal',
      label: 'Close Deal',
      objectName: 'crm_deal',
      body: { language: 'js', source: "await ctx.api.object('crm_deal').update({ stag: 'won' });" },
    });
    const findings = validateActionBodyWrites({
      objects: [{ ...dealObject, actions: [action()] }],
      actions: [action()],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('actions[0].body.source');
  });

  it('keeps same-named actions on different objects apart', () => {
    // The bound object is part of the dedupe key, so collapsing a merged
    // duplicate never swallows a genuinely separate action.
    const body = { language: 'js', source: "await ctx.api.object('crm_deal').update({ stag: 'won' });" };
    const findings = validateActionBodyWrites({
      objects: [
        { ...dealObject, actions: [{ name: 'sync', label: 'Sync', body }] },
        { ...contactObject, actions: [{ name: 'sync', label: 'Sync', body }] },
      ],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'objects[0].actions[0].body.source',
      'objects[1].actions[0].body.source',
    ]);
  });

  it('accepts map-shaped actions collections (name injected)', () => {
    const findings = validateActionBodyWrites({
      objects: [dealObject],
      actions: {
        close_deal: {
          label: 'Close Deal',
          body: { language: 'js', source: "await ctx.api.object('crm_deal').update({ stag: 'won' });" },
        },
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('action "close_deal" › body');
  });

  // [#4352] The inversion of #4344's original assertion. That test pinned
  // "checks a body on a non-script action — the runtime binds one regardless of
  // `type`", which was true of the runtime at the time and was recorded as
  // provisional. The ruling closed the gap at the producer instead: the body
  // no longer binds (`actionBodyRunnerFactory`) and the pair no longer
  // publishes (`ActionSchema`). Nothing runs, so there is no write set to
  // advise about — and a finding here would point at the write when the defect
  // is the `type`.
  it('skips a body on a non-script action — nothing binds it, so there is no write to check', () => {
    const findings = validateActionBodyWrites(
      stackWith("await ctx.api.object('crm_deal').update({ stag: 'won' });", { type: 'url', target: '/x' }),
    );
    expect(findings).toEqual([]);
  });

  it('still checks a body on an action that omits `type` — the spec default is `script`', () => {
    const findings = validateActionBodyWrites(
      stackWith("await ctx.api.object('crm_deal').update({ stag: 'won' });"),
    );
    expect(findings).toHaveLength(1);
  });

  it('still checks a body on an explicit `type: "script"` action', () => {
    const findings = validateActionBodyWrites(
      stackWith("await ctx.api.object('crm_deal').update({ stag: 'won' });", { type: 'script' }),
    );
    expect(findings).toHaveLength(1);
  });
});

describe('validateActionBodyWrites — scope and shape tolerance', () => {
  it('ignores actions with no body, L1 expression bodies, and empty sources', () => {
    expect(
      validateActionBodyWrites({
        objects: [dealObject],
        actions: [
          { name: 'a', label: 'A', type: 'flow', target: 'some_flow' },
          { name: 'b', label: 'B', body: { language: 'expression', source: 'input.amount > 0' } },
          { name: 'c', label: 'C', body: { language: 'js', source: '   ' } },
        ],
      }),
    ).toEqual([]);
  });

  it('returns [] for stacks with no actions at all', () => {
    expect(validateActionBodyWrites({})).toEqual([]);
    expect(validateActionBodyWrites({ actions: [] })).toEqual([]);
    expect(validateActionBodyWrites({ objects: [dealObject] })).toEqual([]);
  });

  it('does not throw on source with syntax errors — fewer matches, never a crash', () => {
    expect(() =>
      validateActionBodyWrites(stackWith("await ctx.api.object('crm_deal').update({ stag: ; if (")),
    ).not.toThrow();
  });
});

// ─── [#8663] Unprovisioned injected anchors on the WRITE axis ────────────────
//
// This rule shares IMPLICIT_FIELDS with the hook rule, so it shared the set's
// object-independence too: on an ADR-0015 `external` object the injected anchor
// is registered but has no column behind it. See the hook rule's test block for
// the measured runtime chain the diagnostic's wording reports.
const federatedObject = {
  name: 'wh_order',
  datasource: 'warehouse',
  external: { remoteName: 'fact_orders' },
  fields: { order_id: { type: 'text' }, amount: { type: 'number' } },
};
const localTwin = { name: 'wh_order', fields: { order_id: { type: 'text' }, amount: { type: 'number' } } };

function actionStackOver(object: Record<string, unknown>, source: string) {
  return {
    objects: [object],
    actions: [{ name: 'stamp_owner', label: 'Stamp', objectName: 'wh_order', body: { language: 'js', source } }],
  };
}

describe('[#8663] validateActionBodyWrites — unprovisioned anchor writes', () => {
  it('warns when an action body writes an anchor the federated object has no storage for', () => {
    const findings = validateActionBodyWrites(
      actionStackOver(federatedObject, "await ctx.api.object('wh_order').updateById(ctx.recordId, { owner_id: ctx.user.id });"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(ACTION_BODY_WRITE_UNPROVISIONED_ANCHOR);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].where).toBe('action "stamp_owner" › body');
    expect(findings[0].path).toBe('actions[0].body.source');
    expect(findings[0].message).toContain("'owner_id'");
    expect(findings[0].message).toContain('external object (ADR-0015)');
    expect(findings[0].message).toContain('can never land');
  });

  it('the same write without the external binding is silent', () => {
    expect(
      validateActionBodyWrites(
        actionStackOver(localTwin, "await ctx.api.object('wh_order').updateById(ctx.recordId, { owner_id: ctx.user.id });"),
      ),
    ).toEqual([]);
  });

  it('an author-declared column of the same name is never flagged', () => {
    const declared = { ...federatedObject, fields: { ...federatedObject.fields, owner_id: { type: 'text' } } };
    expect(
      validateActionBodyWrites(
        actionStackOver(declared, "await ctx.api.object('wh_order').updateById(ctx.recordId, { owner_id: ctx.user.id });"),
      ),
    ).toEqual([]);
  });
});
