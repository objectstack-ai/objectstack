// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Server-side per-option `visibleWhen` enforcement (objectui#2284).
 *
 * A select/multiselect/radio option may gate itself with a `visibleWhen` CEL
 * predicate. Client-side hiding is UX only, so on write the engine re-evaluates
 * the picked value's predicate against the merged record + `current_user` and
 * rejects a clean FALSE — enforcing both cascade integrity (country → province)
 * and role/context gating. Broken/unbound predicates fail-open.
 */
import { describe, it, expect } from 'vitest';
import { evaluateValidationRules, needsPriorRecord } from './rule-validator.js';
import { ValidationError } from './record-validator.js';

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
 * are told apart, that the fail-open ADMISSION is unchanged in both, and that
 * the discriminator needs BOTH facts — no acting user AND a predicate that asks
 * for one. A test that only checked the new wording would pass with the branch
 * still absent, so every case below asserts `meta.reason` too.
 */
describe('per-option visibleWhen — fail-open diagnostics name their case (#14416)', () => {
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

  it('authenticated caller + a genuinely faulting predicate ⇒ the loud warn, reason predicate-fault, value admitted', () => {
    const { warns, logger } = capture();
    expect(() =>
      evaluateValidationRules(typoSchema, { grade: 'gold' }, 'insert', {
        currentUser: { id: 'u1', positions: ['admin'] },
        logger,
      }),
    ).not.toThrow(); // still fail-open — this card changes the log, not the admission

    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain("option visibleWhen for 'grade=gold' failed to evaluate");
    expect(warns[0].msg).toContain('(authenticated caller)');
    expect(warns[0].msg).toContain('the option\'s gate was NOT enforced on this write');
    expect(warns[0].meta).toMatchObject({
      field: 'grade',
      value: 'gold',
      reason: 'predicate-fault',
    });
  });

  it('system write + a predicate naming NO user root ⇒ still the LOUD line (the case the user-less test alone would misfile)', () => {
    // This is why the discriminator is not `currentUser === undefined` on its
    // own: nothing about this write is expected — the predicate is broken and
    // its gate is not being enforced, acting user or not.
    const { warns, logger } = capture();
    expect(() => evaluateValidationRules(typoSchema, { grade: 'gold' }, 'insert', { logger })).not.toThrow();

    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain('failed to evaluate');
    expect(warns[0].msg).toContain('(system write)');
    expect(warns[0].msg).toContain('Check the predicate.');
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
