// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4762 — a `format` rule whose `regex` does not compile, and a `json_schema`
// rule whose schema ajv cannot compile, are fail-OPEN on the write path: logged
// once and skipped, so the rule is declared, listed, and enforces nothing on
// every record. Both are decidable from the metadata alone, so they are
// rejected here, at authoring/publish time.
//
// The two halves this file has to prove, because either alone is worthless:
//
//  1. the broken artifacts go RED, naming the rule, the object and the
//     compiler's own error text (an author cannot fix "invalid regex");
//  2. rich, legitimate artifacts stay GREEN — including a schema carrying
//     vendor keywords, which is the case a gate running ajv `strict: true`
//     would reject while the runtime compiles it happily. A gate that turns
//     working metadata red gets switched off, and then protects nothing.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import {
  validateRuleCompilability,
  MAX_RULE_NESTING_DEPTH,
  RUNTIME_AJV_OPTIONS,
  VALIDATION_RULE_REGEX_UNCOMPILABLE,
  VALIDATION_RULE_SCHEMA_UNCOMPILABLE,
} from './validate-rule-compilability.js';
import { AUTHORING_COMMANDS, AUTHORING_RULES, authoringRulesFor, runAuthoringRules } from './authoring-rules.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RUNTIME_VALIDATOR = 'packages/objectql/src/validation/rule-validator.ts';

/** One object carrying the given validation rules. */
const objectWith = (...validations: unknown[]) => ({
  objects: [
    {
      name: 'account',
      label: 'Account',
      fields: { tax_id: { type: 'text' }, support_config: { type: 'json' } },
      validations,
    },
  ],
});

const ids = (stack: unknown) => validateRuleCompilability(stack).map((f) => f.rule);

// ── Red: declared, schema-valid, and enforcing nothing ───────────────

describe('validateRuleCompilability — the fail-open artifacts go RED', () => {
  it('rejects a `format` rule whose regex does not compile, with the regex error verbatim', () => {
    const findings = validateRuleCompilability(
      objectWith({
        type: 'format',
        name: 'tax_id_format',
        field: 'tax_id',
        regex: '([',
        message: 'Tax ID must look like 12-3456789.',
      }),
    );

    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.rule).toBe(VALIDATION_RULE_REGEX_UNCOMPILABLE);
    // Named: which rule, on which object, and where in the config.
    expect(f.where).toBe("object 'account' · validation 'tax_id_format'");
    expect(f.path).toBe('objects.account.validations.tax_id_format.regex');
    expect(f.message).toContain("'tax_id_format'");
    expect(f.message).toContain("object 'account'");
    // The compiler's own text, not a paraphrase — this is what an author acts on.
    let native = '';
    try {
      new RegExp('([');
    } catch (err) {
      native = (err as Error).message;
    }
    expect(native).not.toBe('');
    expect(f.message).toContain(native);
    // And the consequence is stated, not implied.
    expect(f.message).toContain('enforces nothing');
    expect(f.hint).toMatch(/escaped|format/);
  });

  it('rejects a `json_schema` rule ajv cannot compile, with ajv’s error verbatim', () => {
    const findings = validateRuleCompilability(
      objectWith({
        type: 'json_schema',
        name: 'support_config_shape',
        field: 'support_config',
        schema: { type: 'not-a-type' },
        message: 'Support config must be an object.',
      }),
    );

    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.rule).toBe(VALIDATION_RULE_SCHEMA_UNCOMPILABLE);
    expect(f.where).toBe("object 'account' · validation 'support_config_shape'");
    expect(f.path).toBe('objects.account.validations.support_config_shape.schema');
    expect(f.message).toContain("'support_config_shape'");
    expect(f.message).toContain("object 'account'");
    // ajv's own wording, whatever this ajv version words it as.
    expect(f.message).toMatch(/schema is invalid/i);
    expect(f.message).toContain('enforces nothing');
  });

  it('finds a broken artifact nested in a `conditional` branch, and names the branch', () => {
    // `evaluateRule` recurses into `then`/`otherwise`, so a nested `format` rule
    // reaches the very same fail-open `checkFormat`. A gate that only walked the
    // top level would leave the nested half exactly as unprotected as before.
    const findings = validateRuleCompilability(
      objectWith({
        type: 'conditional',
        name: 'churn_reason_consistency',
        when: "record.status == 'churned'",
        message: 'Churn reason consistency.',
        then: {
          type: 'format',
          name: 'churn_code_shape',
          field: 'tax_id',
          regex: 'a{2,1}',
          message: 'Bad churn code.',
        },
        otherwise: {
          type: 'json_schema',
          name: 'config_shape',
          field: 'support_config',
          schema: { required: 'tier' },
          message: 'Bad config.',
        },
      }),
    );

    expect(findings.map((f) => f.rule).sort()).toEqual(
      [VALIDATION_RULE_REGEX_UNCOMPILABLE, VALIDATION_RULE_SCHEMA_UNCOMPILABLE].sort(),
    );
    const regexFinding = findings.find((f) => f.rule === VALIDATION_RULE_REGEX_UNCOMPILABLE)!;
    expect(regexFinding.where).toBe(
      "object 'account' · validation 'churn_reason_consistency' → 'churn_code_shape'",
    );
    expect(regexFinding.path).toBe(
      'objects.account.validations.churn_reason_consistency.then.churn_code_shape.regex',
    );
    const schemaFinding = findings.find((f) => f.rule === VALIDATION_RULE_SCHEMA_UNCOMPILABLE)!;
    expect(schemaFinding.path).toBe(
      'objects.account.validations.churn_reason_consistency.otherwise.config_shape.schema',
    );
  });

  it('reports every broken rule in one run rather than stopping at the first', () => {
    expect(
      ids(
        objectWith(
          { type: 'format', name: 'a', field: 'tax_id', regex: '(', message: 'm' },
          { type: 'format', name: 'b', field: 'tax_id', regex: '[z-a]', message: 'm' },
          { type: 'json_schema', name: 'c', field: 'support_config', schema: { type: 1 }, message: 'm' },
        ),
      ),
    ).toEqual([
      VALIDATION_RULE_REGEX_UNCOMPILABLE,
      VALIDATION_RULE_REGEX_UNCOMPILABLE,
      VALIDATION_RULE_SCHEMA_UNCOMPILABLE,
    ]);
  });
});

