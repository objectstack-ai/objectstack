// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Both directions of the #13653 judgement, pinned together on purpose.
//
// The rule's whole risk is that it over-fires. `readonly` + a `beforeInsert`/
// `beforeUpdate` stamp is a CORRECT and widely used pairing (the strip drops
// only caller-supplied values, #5591), so a naive "readonly field appears in a
// write set" rule would fail the correct shape on day one and be switched off
// by the first author who met it. Every RED case below therefore has a GREEN
// twin that differs ONLY in the write channel.
import { describe, expect, it } from 'vitest';

import { HOOK_BODY_WRITE_PATTERNS } from './validate-hook-body-writes.js';
import {
  validateReadonlyHookWrites,
  HOOK_API_UPDATE_READONLY_FIELD,
  HOOK_API_UPDATE_READONLY_WHEN_FIELD,
  READONLY_HOOK_WRITE_PATTERN_IDS,
  READONLY_HOOK_WRITE_EXCLUSIONS,
} from './validate-readonly-hook-writes.js';

/**
 * A stack shaped like the reference app's motivating case (#13653): a derived
 * column another object's hook maintains. `last_activity_date` is the field
 * whose `readonly` flag made the churn report count every account as silent.
 *
 * The six motivating fields live in `objectstack-ai/hotcrm`, which this repo's
 * CI cannot reach, so the shape is reproduced here rather than referenced.
 */
const crmStack = (source: string, opts: { hookObject?: string } = {}) => ({
  objects: [
    {
      name: 'crm_account',
      fields: {
        name: { type: 'text', label: 'Name' },
        // The outage field: automation must maintain it, users must not edit it.
        last_activity_date: { type: 'datetime', label: 'Last activity', readonly: true },
        // The CORRECT pairing from the same app: `readonly` + an own-hook stamp.
        name_normalized: { type: 'text', label: 'Normalized', readonly: true },
        // Writable by anyone - the control that proves the rule keys on the
        // declaration and not merely on the channel.
        notes: { type: 'text', label: 'Notes' },
        // Conditionally locked - a different shape with a different verdict.
        credit_hold: { type: 'boolean', label: 'Credit hold', readonlyWhen: 'status == "closed"' },
      },
    },
    {
      name: 'crm_case',
      fields: {
        subject: { type: 'text', label: 'Subject' },
        first_response_date: { type: 'datetime', label: 'First response', readonly: true },
      },
    },
  ],
  hooks: [
    {
      name: 'touch_account',
      object: opts.hookObject ?? 'crm_case',
      events: ['afterInsert'],
      body: { language: 'js', source },
    },
  ],
});

