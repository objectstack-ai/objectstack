// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Both directions of the #13770 judgement, pinned together — plus the ONE case
// that separates this rule from its hook sibling.
//
// The action surface differs from the hook surface in exactly one way that
// matters here, and it is measurable rather than arguable: an action body's
// `ctx.api` is `ql.createContext(buildActionExecutionContext(ec))` and
// `buildActionExecutionContext` is `{ ...ec, isSystem: true }`, so an action
// body runs ELEVATED. Driving a real ObjectQL engine over a memory driver with
// exactly that context:
//
//   [action ctx.api]  static readonly  -> the value LANDS
//   [action ctx.api]  readonlyWhen     -> the value is STRIPPED
//   [ctx.api.sudo()]  readonlyWhen     -> still STRIPPED
//
// which is the engine's own documented asymmetry: the static strip runs under
// `if (!opCtx.context?.isSystem)`, the conditional one does not and takes no
// `isSystem` exemption at all (#9107 LOCK 2). So this rule reports the
// conditional shape and deliberately says NOTHING about the static one — a
// static-`readonly` finding here would tell an author their write never lands
// when it does. `flags nothing on a static readonly field` below is that
// measurement's pin: if the engine ever stops exempting system callers, this is
// the test that should be revisited first.
//
// [#14147] The engine DID change on one axis and this table did not move: the
// static strip now runs on the CREATE path too, under the same `isSystem` gate.
// An action body is elevated on both verbs, so every row above is unchanged —
// what changed is that "INSERT is exempt" stopped being a true reason for
// anything, which the INSERT block at the bottom of this file now pins.
import { describe, expect, it } from 'vitest';

import { HOOK_BODY_WRITE_PATTERNS } from './validate-hook-body-writes.js';
import {
  validateReadonlyActionWrites,
  ACTION_API_UPDATE_READONLY_WHEN_FIELD,
  READONLY_ACTION_WRITE_PATTERN_IDS,
  READONLY_ACTION_WRITE_EXCLUSIONS,
  READONLY_ACTION_INSERT_SILENCE,
} from './validate-readonly-action-writes.js';

/**
 * A stack shaped like the shipped showcase invoice (a state lock: once an
 * invoice is paid its money columns freeze), reproduced here rather than
 * imported — tests do not read `examples/**`, so an example-app sweep can never
 * pull a fixture out from under a rule (maintainer ruling, 2026-08-13).
 */
const invoiceStack = (source: string) => ({
  objects: [
    {
      name: 'showcase_invoice',
      fields: {
        // Writable by anyone — the control that proves the rule keys on the
        // declaration and not merely on the channel.
        status: { type: 'text', label: 'Status' },
        // Conditionally locked: the shape this rule reports.
        tax_rate: { type: 'number', label: 'Tax rate', readonlyWhen: "record.status == 'paid'" },
        // Statically locked: the shape this rule deliberately stays silent on,
        // because an elevated action write LANDS on it.
        invoice_number: { type: 'text', label: 'Invoice number', readonly: true },
      },
    },
  ],
  actions: [
    {
      name: 'settle_invoice',
      label: 'Settle',
      objectName: 'showcase_invoice',
      body: { language: 'js', source },
    },
  ],
});