// ── Green: rich, legitimate metadata is untouched ────────────────────

describe('validateRuleCompilability — rich but VALID artifacts stay green', () => {
  it('accepts a demanding regex (lookahead, unicode escapes, backreference, nested groups)', () => {
    expect(
      ids(
        objectWith(
          // The showcase's own EIN rule — a doubled backslash in TS source is a
          // single one in the compiled pattern.
          { type: 'format', name: 'ein', field: 'tax_id', regex: '^\\d{2}-\\d{7}$', message: 'm' },
          {
            type: 'format',
            name: 'strong_code',
            field: 'tax_id',
            regex: '^(?=.*[A-Z])(?=.*\\d)(?!.*\\s)[A-Za-z\\d._%+-]{8,64}$',
            message: 'm',
          },
          { type: 'format', name: 'repeat', field: 'tax_id', regex: '^(\\w+)-\\1$', message: 'm' },
          { type: 'format', name: 'uni', field: 'tax_id', regex: '^[\\u4e00-\\u9fa5]{2,10}$', message: 'm' },
          // The named-format branch carries no regex at all.
          { type: 'format', name: 'named_only', field: 'tax_id', format: 'email', message: 'm' },
        ),
      ),
    ).toEqual([]);
  });

  it('accepts a rich JSON Schema — $defs/$ref, nested arrays, conditionals', () => {
    expect(
      ids(
        objectWith({
          type: 'json_schema',
          name: 'support_config_shape',
          field: 'support_config',
          message: 'm',
          schema: {
            $defs: {
              contact: {
                type: 'object',
                properties: { email: { type: 'string', format: 'email' }, phone: { type: 'string' } },
                required: ['email'],
                additionalProperties: false,
              },
            },
            type: 'object',
            properties: {
              tier: { type: 'string', enum: ['standard', 'premium', 'enterprise'] },
              seats: { type: 'integer', minimum: 1 },
              contacts: { type: 'array', items: { $ref: '#/$defs/contact' }, minItems: 1 },
              window: {
                type: 'object',
                properties: { from: { type: 'string' }, to: { type: 'string' } },
                dependentRequired: { from: ['to'] },
              },
            },
            required: ['tier'],
            additionalProperties: false,
            allOf: [{ if: { properties: { tier: { const: 'enterprise' } } }, then: { required: ['contacts'] } }],
          },
        }),
      ),
    ).toEqual([]);
  });

  it('accepts vendor keywords — the runtime runs ajv `strict: false`, so this gate must too', () => {
    // The parity case with teeth: under `strict: true` ajv REJECTS an unknown
    // keyword, so a gate that quietly chose stricter options than the runtime
    // would fail metadata the write path validates fine — a new declared ≠
    // enforced gap one level up, in the gate itself.
    expect(
      ids(
        objectWith({
          type: 'json_schema',
          name: 'vendor_keywords',
          field: 'support_config',
          message: 'm',
          schema: {
            type: 'object',
            properties: { tier: { type: 'string', 'x-ui-widget': 'segmented' } },
            'x-objectstack-hint': 'rendered by the console',
          },
        }),
      ),
    ).toEqual([]);
  });

  it('judges nothing but `format`/`json_schema` artifacts', () => {
    expect(
      ids(
        objectWith(
          {
            type: 'state_machine',
            name: 'lifecycle',
            field: 'status',
            transitions: { prospect: ['active'] },
            message: 'm',
          },
          { type: 'script', name: 'positive', condition: 'record.seats < 0', message: 'm' },
          { type: 'cross_field', name: 'dates', condition: 'record.a > record.b', fields: ['a'], message: 'm' },
        ),
      ),
    ).toEqual([]);
  });
});

