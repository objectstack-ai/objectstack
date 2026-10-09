// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Server-side per-option `visibleWhen` enforcement (objectui#2284).
 *
 * A select/multiselect/radio option may gate itself with a `visibleWhen` CEL
 * predicate. Client-side hiding is UX only, so on write the engine re-evaluates
 * the picked value's predicate against the merged record + `current_user` and
 * rejects a clean FALSE — enforcing both cascade integrity (country → province)
 * and role/context gating. A predicate that cannot be evaluated REFUSES the
 * write (ADR-0137 D2, which #22402 ruled reaches this gate on the write path),
 * with one admitted case: a system write with no acting user whose predicate
 * reads one.
 */
import { describe, it, expect } from 'vitest';
import { toEvalPermissions } from '@objectstack/formula';
import { evaluateValidationRules, needsPriorRecord, optionVisibilityReadsPermissions } from './rule-validator.js';
import { ValidationError } from './record-validator.js';

/**
 * The `ValidationError` a call threw, asserted as the envelope REST serves as
 * `400 VALIDATION_FAILED` — never a bare `toThrow()`, which an unrelated throw
 * would satisfy.
 */
function refusalOf(run: () => unknown): ValidationError & { fields: any[] } {
  let caught: unknown;
  try {
    run();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  expect((caught as ValidationError).code).toBe('VALIDATION_FAILED');
  return caught as ValidationError & { fields: any[] };
}

// country → province cascade + a role-gated tier option.
const schema = {
  fields: {
    country: { type: 'select', options: [{ value: 'cn' }, { value: 'us' }] },
    province: {
      type: 'select',
      options: [
        { value: 'zj', visibleWhen: "record.country == 'cn'" },
        { value: 'ca', visibleWhen: "record.country == 'us'" },
        { value: 'other' }, // ungated — always allowed
      ],
    },
    tier: {
      type: 'select',
      options: [
        { value: 'standard' },
        { value: 'admin_only', visibleWhen: "'admin' in current_user.positions" },
      ],
    },
  },
};

describe('per-option visibleWhen — cascade enforcement (insert)', () => {
  it('rejects a province that does not match the chosen country', () => {
    expect(() => evaluateValidationRules(schema, { country: 'us', province: 'zj' }, 'insert')).toThrow(
      ValidationError,
    );
  });
  it('accepts a province valid for the country', () => {
    expect(() => evaluateValidationRules(schema, { country: 'cn', province: 'zj' }, 'insert')).not.toThrow();
  });
  it('accepts an ungated option regardless of the parent', () => {
    expect(() => evaluateValidationRules(schema, { country: 'us', province: 'other' }, 'insert')).not.toThrow();
  });
  it('leaves an unknown value to the enum validator (no visibleWhen match)', () => {
    expect(() => evaluateValidationRules(schema, { country: 'cn', province: 'zzz' }, 'insert')).not.toThrow();
  });
});

describe('per-option visibleWhen — cascade enforcement (update, merged record)', () => {
  it('rejects using the prior country when the patch omits it', () => {
    expect(() =>
      evaluateValidationRules(schema, { province: 'zj' }, 'update', { previous: { country: 'us' } }),
    ).toThrow(ValidationError);
  });
  it('accepts using the prior country when it matches', () => {
    expect(() =>
      evaluateValidationRules(schema, { province: 'zj' }, 'update', { previous: { country: 'cn' } }),
    ).not.toThrow();
  });
  it('does not check a field the patch never wrote', () => {
    // province persisted as 'zj' but country now 'us'; patch touches only `note`.
    expect(() =>
      evaluateValidationRules(schema, { note: 'x' } as any, 'update', {
        previous: { country: 'us', province: 'zj' },
      }),
    ).not.toThrow();
  });
});

describe('per-option visibleWhen — role gating', () => {
  it('rejects an admin-only value for a non-admin', () => {
    expect(() =>
      evaluateValidationRules(schema, { tier: 'admin_only' }, 'insert', {
        currentUser: { id: 'u1', positions: ['sales'] },
      }),
    ).toThrow(ValidationError);
  });
  it('accepts an admin-only value for an admin', () => {
    expect(() =>
      evaluateValidationRules(schema, { tier: 'admin_only' }, 'insert', {
        currentUser: { id: 'u1', positions: ['admin'] },
      }),
    ).not.toThrow();
  });
  it('accepts the ungated standard value for anyone', () => {
    expect(() =>
      evaluateValidationRules(schema, { tier: 'standard' }, 'insert', {
        currentUser: { id: 'u1', positions: ['sales'] },
      }),
    ).not.toThrow();
  });
  it('fails open when current_user is unbound (system write) — predicate faults', () => {
    // `'admin' in current_user.positions` faults with no bound user → allowed through.
    // Authorization gating therefore requires the engine to bind current_user.
    expect(() => evaluateValidationRules(schema, { tier: 'admin_only' }, 'insert')).not.toThrow();
  });
});

/**
 * #14416 — the fail-open branch must say WHICH of its two cases it took.
 *
 * A system write (a declarative seed, an in-process job) can never bind
 * `current_user`, so a role-gated option logged one `failed to evaluate —
 * allowed through` per seeded row — 27 on one ordinary boot, on the correct
 * path. An authenticated caller whose predicate genuinely faults produced the
 * identical line, and that one is a gate that is not being enforced.
 *
 * Both branches stay at `warn` (the sink declares only `warn`, and the
 * authenticated fault must not get quieter). What the pins hold is that the two
 * are told apart and that the discriminator needs BOTH facts — no acting user
 * AND a predicate that asks for one. Since #22402 the two also differ in their
 * VERDICT: `no-acting-user` is still admitted, while `predicate-fault` refuses
 * the write (ADR-0137 D2). A test that only checked the wording would pass with
 * the branch still absent, so every case below asserts `meta.reason` and the
 * verdict too.
 */
describe('per-option visibleWhen — fault diagnostics name their case (#14416)', () => {
  /** Collect `(msg, meta)` pairs off the declared `{ warn? }` sink. */
  function capture() {
    const warns: Array<{ msg: string; meta: any }> = [];
    return { warns, logger: { warn: (msg: string, meta?: any) => warns.push({ msg, meta }) } };
  }

  // A predicate that names no user root at all and faults on a typo'd field:
  // the case the "no acting user" discriminator MUST NOT swallow.
  const typoSchema = {
    fields: {
      grade: {
        type: 'select',
        options: [{ value: 'gold', visibleWhen: 'record.typo_field == 1' }],
      },
    },
  };

  it('system write + a current_user predicate ⇒ one qualified warn, reason no-acting-user, value admitted', () => {
    const { warns, logger } = capture();
    expect(() =>
      evaluateValidationRules(schema, { tier: 'admin_only' }, 'insert', { logger }),
    ).not.toThrow(); // fail-open admission unchanged — the seed writes the gated value

    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toBe(
      "option visibleWhen for 'tier=admin_only' not evaluated: no acting user to bind current_user (system write) — allowed through",
    );
    // The old line said "failed to evaluate", which is what an operator escalates.
    expect(warns[0].msg).not.toContain('failed to evaluate');
    expect(warns[0].meta).toMatchObject({
      field: 'tier',
      value: 'admin_only',
      reason: 'no-acting-user',
    });
    // The underlying fault stays recoverable from the line, not just its label.
    expect(warns[0].meta.error).toMatchObject({ kind: expect.any(String) });
  });

  it('authenticated caller + a genuinely faulting predicate ⇒ REFUSED (ADR-0137 D2), the warn says so, reason predicate-fault', () => {
    const { warns, logger } = capture();
    const err = refusalOf(() =>
      evaluateValidationRules(typoSchema, { grade: 'gold' }, 'insert', {
        currentUser: { id: 'u1', positions: ['admin'] },
        logger,
      }),
    );
    // The field-rule envelope, naming the option, the field and the fault.
    expect(err.fields).toEqual([
      {
        field: 'grade',
        code: 'rule_violation',
        value: 'gold',
        message:
          "Option 'gold' of field 'grade' visibleWhen could not be evaluated (runtime: No such key: typo_field) — write rejected."
          + " The predicate reads 'typo_field', which this object does not declare — fix the rule's condition, or declare the field.",
        constraint: { rule: 'visibleWhen', reason: 'unevaluable', fault: 'runtime: No such key: typo_field', missingKey: 'typo_field' },
      },
    ]);

    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain("option visibleWhen for 'grade=gold' failed to evaluate");
    expect(warns[0].msg).toContain('(authenticated caller: runtime: No such key: typo_field)');
    expect(warns[0].msg).toContain('write rejected');
    expect(warns[0].msg).not.toContain('allowed through');
    expect(warns[0].meta).toMatchObject({
      field: 'grade',
      value: 'gold',
      reason: 'predicate-fault',
    });
  });

  it('system write + a predicate naming NO user root ⇒ REFUSED too (the case the user-less test alone would misfile)', () => {
    // This is why the discriminator is not `currentUser === undefined` on its
    // own: nothing about this write is expected — the predicate is broken, so
    // its gate refuses, acting user or not, exactly as a faulting
    // `requiredWhen` / `readonlyWhen` refuses a system write (ADR-0137 D2).
    const { warns, logger } = capture();
    const err = refusalOf(() => evaluateValidationRules(typoSchema, { grade: 'gold' }, 'insert', { logger }));
    expect(err.fields).toEqual([
      expect.objectContaining({
        field: 'grade',
        code: 'rule_violation',
        value: 'gold',
        constraint: expect.objectContaining({ rule: 'visibleWhen', reason: 'unevaluable', missingKey: 'typo_field' }),
      }),
    ]);

    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain('failed to evaluate');
    expect(warns[0].msg).toContain('(system write: ');
    expect(warns[0].msg).toContain('write rejected');
    expect(warns[0].meta).toMatchObject({ reason: 'predicate-fault' });
  });

  it('reads the user root off the AST, not off the fault text (a second fault must not re-loud a seed line)', () => {
    // Measured on this tree: with no acting user,
    //   `'admin' in current_user.positions`                    → Unknown variable: current_user
    //   `'admin' in current_user.positions && record.typo == 1` → No such key: typo
    // so a key that matched the message would file the second one as a live
    // gate failure on every system write — the noise this branch removes.
    const both = {
      fields: {
        tier: {
          type: 'select',
          options: [
            { value: 'admin_only', visibleWhen: "'admin' in current_user.positions && record.typo == 1" },
          ],
        },
      },
    };
    const { warns, logger } = capture();
    expect(() => evaluateValidationRules(both, { tier: 'admin_only' }, 'insert', { logger })).not.toThrow();

    expect(warns).toHaveLength(1);
    expect(warns[0].meta).toMatchObject({ reason: 'no-acting-user' });
    expect(warns[0].meta.error.message).toContain('No such key: typo'); // the other fault, still reported
  });

  it('a user-root ALIAS on a system write is the same case (buildScope mounts one object under four roots)', () => {
    // ADR-0068 D1: `current_user` is canonical, `user` / `ctx.user` / `os.user`
    // are aliases for the SAME EvalUser — none of them bind without a user, so
    // an alias-spelled gate must not be the loud line on a seed either.
    for (const source of ['user.id == record.owner', 'ctx.user.id == record.owner', 'os.user.id == record.owner']) {
      const aliased = {
        fields: { flag: { type: 'select', options: [{ value: 'on', visibleWhen: source }] } },
      };
      const { warns, logger } = capture();
      expect(() => evaluateValidationRules(aliased, { flag: 'on' }, 'insert', { logger })).not.toThrow();
      expect(warns, source).toHaveLength(1);
      expect(warns[0].meta, source).toMatchObject({ reason: 'no-acting-user' });
    }
  });

  describe('regression controls — the accept/reject set does not move', () => {
    it('authenticated caller + predicate FALSE ⇒ still refused with invalid_option', () => {
      const { warns, logger } = capture();
      let caught: any;
      try {
        evaluateValidationRules(schema, { tier: 'admin_only' }, 'insert', {
          currentUser: { id: 'u1', positions: ['sales'] },
          logger,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught.code).toBe('VALIDATION_FAILED');
      expect(caught.fields).toEqual([
        expect.objectContaining({ field: 'tier', code: 'invalid_option' }),
      ]);
      expect(warns).toHaveLength(0); // a clean FALSE is a decision, not a diagnostic
    });

    it('authenticated caller + predicate TRUE ⇒ admitted, no warn', () => {
      const { warns, logger } = capture();
      expect(() =>
        evaluateValidationRules(schema, { tier: 'admin_only' }, 'insert', {
          currentUser: { id: 'u1', positions: ['admin'] },
          logger,
        }),
      ).not.toThrow();
      expect(warns).toHaveLength(0);
    });

    it('a cascade predicate that evaluates cleanly on a system write still rejects', () => {
      // No user root, nothing unbound — the gate is enforced on system writes too.
      const { warns, logger } = capture();
      expect(() =>
        evaluateValidationRules(schema, { country: 'us', province: 'zj' }, 'insert', { logger }),
      ).toThrow(ValidationError);
      expect(warns).toHaveLength(0);
    });
  });

  it('reproduces the card: N seeded rows log N lines, and none of them says "failed to evaluate"', () => {
    // The card measured 27 identical `failed to evaluate — allowed through`
    // lines on one boot, one per seeded row carrying a gated option value.
    const N = 27;
    const { warns, logger } = capture();
    for (let i = 0; i < N; i++) {
      evaluateValidationRules(schema, { tier: 'admin_only' }, 'insert', { logger });
    }
    expect(warns).toHaveLength(N); // the record of each admission is kept (option (c), not (a))
    expect(warns.filter((w) => w.msg.includes('failed to evaluate'))).toHaveLength(0);
    expect(warns.filter((w) => w.meta?.reason === 'no-acting-user')).toHaveLength(N);
  });
});

describe('per-option visibleWhen — multi-select element-wise', () => {
  const multi = {
    fields: {
      country: { type: 'select', options: [{ value: 'cn' }, { value: 'us' }] },
      provinces: {
        type: 'multiselect',
        options: [
          { value: 'zj', visibleWhen: "record.country == 'cn'" },
          { value: 'gd', visibleWhen: "record.country == 'cn'" },
          { value: 'ca', visibleWhen: "record.country == 'us'" },
        ],
      },
    },
  };
  it('rejects when any selected element is invalid for the parent', () => {
    expect(() => evaluateValidationRules(multi, { country: 'cn', provinces: ['zj', 'ca'] }, 'insert')).toThrow(
      ValidationError,
    );
  });
  it('accepts when every selected element is valid', () => {
    expect(() =>
      evaluateValidationRules(multi, { country: 'cn', provinces: ['zj', 'gd'] }, 'insert'),
    ).not.toThrow();
  });
});

describe('per-option visibleWhen — checkboxes element-wise (objectui#2715)', () => {
  // `checkboxes` is the multi-value sibling of `multiselect`; its gated options
  // must be enforced server-side too (client cascading shipped in objectui#2735).
  const checks = {
    fields: {
      country: { type: 'select', options: [{ value: 'cn' }, { value: 'us' }] },
      provinces: {
        type: 'checkboxes',
        options: [
          { value: 'zj', visibleWhen: "record.country == 'cn'" },
          { value: 'gd', visibleWhen: "record.country == 'cn'" },
          { value: 'ca', visibleWhen: "record.country == 'us'" },
        ],
      },
    },
  };
  it('rejects when any checked element is invalid for the parent', () => {
    expect(() => evaluateValidationRules(checks, { country: 'cn', provinces: ['zj', 'ca'] }, 'insert')).toThrow(
      ValidationError,
    );
  });
  it('accepts when every checked element is valid', () => {
    expect(() =>
      evaluateValidationRules(checks, { country: 'cn', provinces: ['zj', 'gd'] }, 'insert'),
    ).not.toThrow();
  });
  it('accounts for a gated checkboxes option in needsPriorRecord', () => {
    expect(needsPriorRecord(checks)).toBe(true);
  });
});

describe('per-option visibleWhen — value/option type coercion', () => {
  // A numeric option value submitted as a string (a common REST/JSON round-trip)
  // must still hit its gate — matching the enum validator's String(...) compare.
  const numeric = {
    fields: {
      country: { type: 'select', options: [{ value: 'cn' }, { value: 'us' }] },
      zone: {
        type: 'select',
        options: [
          { value: 1, visibleWhen: "record.country == 'cn'" },
          { value: 2, visibleWhen: "record.country == 'us'" },
        ],
      },
    },
  };
  it('gates a numeric option value sent as a string', () => {
    expect(() => evaluateValidationRules(numeric, { country: 'us', zone: '1' }, 'insert')).toThrow(
      ValidationError,
    );
  });
  it('accepts the string form when the gate passes', () => {
    expect(() => evaluateValidationRules(numeric, { country: 'cn', zone: '1' }, 'insert')).not.toThrow();
  });
});

describe('needsPriorRecord accounts for option visibleWhen', () => {
  it('is true when a choice field has a gated option (cascade may reference a prior sibling)', () => {
    expect(needsPriorRecord(schema)).toBe(true);
  });
  it('is false for plain option fields with no visibleWhen', () => {
    expect(needsPriorRecord({ fields: { color: { type: 'select', options: [{ value: 'r' }, { value: 'b' }] } } })).toBe(
      false,
    );
  });
});

/**
 * [#18783] `current_user.can(object, verb)` in an option's `visibleWhen` — the
 * permission predicate, answered on the SERVER.
 *
 * `@objectstack/formula` answers `can` from `EvalContext.permissions` and
 * refuses LOUDLY when none was passed. Until this card nothing on the write
 * path passed one, so an author who gated an option on the subject's grants got
 * the fail-open branch on every authenticated write: the gate was never
 * enforced, one `warn` per write. The engine now hands the evaluator the
 * subject's effective object-permission map as `permissions` (resolved once per
 * write from `ISecurityService.getEffectiveObjectPermissions`, see the engine
 * suite `engine-option-permission-predicate.test.ts`); these pin the evaluator's
 * half of that contract.
 */
describe('per-option visibleWhen — the permission predicate `can` (#18783)', () => {
  const canSchema = {
    fields: {
      stage: {
        type: 'select',
        options: [
          { value: 'open' },
          { value: 'escalated', visibleWhen: "current_user.can('crm_account', 'edit')" },
          { value: 'vip', visibleWhen: "'vip_desk' in current_user.positions" },
        ],
      },
    },
  };
  const USER = { id: 'u1', positions: ['sales_rep'] };
  /** The `/auth/me/permissions` `objects` shape, through the one door formula publishes. */
  const MAY_EDIT = toEvalPermissions({ crm_account: { allowRead: true, allowEdit: true } });
  const READ_ONLY = toEvalPermissions({ crm_account: { allowRead: true } });

  function capture() {
    const warns: Array<{ msg: string; meta: any }> = [];
    return { warns, logger: { warn: (msg: string, meta?: any) => warns.push({ msg, meta }) } };
  }

  it('REFUSES a `can`-gated option for a subject whose effective map withholds the verb', () => {
    // Red before #18783: with no `permissions` reaching the evaluator the
    // predicate faulted and the fail-open branch admitted the value.
    const { warns, logger } = capture();
    let caught: any;
    try {
      evaluateValidationRules(canSchema, { stage: 'escalated' }, 'insert', {
        currentUser: USER, permissions: READ_ONLY, logger,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught.code).toBe('VALIDATION_FAILED');
    expect(caught.fields).toEqual([
      expect.objectContaining({ field: 'stage', code: 'invalid_option' }),
    ]);
    // A clean FALSE is a decision, not a diagnostic.
    expect(warns).toHaveLength(0);
  });

  it('ADMITS it for a subject whose effective map grants the verb', () => {
    const { warns, logger } = capture();
    expect(() =>
      evaluateValidationRules(canSchema, { stage: 'escalated' }, 'insert', {
        currentUser: USER, permissions: MAY_EDIT, logger,
      }),
    ).not.toThrow();
    expect(warns).toHaveLength(0);
  });

  it('answers on the merged record on UPDATE exactly as on insert', () => {
    expect(() =>
      evaluateValidationRules(canSchema, { stage: 'escalated' }, 'update', {
        previous: { stage: 'open' }, currentUser: USER, permissions: READ_ONLY,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      evaluateValidationRules(canSchema, { stage: 'escalated' }, 'update', {
        previous: { stage: 'open' }, currentUser: USER, permissions: MAY_EDIT,
      }),
    ).not.toThrow();
  });

  it('control: a predicate WITHOUT `can` answers the same with or without the map', () => {
    for (const permissions of [undefined, READ_ONLY, MAY_EDIT]) {
      expect(() =>
        evaluateValidationRules(canSchema, { stage: 'vip' }, 'insert', {
          currentUser: USER, permissions,
        }),
        String(permissions && Object.keys(permissions)),
      ).toThrow(ValidationError);
      expect(() =>
        evaluateValidationRules(canSchema, { stage: 'vip' }, 'insert', {
          currentUser: { id: 'u2', positions: ['vip_desk'] }, permissions,
        }),
      ).not.toThrow();
    }
  });

  it('NO permission data ⇒ REFUSED as unevaluable, naming the missing input — NOT a silent denial, NOT an admission', () => {
    // The member-absent state: the engine passes no map at all, never `{}`.
    // The gate has no verdict, so the write is refused (ADR-0137 D2, #22402)
    // through the unevaluable envelope — never `invalid_option`, which would
    // read as a measured denial — and the fault names the input the context
    // lacked, in the response as in the log.
    const { warns, logger } = capture();
    const err = refusalOf(() =>
      evaluateValidationRules(canSchema, { stage: 'escalated' }, 'insert', { currentUser: USER, logger }),
    );
    expect(err.fields).toHaveLength(1);
    expect(err.fields[0]).toMatchObject({
      field: 'stage',
      code: 'rule_violation',
      value: 'escalated',
      constraint: { rule: 'visibleWhen', reason: 'unevaluable' },
    });
    expect(err.fields[0].constraint.fault).toContain('carries no permission data');
    expect(err.fields[0].message.startsWith("Option 'escalated' of field 'stage' visibleWhen could not be evaluated (")).toBe(true);
    expect(warns).toHaveLength(1);
    expect(warns[0].meta).toMatchObject({ field: 'stage', value: 'escalated', reason: 'predicate-fault' });
    expect(warns[0].meta.error.message).toContain('carries no permission data');
  });

  it('an EMPTY map is a real answer — it refuses, it does not read as "no data"', () => {
    expect(() =>
      evaluateValidationRules(canSchema, { stage: 'escalated' }, 'insert', {
        currentUser: USER, permissions: toEvalPermissions({}),
      }),
    ).toThrow(ValidationError);
  });

  describe('optionVisibilityReadsPermissions — which writes need the map at all', () => {
    it('is true only when a PICKED option\'s predicate calls `can`', () => {
      expect(optionVisibilityReadsPermissions(canSchema.fields, { stage: 'escalated' })).toBe(true);
      // Picked, gated, but no `can` in its predicate.
      expect(optionVisibilityReadsPermissions(canSchema.fields, { stage: 'vip' })).toBe(false);
      // Picked, ungated.
      expect(optionVisibilityReadsPermissions(canSchema.fields, { stage: 'open' })).toBe(false);
      // Not written at all — an unchanged persisted value is not re-judged.
      expect(optionVisibilityReadsPermissions(canSchema.fields, { note: 'x' })).toBe(false);
      expect(optionVisibilityReadsPermissions(undefined, { stage: 'escalated' })).toBe(false);
    });

    it('reads every element of a multi-value pick and every ADR-0068 alias of the subject', () => {
      const multi = {
        tags: {
          type: 'multiselect',
          options: [
            { value: 'a' },
            { value: 'b', visibleWhen: "user.can('crm_account', 'read') || record.x == 1" },
          ],
        },
      };
      expect(optionVisibilityReadsPermissions(multi, { tags: ['a'] })).toBe(false);
      expect(optionVisibilityReadsPermissions(multi, { tags: ['a', 'b'] })).toBe(true);
    });

    it('reads the parsed AST, not the text: a quoted `can(` is not a call', () => {
      const quoted = {
        note_kind: {
          type: 'select',
          options: [{ value: 'q', visibleWhen: "record.title == 'you can(not) do this'" }],
        },
      };
      expect(optionVisibilityReadsPermissions(quoted, { note_kind: 'q' })).toBe(false);
    });
  });
});

/**
 * #22402 (ruling A) — ADR-0137 D2 reaches the option gate on the WRITE path.
 *
 * The gate is the server's enforcement of who may pick an option (ADR-0124
 * D1), so a predicate that cannot be evaluated has produced no verdict, and
 * the write is refused through the field-rule envelope rather than admitted
 * with one warn line. The pins below are the shapes NO build-time verdict can
 * judge — a computed key, a computed receiver — plus the shapes the build
 * judges but a stored row can still carry, the controls that must not move,
 * and the one arm that stays admitted.
 */
describe('per-option visibleWhen — a faulting predicate REFUSES the write (ADR-0137 D2, #22402)', () => {
  const AUTHED = { id: 'u1', positions: ['org_member'], organizationId: 'org_1' };
  const gated = (visibleWhen: string, extra: Record<string, unknown> = {}) => ({
    fields: {
      country: { type: 'select', options: [{ value: 'cn' }, { value: 'us' }] },
      account: { type: 'lookup', reference: 'crm_account' },
      tier: {
        type: 'select',
        options: [{ value: 'standard' }, { value: 'gold', visibleWhen }],
      },
      ...extra,
    },
  });
  /** The refusal entry for `tier=gold`, asserted on the envelope's facts. */
  function goldRefusal(source: string, data: Record<string, unknown>, opts: Record<string, unknown> = {}) {
    const err = refusalOf(() => evaluateValidationRules(gated(source), { tier: 'gold', ...data }, 'insert', opts));
    expect(err.fields).toHaveLength(1);
    const entry = err.fields[0];
    expect(entry).toMatchObject({
      field: 'tier',
      code: 'rule_violation',
      value: 'gold',
      constraint: { rule: 'visibleWhen', reason: 'unevaluable' },
    });
    expect(entry.message.startsWith("Option 'gold' of field 'tier' visibleWhen could not be evaluated (")).toBe(true);
    expect(entry.message).toContain('— write rejected.');
    return entry;
  }

  it('a COMPUTED-KEY predicate that faults refuses — and is not told to "declare the field"', () => {
    // `os['o' + 'rg']` names no member any build-time verdict can read; the
    // option check binds no `os.org`, so it faults at run time.
    const entry = goldRefusal("os['o' + 'rg'].id != ''", { country: 'cn' }, { currentUser: AUTHED });
    expect(entry.constraint.fault).toBe('runtime: No such key: org');
    expect(entry.constraint).not.toHaveProperty('missingKey');
    expect(entry.message).not.toContain('does not declare');
  });

  it('a COMPUTED-RECEIVER predicate that faults refuses — a comprehension variable', () => {
    const entry = goldRefusal("[record].exists(r, r.statsu == 'vip')", { country: 'cn' }, { currentUser: AUTHED });
    expect(entry.constraint.fault).toBe('runtime: No such key: statsu');
    expect(entry.constraint).not.toHaveProperty('missingKey');
  });

  it('a COMPUTED-RECEIVER predicate that faults refuses — a ternary', () => {
    const entry = goldRefusal("(record.country == 'cn' ? record : record).statsu == 'vip'", { country: 'cn' }, { currentUser: AUTHED });
    expect(entry.constraint.fault).toBe('runtime: No such key: statsu');
  });

  it('a read THROUGH a reference refuses with the repair that is true for it', () => {
    const entry = goldRefusal("record.account.tier == 'enterprise'", { account: 'acc_1' }, { currentUser: AUTHED });
    expect(entry.message).toContain("reads 'tier' through 'account', a reference to 'crm_account'");
    expect(entry.message).toContain("An option's `visibleWhen` is evaluated against this record alone");
    expect(entry.message).not.toContain('does not declare');
    expect(entry.constraint).not.toHaveProperty('missingKey');
  });

  it('an unbound ROOT refuses, naming what the option gate binds', () => {
    const entry = goldRefusal("parent.status == 'closed'", {}, { currentUser: AUTHED });
    expect(entry.constraint.fault).toBe('runtime: Unknown variable: parent');
    expect(entry.message).toContain("reads 'parent', which the option gate does not bind");
  });

  it('a user-root predicate whose OTHER half faults refuses an authenticated caller (the AST reader only spares a system write)', () => {
    const entry = goldRefusal("'org_admin' in current_user.positions || record.typo == 1", {}, { currentUser: AUTHED });
    expect(entry.constraint).toMatchObject({ missingKey: 'typo' });
  });

  it('refuses on UPDATE against the merged record, as on insert', () => {
    const err = refusalOf(() =>
      evaluateValidationRules(gated('record.statsu == 1'), { tier: 'gold' }, 'update', {
        previous: { country: 'cn', tier: 'standard' }, currentUser: AUTHED,
      }),
    );
    expect(err.fields).toEqual([expect.objectContaining({ field: 'tier', code: 'rule_violation', value: 'gold' })]);
  });

  it('one refusal per faulting PICK of a multi-value field, each naming its option', () => {
    const multi = {
      fields: {
        tags: {
          type: 'multiselect',
          options: [{ value: 'a' }, { value: 'b', visibleWhen: 'record.nope == 1' }, { value: 'c', visibleWhen: 'record.gone == 1' }],
        },
      },
    };
    const err = refusalOf(() => evaluateValidationRules(multi, { tags: ['a', 'b', 'c'] }, 'insert', { currentUser: AUTHED }));
    expect(err.fields.map((f: any) => [f.field, f.code, f.value, f.constraint.missingKey])).toEqual([
      ['tags', 'rule_violation', 'b', 'nope'],
      ['tags', 'rule_violation', 'c', 'gone'],
    ]);
  });

  it('joins the call\'s other refusals in ONE ValidationError (nothing is persisted on any of them)', () => {
    const both = {
      fields: {
        tier: { type: 'select', options: [{ value: 'gold', visibleWhen: 'record.nope == 1' }] },
        note: { type: 'text', requiredWhen: 'record.gone == 1' },
      },
    };
    const err = refusalOf(() => evaluateValidationRules(both, { tier: 'gold' }, 'insert', { currentUser: AUTHED }));
    expect(err.fields.map((f: any) => [f.field, f.constraint.rule])).toEqual([['note', 'requiredWhen'], ['tier', 'visibleWhen']]);
  });

  describe('controls — what must NOT move', () => {
    it('a gated option that is NOT picked is not judged, however broken its predicate', () => {
      expect(() => evaluateValidationRules(gated('record.nope == 1'), { tier: 'standard' }, 'insert', { currentUser: AUTHED })).not.toThrow();
    });

    it('a non-faulting FALSE still refuses as `invalid_option`, never as unevaluable', () => {
      const err = refusalOf(() => evaluateValidationRules(gated("record.country == 'cn'"), { country: 'us', tier: 'gold' }, 'insert', { currentUser: AUTHED }));
      expect(err.fields).toEqual([expect.objectContaining({ field: 'tier', code: 'invalid_option', value: 'gold' })]);
      expect(err.fields[0].constraint?.reason).toBeUndefined();
    });

    it('a non-faulting TRUE admits, with no warn', () => {
      const warns: unknown[] = [];
      expect(() =>
        evaluateValidationRules(gated("record.country == 'cn'"), { country: 'cn', tier: 'gold' }, 'insert', {
          currentUser: AUTHED, logger: { warn: (m: string) => warns.push(m) },
        }),
      ).not.toThrow();
      expect(warns).toHaveLength(0);
    });

    it('the `no-acting-user` arm stays ADMITTED and loud — a system write has nobody for the gate to ask about', () => {
      const warns: Array<{ msg: string; meta: any }> = [];
      expect(() =>
        evaluateValidationRules(gated("'org_admin' in current_user.positions"), { tier: 'gold' }, 'insert', {
          logger: { warn: (msg: string, meta?: any) => warns.push({ msg, meta }) },
        }),
      ).not.toThrow();
      expect(warns).toHaveLength(1);
      expect(warns[0].meta).toMatchObject({ field: 'tier', value: 'gold', reason: 'no-acting-user' });
    });

    it('the shipped cascade shape does NOT fault when the payload omits the parent: the record is total', () => {
      // The census question the ruling asked: `record.country == 'cn'` with no
      // `country` in the payload. Insert materialises every declared field, so
      // the predicate reads `null == 'cn'` — a clean FALSE (`invalid_option`),
      // never an unevaluable refusal. Same on update over a prior row that
      // lacks the column: `previous` is made total too.
      const insert = refusalOf(() => evaluateValidationRules(schema, { province: 'zj' }, 'insert', { currentUser: AUTHED }));
      expect(insert.fields).toEqual([expect.objectContaining({ field: 'province', code: 'invalid_option' })]);
      const update = refusalOf(() =>
        evaluateValidationRules(schema, { province: 'zj' }, 'update', { previous: { tier: 'standard' }, currentUser: AUTHED }),
      );
      expect(update.fields).toEqual([expect.objectContaining({ field: 'province', code: 'invalid_option' })]);
    });
  });
});
