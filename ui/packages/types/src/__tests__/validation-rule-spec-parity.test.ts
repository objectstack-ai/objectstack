/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Validation-rule ↔ `@objectstack/spec` drift guard (objectstack#4115, #3103).
 *
 * The five spec-named rule variants in `data-protocol.ts` used to be hand-written
 * interfaces carrying a `(ObjectStack Spec v2.0.1)` canonicity comment while the
 * installed spec was 17.0.0-rc.0 — fifteen majors of drift with the comment still
 * vouching for it. What the copies had actually drifted into, all of it invisible
 * to `tsc` because nothing was bound to the spec:
 *
 *  - `ConditionalValidation` read `condition` + `rules[]`; the spec says `when` +
 *    `then` / `otherwise`. A spec-authored rule reached the engine with
 *    `rule.condition === undefined` and became a SILENT NO-OP.
 *  - `FormatValidation` read `pattern` + `flags`; the spec says `regex`. A
 *    spec-authored rule threw inside the engine and was reported as a
 *    VIOLATION — the client rejecting a write the server accepts.
 *  - `condition` was `string`, not the `ExpressionInput` envelope.
 *  - `StateMachineValidation` was missing `initialStates` (objectstack#3165), so
 *    the FSM entry-point check could not be pre-checked at all.
 *  - `BaseValidation` was missing `priority`, and advertised an `events: 'delete'`
 *    the spec had retired as a proven no-op (objectstack#3184).
 *
 * The derivation is now the mechanism; this file is the gate that keeps it one.
 * Deleting a derivation in `data-protocol.ts` must make this file red.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  ScriptValidationSchema,
  StateMachineValidationSchema,
  CrossFieldValidationSchema,
  ConditionalValidationSchema,
  FormatValidationSchema,
  ValidationRuleSchema,
} from '@objectstack/spec/data';
import type {
  ScriptValidation,
  StateMachineValidation,
  CrossFieldValidation,
  ConditionalValidation,
  FormatValidation,
  ObjectValidationRule,
  BaseValidation,
} from '../data-protocol.js';

/**
 * ── Compile-time pins ────────────────────────────────────────────────────────
 *
 * A TS type alias erases at runtime, so a restated union that happens to match
 * is indistinguishable from a derived one at `expect()` time. These `satisfies`
 * checks are what actually holds the derivation in place, and they are live
 * because `packages/types/tsconfig.test.json` compiles this file (#3009 — before
 * it existed, an identical-looking block in `spec-derived-unions.test.ts` was
 * decorative for its whole lifetime).
 *
 * Replace any derivation below with a hand-written interface and `Equal` goes
 * `false`, so `true satisfies false` stops compiling with TS1360 pointing at the
 * offending line.
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type IsUnknown<T> = unknown extends T ? ([T] extends [null] ? false : true) : false;

const _scriptIsSpecInput = true satisfies Equal<
  ScriptValidation,
  z.input<typeof ScriptValidationSchema>
>;
const _stateMachineIsSpecInput = true satisfies Equal<
  StateMachineValidation,
  z.input<typeof StateMachineValidationSchema>
>;
const _crossFieldIsSpecInput = true satisfies Equal<
  CrossFieldValidation,
  z.input<typeof CrossFieldValidationSchema>
>;
const _formatIsSpecInput = true satisfies Equal<
  FormatValidation,
  z.input<typeof FormatValidationSchema>
>;

// `BaseValidation` is `Omit<ScriptValidation, 'type' | 'condition'>`, so a spec
// addition to the shared base reaches it for free. Restate it by hand and this
// stops compiling.
const _baseIsSpecBase = true satisfies Equal<
  BaseValidation,
  Omit<z.input<typeof ScriptValidationSchema>, 'type' | 'condition'>
>;

// The conditional's PINNED DIVERGENCE, stated as two halves: everything except
// the branches is the spec's…
const _conditionalNonBranchKeysAreSpec = true satisfies Equal<
  Omit<ConditionalValidation, 'then' | 'otherwise'>,
  Omit<z.input<typeof ConditionalValidationSchema>, 'then' | 'otherwise'>
>;
// …and the branches are precise here, not `unknown`.
const _conditionalBranchIsTyped = false satisfies IsUnknown<ConditionalValidation['then']>;

// ── The branch probes, retargeted (#3177) ───────────────────────────────────
//
// These used to ask `IsUnknown<…>`, on the reasoning that the divergence was
// justified only while the spec's `then`/`otherwise` erased to `unknown`. Spec
// 17.0.0-rc.1 made that `false` and the pins fired — but the #3177 triage found
// the pins had asked too weak a question, and firing did NOT mean the branches
// had become derivable.
//
// What they actually became is `BaseValidationRuleShape`:
//
//   interface BaseValidationRuleShape {
//     type: string; name: string; message: string; …; [key: string]: unknown;
//   }
//
// The spec says so itself, at that type's declaration: "it types the KNOWN keys
// and accepts any others. That is a real improvement over `unknown` (which types
// nothing) but **it is not strictness** — the discriminated union below is what
// actually rejects a malformed rule, at parse time. Removing the index signature
// is the #4075 family of work, not this change."
//
// So deriving wholesale today would trade a 9-member discriminated union for a
// bag: `then.type` degrades from a literal union to `string`, `then.condition`
// to `unknown`, and a typo'd `type: 'formatt'` starts compiling. That is the
// same regression the original pin existed to prevent, one notch weaker — and
// it lands where it costs most, because renderers read plain objects and never
// parse, so the authoring-time discriminant is the ONLY gate on these rules.
//
// The probes below therefore ask the pin's TRUE trigger — "does the spec type
// them PROPERLY", not "does it type them at all". Both assert today's state, so
// this file is green now; both stop compiling when objectstack#4075 removes the
// index signature and the branches become a real union, which is when the
// wholesale derivation genuinely comes due.
type SpecThen = z.input<typeof ConditionalValidationSchema>['then'];
type SpecOtherwise = NonNullable<z.input<typeof ConditionalValidationSchema>['otherwise']>;

/** A discriminated union has a LITERAL `type`; a bag widens it to `string`. */
type HasLiteralDiscriminant<T extends { type: unknown }> = string extends T['type'] ? false : true;
/** `[key: string]: unknown` absorbs any member, so nothing is rejected at authoring time. */
type HasIndexSignature<T> = string extends keyof T ? true : false;

const _specThenStillCannotNarrow = false satisfies HasLiteralDiscriminant<SpecThen>;
const _specOtherwiseStillCannotNarrow = false satisfies HasLiteralDiscriminant<SpecOtherwise>;
const _specThenStillCarriesAnIndexSignature = true satisfies HasIndexSignature<SpecThen>;
const _specOtherwiseStillCarriesAnIndexSignature = true satisfies HasIndexSignature<SpecOtherwise>;

// Kept as the record of WHY the predicate had to change: the branches are no
// longer `unknown`, so the original pin's own stated condition really did lapse
// — it was simply not the condition that governed the burn-down.
const _specThenIsNoLongerUnknown = false satisfies IsUnknown<SpecThen>;

/**
 * The spec ships these as `lazySchema()` thunks, so `.shape` is only reachable
 * once the schema has been forced. `z.object`'s `shape` getter does that for us,
 * but reading it through a helper keeps the intent obvious.
 */
const keysOf = (schema: { shape: Record<string, unknown> }): string[] =>
  Object.keys(schema.shape).sort();

/**
 * Keys `BaseValidationSchema` contributes to every variant. The spec does not
 * export that schema, so it is recovered as the intersection of two variants
 * that share nothing else.
 */
const BASE_KEYS = keysOf(ScriptValidationSchema).filter((k) =>
  keysOf(FormatValidationSchema).includes(k)
);

describe('the spec base contributes the keys the local BaseValidation claims', () => {
  it('carries `priority` — the key the hand copy dropped', () => {
    expect(BASE_KEYS).toContain('priority');
  });

  it('is derivable rather than re-listed', () => {
    // `BaseValidation = Omit<ScriptValidation, 'type' | 'condition'>`. If the
    // spec adds a base key, it appears here for free; if someone re-lists the
    // keys by hand, the next spec addition goes missing silently.
    const base: BaseValidation = {
      name: 'r',
      message: 'm',
      priority: 10,
      tags: ['compliance'],
    };
    expect(base.priority).toBe(10);
  });

  it('admits only the write contexts the server runs (`delete` retired, objectstack#3184)', () => {
    const events = ScriptValidationSchema.shape.events;
    const parsed = ScriptValidationSchema.parse({
      name: 'r',
      message: 'm',
      type: 'script',
      condition: 'record.a > 1',
    });
    expect(parsed.events).toEqual(['insert', 'update']);
    expect(() =>
      ScriptValidationSchema.parse({
        name: 'r',
        message: 'm',
        type: 'script',
        condition: 'record.a > 1',
        events: ['delete'],
      })
    ).toThrow();
    expect(events).toBeDefined();
  });
});

describe.each([
  ['ScriptValidation', ScriptValidationSchema],
  ['StateMachineValidation', StateMachineValidationSchema],
  ['CrossFieldValidation', CrossFieldValidationSchema],
  ['FormatValidation', FormatValidationSchema],
] as const)('%s is the spec key-for-key', (_name, schema) => {
  it('accepts a rule authored against the spec', () => {
    // Every derived type is `z.input` of exactly this schema, so a payload the
    // spec parses is a payload the local type describes.
    expect(() => schema.parse(sampleFor(schema))).not.toThrow();
  });
});

/** Minimal valid payload per variant, authored the way the spec documents it. */
function sampleFor(schema: unknown): Record<string, unknown> {
  const base = { name: 'r', message: 'm' };
  if (schema === ScriptValidationSchema) {
    return { ...base, type: 'script', condition: 'record.amount < 0' };
  }
  if (schema === StateMachineValidationSchema) {
    return {
      ...base,
      type: 'state_machine',
      field: 'status',
      transitions: { draft: ['active'] },
      initialStates: ['draft'],
    };
  }
  if (schema === CrossFieldValidationSchema) {
    return {
      ...base,
      type: 'cross_field',
      condition: 'record.end_date < record.start_date',
      fields: ['end_date', 'start_date'],
    };
  }
  return { ...base, type: 'format', field: 'email', regex: '^.+@.+$', format: 'email' };
}

describe('the keys the hand copies got wrong', () => {
  it('ConditionalValidation is `when` / `then` / `otherwise`, not `condition` / `rules`', () => {
    const keys = keysOf(ConditionalValidationSchema);
    expect(keys).toContain('when');
    expect(keys).toContain('then');
    expect(keys).toContain('otherwise');
    expect(keys).not.toContain('condition');
    expect(keys).not.toContain('rules');

    // The type follows the schema. If someone reinstates `condition`/`rules`,
    // this stops compiling AND the assertions above stay honest.
    const rule: ConditionalValidation = {
      name: 'enterprise_needs_approval',
      message: 'Enterprise accounts require manager approval',
      type: 'conditional',
      when: 'record.account_type == "enterprise"',
      then: {
        name: 'require_approval',
        message: 'Approval missing',
        type: 'script',
        condition: 'record.approval_status == null',
      },
    };
    expect(rule.when).toBe('record.account_type == "enterprise"');
  });

  it('FormatValidation is `regex`, and the named formats are the four the server implements', () => {
    const keys = keysOf(FormatValidationSchema);
    expect(keys).toContain('regex');
    expect(keys).not.toContain('pattern');
    expect(keys).not.toContain('flags');

    // The five extra formats the hand copy offered (ipv4/ipv6/uuid/iso_date/
    // credit_card) cannot survive the spec's union, so a rule using one could
    // never have reached the server that was supposedly enforcing it.
    for (const format of ['ipv4', 'ipv6', 'uuid', 'iso_date', 'credit_card']) {
      expect(() =>
        FormatValidationSchema.parse({
          name: 'r',
          message: 'm',
          type: 'format',
          field: 'f',
          format,
        })
      ).toThrow();
    }

    const rule: FormatValidation = {
      name: 'email_shape',
      message: 'Not an email',
      type: 'format',
      field: 'email',
      regex: '^.+@.+$',
    };
    expect(rule.regex).toBe('^.+@.+$');
  });

  it('StateMachineValidation carries `initialStates` (objectstack#3165)', () => {
    expect(keysOf(StateMachineValidationSchema)).toContain('initialStates');

    const rule: StateMachineValidation = {
      name: 'status_fsm',
      message: 'Illegal transition',
      type: 'state_machine',
      field: 'status',
      transitions: { draft: ['active'] },
      initialStates: ['draft'],
    };
    expect(rule.initialStates).toEqual(['draft']);
  });
});

describe('predicates are on the ExpressionInput wire shape, not `string`', () => {
  it.each([
    ['ScriptValidation.condition', ScriptValidationSchema, 'condition'],
    ['CrossFieldValidation.condition', CrossFieldValidationSchema, 'condition'],
    ['ConditionalValidation.when', ConditionalValidationSchema, 'when'],
  ] as const)('%s accepts both the bare string and the { dialect, source } envelope', (
    _label,
    schema,
    key
  ) => {
    const payload = (value: unknown) => {
      if (schema === ConditionalValidationSchema) {
        return {
          name: 'r',
          message: 'm',
          type: 'conditional',
          when: value,
          then: { name: 'n', message: 'm', type: 'script', condition: 'record.a > 1' },
        };
      }
      if (schema === CrossFieldValidationSchema) {
        return { name: 'r', message: 'm', type: 'cross_field', condition: value, fields: ['a'] };
      }
      return { name: 'r', message: 'm', type: 'script', condition: value };
    };

    expect(() => schema.parse(payload('record.a > 1'))).not.toThrow();
    expect(() =>
      schema.parse(payload({ dialect: 'cel', source: 'record.a > 1' }))
    ).not.toThrow();
    expect(key).toBeTruthy();
  });

  it('types the envelope, so an envelope-valued condition is not a `string` misuse', () => {
    // Rendering one of these objects as a React child is how the same drift has
    // bitten before; the type now says out loud that it may be an object.
    const rule: ScriptValidation = {
      name: 'amount_positive',
      message: 'Amount must be positive',
      type: 'script',
      condition: { dialect: 'cel', source: 'record.amount < 0' },
    };
    expect(typeof rule.condition).toBe('object');
  });
});

describe('pinned divergence: `then` / `otherwise` (objectstack#4171, #4075)', () => {
  // The type half of this divergence is pinned at the top of this file
  // (`_specThenStillCannotNarrow` / `_specThenStillCarriesAnIndexSignature` /
  // `_conditionalBranchIsTyped`), because that is the half a runtime assertion
  // cannot reach. What IS observable at runtime is that the spec's own parser
  // still rejects a nonsense branch — so the weak typing is purely a published-
  // typing defect, not a loosened contract, and objectui re-typing the branch
  // cannot admit anything the server would refuse.
  //
  // That asymmetry is the whole argument for keeping the divergence: the spec
  // REJECTS this payload at parse time and DESCRIBES it as legal at compile
  // time. objectui's renderers read plain objects and never parse, so only the
  // compile-time half is ever consulted on the client — which is precisely why
  // adopting the spec's weaker branch type would matter.
  it('is a typing gap only — the spec`s parser still rejects a nonsense branch', () => {
    expect(() =>
      ConditionalValidationSchema.parse({
        name: 'r',
        message: 'm',
        type: 'conditional',
        when: 'record.a > 1',
        then: { type: 'not_a_rule' },
      })
    ).toThrow();
  });

  it('keeps objectui`s branch typing precise instead', () => {
    const rule: ConditionalValidation = {
      name: 'r',
      message: 'm',
      type: 'conditional',
      when: 'record.a > 1',
      then: {
        name: 'nested',
        message: 'm',
        type: 'format',
        field: 'email',
        format: 'email',
      },
      otherwise: {
        name: 'nested2',
        message: 'm',
        type: 'script',
        condition: 'record.b == null',
      },
    };
    // `then` narrows by discriminant — the thing the spec's `unknown` cannot do.
    expect(rule.then.type).toBe('format');
    expect(rule.otherwise?.type).toBe('script');
  });
});

describe('ObjectValidationRule is a documented superset, and says so', () => {
  const SPEC_VARIANTS = [
    'script',
    'state_machine',
    'format',
    'cross_field',
    'json_schema',
    'conditional',
  ];

  it('matches the spec union member list this file was written against', () => {
    // A spec release that adds or removes a variant lands here first, rather
    // than in a silent `default:` branch of the engine's dispatch.
    for (const type of SPEC_VARIANTS) {
      const sample =
        type === 'json_schema'
          ? { name: 'r', message: 'm', type, field: 'payload', schema: {} }
          : type === 'conditional'
            ? {
                name: 'r',
                message: 'm',
                type,
                when: 'record.a > 1',
                then: { name: 'n', message: 'm', type: 'script', condition: 'record.a > 1' },
              }
            : sampleFor(
                type === 'script'
                  ? ScriptValidationSchema
                  : type === 'state_machine'
                    ? StateMachineValidationSchema
                    : type === 'cross_field'
                      ? CrossFieldValidationSchema
                      : FormatValidationSchema
              );
      expect(() => ValidationRuleSchema.parse(sample), `spec variant '${type}'`).not.toThrow();
    }
  });

  it('rejects the three objectui-local variants, which is why they are @deprecated', () => {
    // `unique` / `async` / `range` cannot ride in `ObjectSchema.validations`.
    // The engine still dispatches them for hand-built rules, but no rule in this
    // shape can arrive from `/meta` — the comment on each type says so, and this
    // is what makes that comment true.
    for (const type of ['unique', 'async', 'range']) {
      expect(() =>
        ValidationRuleSchema.parse({ name: 'r', message: 'm', type, field: 'f', fields: ['f'] }),
        `local-only variant '${type}'`
      ).toThrow();
    }
  });

  it('admits every spec variant plus the three local ones at the type level', () => {
    const local: ObjectValidationRule[] = [
      { name: 'a', message: 'm', type: 'unique', fields: ['email'] },
      { name: 'b', message: 'm', type: 'range', field: 'age', min: 0 },
      { name: 'c', message: 'm', type: 'async', endpoint: 'https://example.test/v' },
    ];
    expect(local.map((r) => r.type)).toEqual(['unique', 'range', 'async']);
  });
});