// ── Shape tolerance: both authored collection shapes, and junk ───────

describe('validateRuleCompilability — walks what authors actually write', () => {
  it('handles the name-keyed object map shape as well as the array shape', () => {
    const findings = validateRuleCompilability({
      objects: {
        account: {
          fields: { tax_id: { type: 'text' } },
          validations: [{ type: 'format', name: 'ein', field: 'tax_id', regex: '([', message: 'm' }],
        },
      },
    });
    expect(findings.map((f) => f.where)).toEqual(["object 'account' · validation 'ein'"]);
  });

  it('reads `validationRules` too — the same list `validate-expressions.ts` reads', () => {
    expect(
      ids({
        objects: [
          {
            name: 'account',
            validationRules: [{ type: 'format', name: 'ein', field: 'tax_id', regex: '([', message: 'm' }],
          },
        ],
      }),
    ).toEqual([VALIDATION_RULE_REGEX_UNCOMPILABLE]);
  });

  it('terminates on a self-referential `conditional` — `os lint` never parses', () => {
    // The pre-parse stack is whatever the author's own module built, so a
    // self-referential rule is a two-line accident rather than a hypothetical.
    // Same promise `flow-walk.ts`'s MAX_REGION_DEPTH makes: no lint may hang.
    const cyclic: Record<string, unknown> = {
      type: 'conditional',
      name: 'loop',
      when: 'true',
      message: 'm',
    };
    cyclic.then = cyclic;

    const findings = validateRuleCompilability(objectWith(cyclic));
    expect(findings).toEqual([]);

    // Non-vacuity: the walk really does descend, and really does stop. A broken
    // regex parked at the bottom of a legal nest is still reported…
    const nest = (depth: number): Record<string, unknown> =>
      depth === 0
        ? { type: 'format', name: `leaf`, field: 'tax_id', regex: '([', message: 'm' }
        : { type: 'conditional', name: `c${depth}`, when: 'true', message: 'm', then: nest(depth - 1) };

    expect(ids(objectWith(nest(MAX_RULE_NESTING_DEPTH)))).toEqual([VALIDATION_RULE_REGEX_UNCOMPILABLE]);
    // …and one level past the cap is where the walker stops looking.
    expect(ids(objectWith(nest(MAX_RULE_NESTING_DEPTH + 1)))).toEqual([]);
  });

  it('never throws on a stack that is missing, malformed or empty', () => {
    for (const stack of [undefined, null, 'nonsense', 42, {}, { objects: null }, { objects: [null, 7] }]) {
      expect(validateRuleCompilability(stack)).toEqual([]);
    }
    expect(ids(objectWith(null, 'nonsense', { type: 'format', name: 'x', field: 'tax_id' }))).toEqual([]);
    // An empty regex is not a broken one — `checkFormat` only compiles a truthy
    // `rule.regex`, so an empty string is skipped by the runtime as well.
    expect(ids(objectWith({ type: 'format', name: 'x', field: 'tax_id', regex: '', message: 'm' }))).toEqual([]);
  });
});