describe('validateReadonlyActionWrites - RED: a ctx.api write to a readonlyWhen field', () => {
  it('flags ctx.api.object(...).update() writing a readonlyWhen field', () => {
    const findings = validateReadonlyActionWrites(
      invoiceStack("await ctx.api.object('showcase_invoice').update({ id: ctx.recordId, tax_rate: 8 });"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(ACTION_API_UPDATE_READONLY_WHEN_FIELD);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].where).toBe('action "settle_invoice" > body');
    expect(findings[0].path).toBe('actions[0].body.source');
    expect(findings[0].message).toContain("'tax_rate'");
    expect(findings[0].message).toContain('showcase_invoice');
  });

  it('flags updateById, whose payload is argument 1', () => {
    const findings = validateReadonlyActionWrites(
      invoiceStack("await ctx.api.object('showcase_invoice').updateById(ctx.recordId, { tax_rate: 8 });"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(ACTION_API_UPDATE_READONLY_WHEN_FIELD);
  });

  it('does NOT offer elevation as the remedy — the action body is already elevated', () => {
    // The measured difference from the hook sibling's hint. An action body runs
    // under `{ ...ec, isSystem: true }` and the readonlyWhen lock still applies,
    // so telling this author to reach for `sudo()` would send them at a change
    // that provably does nothing.
    const [finding] = validateReadonlyActionWrites(
      invoiceStack("await ctx.api.object('showcase_invoice').update({ tax_rate: 8 });"),
    );
    expect(finding.hint).toContain('already system-elevated');
    expect(finding.hint).toContain('changes nothing');
    // The two remedies that DO work, both named.
    expect(finding.hint).toContain('predicate is FALSE');
    expect(finding.hint).toContain('beforeUpdate hook');
  });

  it('reaches an action declared on an object as well as a top-level one', () => {
    // The positive control for the shared walk: `collectActionBodies` registers
    // BOTH sites the runtime reads (`bundle.actions` and `objects[].actions`),
    // and a rule that only saw the first would be silently half-blind.
    const findings = validateReadonlyActionWrites({
      objects: [
        {
          name: 'showcase_invoice',
          fields: { tax_rate: { type: 'number', readonlyWhen: "record.status == 'paid'" } },
          actions: [
            {
              name: 'freeze',
              body: {
                language: 'js',
                source: "await ctx.api.object('showcase_invoice').update({ tax_rate: 0 });",
              },
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('action "freeze" > body');
    expect(findings[0].path).toBe('objects[0].actions[0].body.source');
  });

  it('reports a merged action ONCE, not once per registration site', () => {
    // `mergeObjectActions` appends the action to its object's array while
    // PRESERVING the top-level entry, so the same body is genuinely reachable
    // twice. The shared walk collapses it by value and reports the authored
    // location; a rule that re-implemented the walk would double-report here.
    const body = {
      language: 'js',
      source: "await ctx.api.object('showcase_invoice').update({ tax_rate: 8 });",
    };
    const findings = validateReadonlyActionWrites({
      objects: [
        {
          name: 'showcase_invoice',
          fields: { tax_rate: { type: 'number', readonlyWhen: "record.status == 'paid'" } },
          actions: [{ name: 'settle', objectName: 'showcase_invoice', body }],
        },
      ],
      actions: [{ name: 'settle', objectName: 'showcase_invoice', body }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('actions[0].body.source');
  });

  it('flags each distinct readonlyWhen field once, however many times it is written', () => {
    const findings = validateReadonlyActionWrites(
      invoiceStack(
        "await ctx.api.object('showcase_invoice').update({ tax_rate: 1 }); " +
          "await ctx.api.object('showcase_invoice').update({ tax_rate: 2 });",
      ),
    );
    expect(findings).toHaveLength(1);
  });

  it('reads the array `fields` authoring shape as well as the map shape', () => {
    const findings = validateReadonlyActionWrites({
      objects: [
        {
          name: 'showcase_invoice',
          fields: [
            { name: 'status', type: 'text' },
            { name: 'tax_rate', type: 'number', readonlyWhen: "record.status == 'paid'" },
          ],
        },
      ],
      actions: [
        {
          name: 'settle',
          body: {
            language: 'js',
            source: "await ctx.api.object('showcase_invoice').update({ tax_rate: 8 });",
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
  });
});

describe('validateReadonlyActionWrites - the STATIC readonly half is deliberately absent', () => {
  it('flags nothing on a static readonly field — an elevated action write LANDS', () => {
    // THE measurement this rule is shaped by, stated as a test rather than as
    // prose. Driving a real ObjectQL engine with the context an action body
    // actually gets — `{ userId, tenantId, isSystem: true }`, the output of
    // `buildActionExecutionContext` — a write to a `readonly: true` column
    // persists, because the engine's static strip runs only under
    // `if (!opCtx.context?.isSystem)`. Reporting it would state a falsehood and
    // (at the hook rule's `error` grade) would gate a build over working code.
    expect(
      validateReadonlyActionWrites(
        invoiceStack("await ctx.api.object('showcase_invoice').update({ invoice_number: 'INV-1' });"),
      ),
    ).toEqual([]);
  });

  it('reports a field carrying BOTH flags, since the conditional lock still applies', () => {
    // `isSystem` exempts the static strip but not the conditional one, so a
    // field with both declarations is still conditionally dropped — the one
    // place the two halves do not simply cancel.
    const findings = validateReadonlyActionWrites({
      objects: [
        {
          name: 'showcase_invoice',
          fields: {
            locked: { type: 'boolean', readonly: true, readonlyWhen: "record.status == 'paid'" },
          },
        },
      ],
      actions: [
        {
          name: 'settle',
          body: {
            language: 'js',
            source: "await ctx.api.object('showcase_invoice').update({ locked: true });",
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(ACTION_API_UPDATE_READONLY_WHEN_FIELD);
    expect(findings[0].severity).toBe('warning');
  });
});

describe('validateReadonlyActionWrites - GREEN: ctx.record is not a write channel', () => {
  // The card's named must-answer, raised by triage to a hard requirement:
  // an action's `ctx.record` is a dead snapshot the runtime never writes back,
  // so no readonly strip is ever consulted on it and a readonly verdict there
  // would be a false positive on every occurrence. `action-record-write-discarded`
  // owns that shape and states the true reason.
  it('never flags a ctx.record assignment to a readonlyWhen field', () => {
    expect(
      validateReadonlyActionWrites(invoiceStack("ctx.record.tax_rate = 8;")),
    ).toEqual([]);
  });

  it('never flags a ctx.record assignment to a static readonly field', () => {
    expect(
      validateReadonlyActionWrites(invoiceStack("ctx.record['invoice_number'] = 'INV-1';")),
    ).toEqual([]);
  });

  it('stays silent even when ctx.record ESCAPES into a live api write', () => {
    // The escaping shape is the one where a record mutation really does reach
    // the engine — and it is still not this rule's finding, because the payload
    // is an identifier rather than a literal, so no field name is statically
    // knowable. A missed finding, never a false one: the alternative is
    // guessing which of the snapshot's keys the update carried.
    expect(
      validateReadonlyActionWrites(
        invoiceStack(
          "ctx.record.tax_rate = 8; await ctx.api.object('showcase_invoice').update(ctx.record);",
        ),
      ),
    ).toEqual([]);
  });
});

describe('validateReadonlyActionWrites - GREEN: ctx.input is the params bag', () => {
  it('never flags ctx.input writes, whatever the name collides with', () => {
    expect(
      validateReadonlyActionWrites(invoiceStack("ctx.input.tax_rate = 8; ctx.input['invoice_number'] = 'x';")),
    ).toEqual([]);
  });

  it('never flags Object.assign(ctx.input, ...)', () => {
    expect(
      validateReadonlyActionWrites(invoiceStack("Object.assign(ctx.input, { tax_rate: 8 });")),
    ).toEqual([]);
  });
});

describe('validateReadonlyActionWrites - the INSERT silence is a REASONED refusal, not a gap', () => {
  // [#14147] This block used to be titled "INSERT is exempt from both strips"
  // and rested on exactly that sentence. The maintainer ruling of 2026-09-03
  // (option C) SUPERSEDED it: `engine.insert` now runs the static-`readonly`
  // strip for a non-system caller, `isSystem`-gated, exactly as `engine.update`
  // does, and the metadata-protocol boundary copy the old reason cited is
  // deleted. A green case whose justification has been overturned is
  // indistinguishable from a scan gap, so the verdicts below are kept — they
  // are still TRUE — and the REASON is pinned alongside them.
  //
  // Re-measured after the ruling, on the harness this file's header describes:
  // an ELEVATED insert seeding a `readonly` AND a `readonlyWhen`-locked column
  // still keeps both values, because `buildActionExecutionContext` is
  // `{ ...ec, isSystem: true }`. That is a fact about elevation, not INSERT.

  it('pins WHY it refuses to report on insert/create — and that neither reason is the superseded one', () => {
    expect(READONLY_ACTION_INSERT_SILENCE.methods).toEqual(['insert', 'create']);
    expect(READONLY_ACTION_INSERT_SILENCE.reasons.map((r) => r.id)).toEqual([
      'conditional-lock-has-no-prior-record',
      'action-body-is-system-elevated',
    ]);
    for (const { reason } of READONLY_ACTION_INSERT_SILENCE.reasons) {
      expect(reason.length, 'a refusal with no stated reason is a gap').toBeGreaterThan(40);
      // The refusal pin proper: the overturned sentence may never come back as
      // the justification, in any of its spellings.
      expect(reason).not.toMatch(/INSERT is exempt/i);
      expect(reason).not.toMatch(/exempt from both strips/i);
    }
    // ...and one of them must still name the surviving engine fact, so a future
    // author cannot read the silence as "the engine does not strip on create".
    expect(READONLY_ACTION_INSERT_SILENCE.reasons.map((r) => r.reason).join(' '))
      .toContain('isSystem: true');
  });

  it('never flags insert() — the conditional lock has no prior record on a create', () => {
    expect(
      validateReadonlyActionWrites(
        invoiceStack("await ctx.api.object('showcase_invoice').insert({ tax_rate: 8 });"),
      ),
    ).toEqual([]);
  });

  it('never flags create() — same, and the static half is skipped by ELEVATION, not by INSERT', () => {
    expect(
      validateReadonlyActionWrites(
        invoiceStack("await ctx.api.object('showcase_invoice').create({ invoice_number: 'INV-1' });"),
      ),
    ).toEqual([]);
  });
});

describe('validateReadonlyActionWrites - GREEN: nothing statically unknowable is guessed', () => {
  it('skips a sudo chain (structurally invisible to the extractor)', () => {
    // Not a remedy on this surface — the body is elevated already — but the
    // shape must stay silent for the same structural reason it does on the hook
    // side: `api-crud-literal` requires a literal `ctx.api` receiver.
    expect(
      validateReadonlyActionWrites(
        invoiceStack("await ctx.api.sudo().object('showcase_invoice').update({ tax_rate: 8 });"),
      ),
    ).toEqual([]);
  });

  it('skips a dynamic object name', () => {
    expect(
      validateReadonlyActionWrites(invoiceStack("await ctx.api.object(target).update({ tax_rate: 8 });")),
    ).toEqual([]);
  });

  it('skips an object this stack does not declare', () => {
    expect(
      validateReadonlyActionWrites(
        invoiceStack("await ctx.api.object('other_pkg_object').update({ tax_rate: 8 });"),
      ),
    ).toEqual([]);
  });

  it('skips an object that declares no fields at all (external / introspected)', () => {
    // An empty field map answers has(anything) === false, which would read as
    // "no such field" for every key — the #4383 false-positive generator.
    expect(
      validateReadonlyActionWrites({
        objects: [{ name: 'ext_invoice', fields: {} }],
        actions: [
          {
            name: 'settle',
            body: {
              language: 'js',
              source: "await ctx.api.object('ext_invoice').update({ tax_rate: 8 });",
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('leaves a field the object does not declare to the unknown-field rule', () => {
    expect(
      validateReadonlyActionWrites(
        invoiceStack("await ctx.api.object('showcase_invoice').update({ no_such_column: 1 });"),
      ),
    ).toEqual([]);
  });

  it('never flags a writable field', () => {
    expect(
      validateReadonlyActionWrites(
        invoiceStack("await ctx.api.object('showcase_invoice').update({ status: 'paid' });"),
      ),
    ).toEqual([]);
  });

  it('treats `id` in an update payload as the row ADDRESS, not a field write (#8141)', () => {
    expect(
      validateReadonlyActionWrites({
        objects: [
          {
            name: 'showcase_invoice',
            fields: {
              id: { type: 'text', readonlyWhen: "record.status == 'paid'" },
              status: { type: 'text' },
            },
          },
        ],
        actions: [
          {
            name: 'settle',
            body: {
              language: 'js',
              source: "await ctx.api.object('showcase_invoice').update({ id: invoiceId });",
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('still judges `id` when it is the PAYLOAD of updateById, not the address', () => {
    // `updateById(id, data)` addresses the row in argument 0, so an `id` key in
    // argument 1 is an ordinary field write and the address exclusion must not
    // swallow it.
    const findings = validateReadonlyActionWrites({
      objects: [
        {
          name: 'showcase_invoice',
          fields: { id: { type: 'text', readonlyWhen: "record.status == 'paid'" } },
        },
      ],
      actions: [
        {
          name: 'settle',
          body: {
            language: 'js',
            source: "await ctx.api.object('showcase_invoice').updateById(x, { id: 'forged' });",
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
  });

  it('stays silent on an unparseable body, leaving it to action-body-source-unparseable', () => {
    expect(
      validateReadonlyActionWrites(
        invoiceStack("await ctx.api.object('showcase_invoice').update({ tax_rate: 8 }); if ("),
      ),
    ).toEqual([]);
  });

  it('ignores a non-script action, a non-js body and a body-less action', () => {
    expect(
      validateReadonlyActionWrites({
        objects: [
          {
            name: 'showcase_invoice',
            fields: { tax_rate: { type: 'number', readonlyWhen: "record.status == 'paid'" } },
          },
        ],
        actions: [
          { name: 'declarative', type: 'flow', body: { language: 'js', source: "ctx.api.object('showcase_invoice').update({ tax_rate: 8 })" } },
          { name: 'other_lang', body: { language: 'cel', source: "ctx.api.object('showcase_invoice').update({ tax_rate: 8 })" } },
          { name: 'handler_backed' },
        ],
      }),
    ).toEqual([]);
  });

  it('returns nothing for a stack with no actions', () => {
    expect(validateReadonlyActionWrites({ objects: [] })).toEqual([]);
    expect(validateReadonlyActionWrites({})).toEqual([]);
  });
});

describe('READONLY_ACTION_WRITE_PATTERN_IDS - ledger partition', () => {
  // The declared answer to "which shared body write shapes does this rule
  // judge?". Their union must BE the shared ledger, so a fifth pattern landing
  // on the hook side fails here until someone classifies it — rather than being
  // silently assumed into (or out of) this rule.
  it('partitions the shared body-write ledger exactly - no phantom, no unclassified id', () => {
    const shared = HOOK_BODY_WRITE_PATTERNS.map((p) => p.id).sort();
    const classified = [
      ...READONLY_ACTION_WRITE_PATTERN_IDS,
      ...READONLY_ACTION_WRITE_EXCLUSIONS.map((e) => e.id),
    ].sort();
    expect(classified).toEqual(shared);
  });

  it('assigns each ledger shape to exactly one side', () => {
    const excluded = READONLY_ACTION_WRITE_EXCLUSIONS.map((e) => e.id);
    expect(READONLY_ACTION_WRITE_PATTERN_IDS.filter((id) => excluded.includes(id))).toEqual([]);
  });

  it('gives every exclusion a non-empty reason', () => {
    for (const exclusion of READONLY_ACTION_WRITE_EXCLUSIONS) {
      expect(exclusion.reason.length, `exclusion '${exclusion.id}' carries no reason`).toBeGreaterThan(0);
    }
  });

  it('keeps every consumed pattern reachable through the cheap prefilter', () => {
    // The rule skips any body with no `api` identifier before it parses. A
    // consumed pattern whose canonical example does not survive that filter
    // would be silently unchecked, so the filter is pinned against the ledger
    // rather than trusted.
    for (const pattern of HOOK_BODY_WRITE_PATTERNS) {
      if (!READONLY_ACTION_WRITE_PATTERN_IDS.includes(pattern.id)) continue;
      expect(/\bapi\b/.test(pattern.example.source), `pattern '${pattern.id}' fails the prefilter`).toBe(true);
    }
  });

  it('consumes only the ctx.api shape - every excluded shape stays green on a readonlyWhen field', () => {
    // Drives the exclusion ledger rather than restating it: each excluded
    // pattern's own canonical example is run against a stack where every field
    // it writes is declared readonlyWhen. A rule that started consuming one of
    // them would light up here.
    for (const pattern of HOOK_BODY_WRITE_PATTERNS) {
      if (READONLY_ACTION_WRITE_PATTERN_IDS.includes(pattern.id)) continue;
      const fields = Object.fromEntries(
        pattern.example.writes.map((w) => [w.field, { type: 'text', readonlyWhen: 'true' }]),
      );
      const objectNames = [
        ...new Set(pattern.example.writes.map((w) => w.object).filter((o): o is string => typeof o === 'string')),
      ];
      const findings = validateReadonlyActionWrites({
        objects: [
          { name: 'showcase_invoice', fields },
          ...objectNames.map((name) => ({ name, fields })),
        ],
        actions: [
          {
            name: 'probe',
            objectName: 'showcase_invoice',
            body: { language: 'js', source: pattern.example.source },
          },
        ],
      });
      expect(findings, `excluded pattern '${pattern.id}' produced a finding`).toEqual([]);
    }
  });
});