describe('validateReadonlyHookWrites - RED: a ctx.api write to a readonly field', () => {
  it('flags ctx.api.object(...).update() writing a static-readonly field', () => {
    const findings = validateReadonlyHookWrites(
      crmStack("await ctx.api.object('crm_account').update({ id: accountId, last_activity_date: now });"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(HOOK_API_UPDATE_READONLY_FIELD);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].where).toBe('hook "touch_account" > body');
    expect(findings[0].path).toBe('hooks[0].body.source');
    expect(findings[0].message).toContain("'last_activity_date'");
    expect(findings[0].message).toContain('crm_account');
    // The remedy must name BOTH legitimate channels, not only sudo - telling an
    // author to elevate is a security-relevant instruction, and the own-hook
    // stamp is the shape that needs no elevation at all.
    expect(findings[0].hint).toContain('ctx.input.last_activity_date');
    expect(findings[0].hint).toContain('sudo');
  });

  it('flags updateById, whose payload is argument 1', () => {
    const findings = validateReadonlyHookWrites(
      crmStack("await ctx.api.object('crm_account').updateById(accountId, { last_activity_date: now });"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(HOOK_API_UPDATE_READONLY_FIELD);
    expect(findings[0].severity).toBe('error');
  });

  it('flags a write to the hook OWN object, not just another object', () => {
    // The card's motivating shape is "another object's hook", but the engine
    // does not care whose object it is: a fresh ctx.api operation is a fresh
    // non-elevated caller either way.
    const findings = validateReadonlyHookWrites(
      crmStack(
        "await ctx.api.object('crm_case').update({ id: ctx.recordId, first_response_date: now });",
        { hookObject: 'crm_case' },
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("'first_response_date'");
  });

  it('flags each distinct readonly field once, however many times it is written', () => {
    const findings = validateReadonlyHookWrites(
      crmStack(
        "await ctx.api.object('crm_account').update({ last_activity_date: a }); " +
          "await ctx.api.object('crm_account').update({ last_activity_date: b });",
      ),
    );
    expect(findings).toHaveLength(1);
  });

  it('reads the array `fields` authoring shape as well as the map shape', () => {
    const findings = validateReadonlyHookWrites({
      objects: [
        {
          name: 'crm_account',
          fields: [
            { name: 'name', type: 'text' },
            { name: 'last_activity_date', type: 'datetime', readonly: true },
          ],
        },
      ],
      hooks: [
        {
          name: 'touch',
          object: 'crm_case',
          events: ['afterInsert'],
          body: {
            language: 'js',
            source: "await ctx.api.object('crm_account').update({ last_activity_date: now });",
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(HOOK_API_UPDATE_READONLY_FIELD);
  });
});

describe('validateReadonlyHookWrites - GREEN: the correct readonly + before-hook pairing', () => {
  // THE case this rule exists not to break. Zone 1 of the dispatch order and
  // the card both single it out: a blanket write-set rule turns these into a
  // noise gate on day one.
  it('never flags a ctx.input stamp of a readonly field', () => {
    expect(
      validateReadonlyHookWrites(
        crmStack("ctx.input.name_normalized = ctx.input.name.toLowerCase();", {
          hookObject: 'crm_account',
        }),
      ),
    ).toEqual([]);
  });

  it('never flags a ctx.input stamp written through element access or a compound operator', () => {
    expect(
      validateReadonlyHookWrites(
        crmStack(
          "ctx.input['last_activity_date'] = now; ctx.input.name_normalized ??= 'x';",
          { hookObject: 'crm_account' },
        ),
      ),
    ).toEqual([]);
  });

  it('never flags Object.assign(ctx.input, ...) stamping readonly fields', () => {
    expect(
      validateReadonlyHookWrites(
        crmStack("Object.assign(ctx.input, { last_activity_date: now, name_normalized: n });", {
          hookObject: 'crm_account',
        }),
      ),
    ).toEqual([]);
  });

  it('stays silent on a body that mixes a correct stamp with an unrelated api read', () => {
    expect(
      validateReadonlyHookWrites(
        crmStack(
          "const rows = await ctx.api.object('crm_account').find({}); " +
            "ctx.input.name_normalized = rows.length;",
          { hookObject: 'crm_account' },
        ),
      ),
    ).toEqual([]);
  });
});

describe('validateReadonlyHookWrites - GREEN: the elevated channel', () => {
  // `ScopedContext.sudo()` sets isSystem, which the strip skips entirely - the
  // hook-side analogue of a flow's runAs:'system'. The extractor's
  // `api-crud-literal` matcher requires a literal `ctx.api` receiver, so a
  // sudo chain yields no write at all. This test is what turns that from a
  // reading of the extractor into a measured guarantee: if a future extractor
  // change starts seeing through `.sudo()`, this rule would begin gating the
  // one channel the platform recommends, and this case fails first.
  it('never flags ctx.api.sudo().object(...).update()', () => {
    expect(
      validateReadonlyHookWrites(
        crmStack("await ctx.api.sudo().object('crm_account').update({ last_activity_date: now });"),
      ),
    ).toEqual([]);
  });
});

describe('validateReadonlyHookWrites - GREEN: INSERT is engine-exempt', () => {
  // A create may legitimately seed read-only columns: the engine's static
  // readonly strip is deliberately absent from the insert path (#3043/#3413),
  // which is the same reason the flow sibling never reads a create_record node.
  it('never flags insert()', () => {
    expect(
      validateReadonlyHookWrites(
        crmStack("await ctx.api.object('crm_account').insert({ last_activity_date: now });"),
      ),
    ).toEqual([]);
  });

  it('never flags create()', () => {
    expect(
      validateReadonlyHookWrites(
        crmStack("await ctx.api.object('crm_account').create({ last_activity_date: now });"),
      ),
    ).toEqual([]);
  });
});

describe('validateReadonlyHookWrites - GREEN: nothing statically knowable is guessed', () => {
  it('skips a dynamic object name', () => {
    expect(
      validateReadonlyHookWrites(
        crmStack("await ctx.api.object(target).update({ last_activity_date: now });"),
      ),
    ).toEqual([]);
  });

  it('skips an object this stack does not declare', () => {
    expect(
      validateReadonlyHookWrites(
        crmStack("await ctx.api.object('other_pkg_object').update({ last_activity_date: now });"),
      ),
    ).toEqual([]);
  });

  it('skips an object that declares no fields at all (external / introspected)', () => {
    // An empty field map answers has(anything) === false, which would read as
    // "no such field" for every key - the #4383 false-positive generator.
    expect(
      validateReadonlyHookWrites({
        objects: [{ name: 'ext_account', fields: {} }],
        hooks: [
          {
            name: 'touch',
            object: 'crm_case',
            events: ['afterInsert'],
            body: {
              language: 'js',
              source: "await ctx.api.object('ext_account').update({ last_activity_date: now });",
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('leaves a field the object does not declare to the unknown-field rule', () => {
    expect(
      validateReadonlyHookWrites(
        crmStack("await ctx.api.object('crm_account').update({ no_such_column: 1 });"),
      ),
    ).toEqual([]);
  });

  it('never flags a writable field', () => {
    expect(
      validateReadonlyHookWrites(crmStack("await ctx.api.object('crm_account').update({ notes: 'x' });")),
    ).toEqual([]);
  });

  it("treats `id` in an update payload as the row ADDRESS, not a field write (#8141)", () => {
    // The engine strips the address key and then deliberately does NOT log it:
    // the caller did not forge it and lost nothing. Reporting it here would
    // restate exactly the claim #8141 removed.
    expect(
      validateReadonlyHookWrites({
        objects: [{ name: 'crm_account', fields: { id: { type: 'text', readonly: true }, name: { type: 'text' } } }],
        hooks: [
          {
            name: 'touch',
            object: 'crm_case',
            events: ['afterInsert'],
            body: { language: 'js', source: "await ctx.api.object('crm_account').update({ id: accountId });" },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('stays silent on an unparseable body, leaving it to hook-body-source-unparseable', () => {
    // A gating rule must not break a build off a partially recovered tree.
    expect(
      validateReadonlyHookWrites(
        crmStack("await ctx.api.object('crm_account').update({ last_activity_date: now }); if ("),
      ),
    ).toEqual([]);
  });

  it('ignores an L1 handler hook and a non-js body', () => {
    expect(
      validateReadonlyHookWrites({
        objects: [{ name: 'crm_account', fields: { last_activity_date: { type: 'datetime', readonly: true } } }],
        hooks: [
          { name: 'l1', object: 'crm_case', events: ['afterInsert'] },
          {
            name: 'other_lang',
            object: 'crm_case',
            events: ['afterInsert'],
            body: { language: 'cel', source: "ctx.api.object('crm_account').update({ last_activity_date: 1 })" },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('returns nothing for a stack with no hooks', () => {
    expect(validateReadonlyHookWrites({ objects: [] })).toEqual([]);
    expect(validateReadonlyHookWrites({})).toEqual([]);
  });
});

describe('validateReadonlyHookWrites - readonlyWhen is a SECOND shape, not the same verdict', () => {
  // #9107: readonlyWhen strips per record STATE, and it strips a
  // beforeUpdate-derived value too. So the write is conditional, not certain -
  // warning, exactly as the flow sibling grades it.
  it('grades a readonlyWhen field as an advisory warning, not an error', () => {
    const findings = validateReadonlyHookWrites(
      crmStack("await ctx.api.object('crm_account').update({ credit_hold: true });"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(HOOK_API_UPDATE_READONLY_WHEN_FIELD);
    expect(findings[0].severity).toBe('warning');
    // The own-hook stamp is NOT the remedy here, and the hint must not offer it.
    expect(findings[0].hint).not.toContain('ctx.input.credit_hold');
    expect(findings[0].hint).toContain('sudo');
  });

  it('reports a field carrying BOTH flags as the certain (static readonly) finding', () => {
    const findings = validateReadonlyHookWrites({
      objects: [
        {
          name: 'crm_account',
          fields: { locked: { type: 'boolean', readonly: true, readonlyWhen: 'status == "closed"' } },
        },
      ],
      hooks: [
        {
          name: 'touch',
          object: 'crm_case',
          events: ['afterInsert'],
          body: { language: 'js', source: "await ctx.api.object('crm_account').update({ locked: true });" },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(HOOK_API_UPDATE_READONLY_FIELD);
    expect(findings[0].severity).toBe('error');
  });
});

describe('READONLY_HOOK_WRITE_PATTERN_IDS - ledger partition', () => {
  // The declared answer to "which shared hook write shapes does this rule
  // judge?". Their union must BE the shared ledger, so a fifth pattern landing
  // on the hook side fails here until someone classifies it - rather than
  // being silently assumed into (or out of) a gating rule.
  it('partitions the shared hook ledger exactly - no phantom, no unclassified id', () => {
    const shared = HOOK_BODY_WRITE_PATTERNS.map((p) => p.id).sort();
    const classified = [
      ...READONLY_HOOK_WRITE_PATTERN_IDS,
      ...READONLY_HOOK_WRITE_EXCLUSIONS.map((e) => e.id),
    ].sort();
    expect(classified).toEqual(shared);
  });

  it('assigns each ledger shape to exactly one side', () => {
    const excluded = READONLY_HOOK_WRITE_EXCLUSIONS.map((e) => e.id);
    expect(READONLY_HOOK_WRITE_PATTERN_IDS.filter((id) => excluded.includes(id))).toEqual([]);
  });

  it('gives every exclusion a non-empty reason', () => {
    for (const exclusion of READONLY_HOOK_WRITE_EXCLUSIONS) {
      expect(exclusion.reason.length, `exclusion '${exclusion.id}' carries no reason`).toBeGreaterThan(0);
    }
  });

  it('consumes only the ctx.api shape - every excluded shape stays green on a readonly field', () => {
    // Drives the exclusion ledger rather than restating it: each excluded
    // pattern's own canonical example is run against a stack where every field
    // it writes is declared readonly. A rule that started consuming one of them
    // would light up here.
    for (const pattern of HOOK_BODY_WRITE_PATTERNS) {
      if (READONLY_HOOK_WRITE_PATTERN_IDS.includes(pattern.id)) continue;
      const fields = Object.fromEntries(
        pattern.example.writes.map((w) => [w.field, { type: 'text', readonly: true }]),
      );
      const objectNames = [
        ...new Set(pattern.example.writes.map((w) => w.object).filter((o): o is string => typeof o === 'string')),
      ];
      const findings = validateReadonlyHookWrites({
        objects: [
          { name: 'crm_case', fields },
          ...objectNames.map((name) => ({ name, fields })),
        ],
        hooks: [
          {
            name: 'probe',
            object: 'crm_case',
            events: ['beforeUpdate'],
            body: { language: 'js', source: pattern.example.source },
          },
        ],
      });
      expect(findings, `excluded pattern '${pattern.id}' produced a finding`).toEqual([]);
    }
  });
});