// ── The verdict cannot drift from the runtime's ──────────────────────

describe('validateRuleCompilability — parity with the write path (#4762)', () => {
  it('compiles JSON Schemas with the SAME ajv options the runtime constructs', () => {
    // A gate that compiles with different options can pass what the runtime
    // rejects (or reject what it accepts), which is a fresh declared ≠ enforced
    // gap one level up. Read from the runtime's source so the day someone
    // changes those options, THIS goes red instead of the two silently
    // disagreeing.
    const path = join(repoRoot, RUNTIME_VALIDATOR);
    expect(existsSync(path), `${RUNTIME_VALIDATOR} must exist — it IS the surface this gate mirrors`).toBe(true);
    const source = readFileSync(path, 'utf8');

    const match = source.match(/new Ajv\(\s*\{([^}]*)\}\s*\)/);
    expect(match, `${RUNTIME_VALIDATOR} no longer constructs \`new Ajv({ … })\``).not.toBeNull();
    const pairs = match![1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(pairs, 'the runtime ajv options changed — mirror them in RUNTIME_AJV_OPTIONS').toEqual([
      'allErrors: true',
      'strict: false',
    ]);
    expect(RUNTIME_AJV_OPTIONS).toEqual({ allErrors: true, strict: false });

    // …and the regex half: the runtime compiles the raw source with no flags.
    expect(source).toContain('new RegExp(rule.regex)');
  });

  it('rejects exactly the two artifacts the runtime still skips', () => {
    // The runtime's own fail-open pin (`rule-fail-closed.test.ts` › `#4649 —
    // unchanged neighbours`) uses these two fixtures to record that the WRITE
    // path still waves them through. #4762's ruling leaves that pin standing and
    // closes the authoring door instead — so the same two fixtures must be
    // exactly what this gate refuses to publish.
    expect(ids(objectWith({ type: 'format', name: 'fmt', field: 'tax_id', regex: '([', message: 'bad' }))).toEqual([
      VALIDATION_RULE_REGEX_UNCOMPILABLE,
    ]);
    expect(
      ids(
        objectWith({
          type: 'json_schema',
          name: 'js',
          field: 'support_config',
          schema: { type: 'not-a-type' },
          message: 'bad',
        }),
      ),
    ).toEqual([VALIDATION_RULE_SCHEMA_UNCOMPILABLE]);
  });
});

// ── Wiring: the gate an author actually meets ────────────────────────

describe('validateRuleCompilability — registry wiring', () => {
  it('is a gating registry rule on all three authoring commands', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateRuleCompilability');
    expect(entry, 'validateRuleCompilability must be registered in AUTHORING_RULES').toBeDefined();
    expect(entry!.tier).toBe('gating');
    expect([...entry!.commands].sort()).toEqual([...AUTHORING_COMMANDS].sort());
    for (const command of AUTHORING_COMMANDS) {
      expect(
        authoringRulesFor(command).map((r) => r.name),
        `os ${command} must run validateRuleCompilability`,
      ).toContain('validateRuleCompilability');
    }
  });

  it('reaches the author through runAuthoringRules on every command', () => {
    const normalized = objectWith({
      type: 'format',
      name: 'tax_id_format',
      field: 'tax_id',
      regex: '([',
      message: 'm',
    });
    for (const command of AUTHORING_COMMANDS) {
      const findings = runAuthoringRules(command, { normalized, parsed: normalized });
      expect(
        findings.filter((f) => f.rule === VALIDATION_RULE_REGEX_UNCOMPILABLE),
        `os ${command} must surface the finding`,
      ).toHaveLength(1);
      expect(findings.find((f) => f.rule === VALIDATION_RULE_REGEX_UNCOMPILABLE)!.severity).toBe('error');
    }
  });
});
