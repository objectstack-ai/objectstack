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
import { ObjectStackSchema } from '@objectstack/spec';
import { ObjectSchema } from '@objectstack/spec/data';

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

const MANIFEST = { id: 'rule_compilability_probe', name: 'rule_compilability_probe', version: '1.0.0', type: 'app' } as const;

/** Does the schema refuse any KEY in this stack (as opposed to any VALUE)? */
function unrecognizedKeysIn(stack: unknown): string[] {
  const result = ObjectStackSchema.safeParse(stack);
  if (result.success) return [];
  return result.error.issues
    .filter((i) => i.code === 'unrecognized_keys')
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

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

// ── The alias this rule stopped reading, and why (#5096) ─────────────

/**
 * `objects[].validationRules` was read here as `obj.validations ??
 * obj.validationRules` — the eighth of the family #4984 → #5009 → #5017/PR
 * #5046 has been closing out, and the third file it lands in.
 *
 * The canonical key came FIRST, so on any stack `ObjectStackSchema` can parse
 * the alias limb was unreachable (the schema refuses the key outright, so it is
 * never present in a parsed object). What the limb still did was *claim*, in
 * the source every later reader and every AI authoring metadata against this
 * repo consults, that `objects[].validationRules` is a real authoring surface.
 * That claim is the defect; the behaviour change is nil, and the tests below
 * pin BOTH halves rather than asserting one and assuming the other.
 *
 * Note the direction of the reverse verification, which is #5018's lesson: the
 * canonical key was first, so removing the limb does not *lose* a finding on
 * any valid stack. It loses one only on a stack the schema already refuses by
 * name — where the refusal is the better diagnostic. The old test here
 * (`reads \`validationRules\` too`) asserted exactly the limb being removed and
 * really did fire (1 finding, measured before the change), so it is replaced
 * rather than re-spelled: keeping it green by swapping the key to `validations`
 * would have kept a test whose stated subject no longer exists.
 */
describe('validateRuleCompilability — undeclared keys are the schema’s job, not this rule’s (#5096)', () => {
  const aliasSpelling = {
    objects: [
      {
        name: 'account',
        validationRules: [{ type: 'format', name: 'ein', field: 'tax_id', regex: '([', message: 'm' }],
      },
    ],
  };
  const canonicalSpelling = {
    objects: [
      {
        name: 'account',
        validations: [{ type: 'format', name: 'ein', field: 'tax_id', regex: '([', message: 'm' }],
      },
    ],
  };

  it('`ObjectSchema` declares `validations` and refuses `validationRules` BY NAME', () => {
    const objectKeys = Object.keys(ObjectSchema.shape);
    expect(objectKeys).toContain('validations');
    expect(objectKeys).not.toContain('validationRules');

    // Strict, so this is not a silent strip: the whole object is refused, and
    // the refusal names the replacement key.
    const refusals = unrecognizedKeysIn({
      manifest: MANIFEST,
      objects: [
        {
          name: 'account',
          label: 'Account',
          fields: { tax_id: { type: 'text', label: 'Tax ID' } },
          validationRules: [{ type: 'format', name: 'ein', field: 'tax_id', regex: '([', message: 'm' }],
        },
      ],
    }).join(' ');
    expect(refusals).toMatch(/Unrecognized key\(s\) on this object: `validationRules`/);
    expect(refusals).toMatch(/Did you mean `validationRules` → `validations`\?/);

    // …while the canonical spelling of the same stack parses clean.
    expect(
      ObjectStackSchema.safeParse({
        manifest: MANIFEST,
        objects: [
          {
            name: 'account',
            label: 'Account',
            fields: { tax_id: { type: 'text', label: 'Tax ID' } },
            validations: [{ type: 'format', name: 'ein', field: 'tax_id', regex: '([', message: 'm' }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('reads the canonical key only — the alias spelling yields nothing here', () => {
    // The whole finding, on the canonical spelling…
    expect(ids(canonicalSpelling)).toEqual([VALIDATION_RULE_REGEX_UNCOMPILABLE]);
    // …and silence on the spelling the schema refuses. Silence is correct: the
    // author is told by NAME which key to fix, instead of getting a report about
    // a list this gate had to invent a second reading of the spec to find.
    expect(ids(aliasSpelling)).toEqual([]);
  });

  it('is exactly what the alias limb used to answer — the removed behaviour, restated', () => {
    // The limb, rebuilt here so the claim "no valid stack changes verdict" is
    // demonstrated rather than described (#5046's `OLD_CHAIN` pattern).
    const OLD_CHAIN = (stack: Record<string, unknown>) => {
      const objects = (stack.objects as Array<Record<string, unknown>>) ?? [];
      return objects.map((o) => o.validations ?? o.validationRules);
    };
    const NEW_READ = (stack: Record<string, unknown>) =>
      ((stack.objects as Array<Record<string, unknown>>) ?? []).map((o) => o.validations);

    // Canonical spelling: identical, which is the zero-behaviour-change claim.
    expect(OLD_CHAIN(canonicalSpelling)).toEqual(NEW_READ(canonicalSpelling));
    // Alias spelling: the ONLY input where they differ — and it is a stack the
    // schema rejects, so it never reaches this `input: 'parsed'` rule at all.
    expect(OLD_CHAIN(aliasSpelling)).not.toEqual(NEW_READ(aliasSpelling));
    expect(unrecognizedKeysIn({ manifest: MANIFEST, ...aliasSpelling })).not.toEqual([]);
  });
});

/**
 * ── The structural meta-guard (#4992 pattern, #5009/#5018/#5017 shape) ───────
 *
 * Two guards, both scanning the SOURCE rather than the behaviour — deliberately,
 * because an unreachable branch has no behaviour to assert on, which is the
 * whole problem this family keeps rediscovering:
 *
 * 1. **Declared-key guard** — every key this rule reads off a stack, an object
 *    or a validation rule must appear in that surface's own Zod `.shape`, with
 *    `expected` matched EXACTLY so that adding a read (or renaming a loop
 *    variable, which would silently disarm the scan) forces a deliberate visit
 *    to the table. Plus a "covers every receiver" meta-test, so a NEW receiver
 *    cannot carry undeclared reads by simply not being listed.
 *
 * 2. **Reachability guard** — every `findings.push` site is reached by a fixture
 *    that `ObjectStackSchema` parses CLEAN.
 *
 *    That bar is #5018's flat `safeParse`, one notch stricter than the
 *    `unrecognized_keys`-only bar `validate-security-posture.test.ts` had to
 *    settle for, and it is available here because of what this rule judges: a
 *    `regex` is any string and a `schema` any record as far as the spec is
 *    concerned, so an artifact that will not COMPILE is still perfectly
 *    spec-VALID. This gate exists precisely because zod cannot see the defect —
 *    it therefore never needs a fixture zod rejects.
 */
const RULE_SOURCE = readFileSync(new URL('./validate-rule-compilability.ts', import.meta.url), 'utf8');

/**
 * Strip literal TEXT, keeping code. This rule's findings carry long `message` /
 * `hint` prose and a `path` template, and that prose is thick with dotted names
 * that are not property reads at all — `objects.<name>.validations.<rule>.regex`
 * is a config PATH shown to an author, `rule-validator.ts` is a filename. A scan
 * that counted them would need `objects`, `validations` and `validator` excused
 * as "plumbing", which is exactly the kind of padding that makes an excuse list
 * stop meaning anything. `${…}` interpolations ARE reads (`${rule.regex}`) and
 * are kept.
 */
function stripLiteralText(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
      i++;
      out += ' ';
      continue;
    }
    if (c === '`') {
      i++;
      let depth = 0;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (depth === 0) {
          if (src[i] === '`') {
            i++;
            break;
          }
          if (src[i] === '$' && src[i + 1] === '{') {
            depth = 1;
            i += 2;
            out += ' ';
            continue;
          }
          i++;
          continue;
        }
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) {
          i++;
          out += ' ';
          continue;
        }
        out += src[i];
        i++;
      }
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Comments stripped, string literals intact — for reading declared LITERALS. */
const RULE_CODE_WITH_LITERALS = RULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** The rule's CODE — comments and literal prose stripped: the guards scan reads. */
const RULE_CODE = stripLiteralText(RULE_CODE_WITH_LITERALS);

/** Distinct property names read off `receiver` in the rule's code. */
function keysReadOff(receiver: string): string[] {
  const re = new RegExp(`\\b${receiver}\\??\\.([A-Za-z_$][\\w$]*)`, 'g');
  return [...new Set([...RULE_CODE.matchAll(re)].map((m) => m[1]))].sort();
}

/**
 * The declared keys of a schema, unwrapping the optional / array / record /
 * lazy / union layers between a collection and its element. A union answers the
 * UNION of its members' keys: a validation rule is exactly one variant, and a
 * key any variant declares is one an author may legitimately write.
 *
 * `lazySchema` wraps schemas in a Proxy whose target is a FUNCTION, so the
 * `typeof` guard admits both — miss that and every lazily-built schema silently
 * answers "declares nothing", which would make this guard vacuous.
 */
function shapeKeysOf(schema: unknown, depth = 0): string[] {
  const s = schema as { shape?: Record<string, unknown>; _def?: Record<string, unknown>; unwrap?: () => unknown };
  if (!s || (typeof s !== 'object' && typeof s !== 'function') || depth > 12) return [];
  if (s.shape) return Object.keys(s.shape);
  const d = (s._def ?? {}) as Record<string, unknown>;
  if (d.type === 'union' && Array.isArray(d.options)) {
    return [...new Set((d.options as unknown[]).flatMap((o) => shapeKeysOf(o, depth + 1)))];
  }
  const getter = d.getter as (() => unknown) | undefined;
  for (const next of [d.innerType, d.element, d.valueType, getter?.(), d.in, d.out]) {
    const r = shapeKeysOf(next, depth + 1);
    if (r.length) return r;
  }
  if (typeof s.unwrap === 'function') return shapeKeysOf(s.unwrap(), depth + 1);
  return [];
}

/**
 * Receivers whose keys are NOT a spec `.shape`, and why. An explicit, reasoned
 * list rather than "whatever the table forgot": a receiver that drops out of the
 * table silently is how an undeclared read gets back in.
 */
const NOT_SCHEMA_RECEIVERS: Record<string, string> = {
  err: 'a caught `Error` — `.message` is the JS builtin.',
  import: '`import.meta.url`, the ESM builtin `loadAjv` anchors `createRequire` on.',
  process: '`process.cwd()`, a Node global — the CJS-build fallback anchor.',
};

const READ_SURFACES: Array<{ receiver: string; expected: string[]; declaredBy: string; keys: () => string[] }> = [
  {
    receiver: 'stack',
    expected: ['objects'],
    declaredBy: 'ObjectStackSchema',
    keys: () => Object.keys(ObjectStackSchema.shape),
  },
  {
    // `validationRules` is absent, and that is the #5096 fix.
    receiver: 'obj',
    expected: ['name', 'validations'],
    declaredBy: 'ObjectSchema',
    keys: () => Object.keys(ObjectSchema.shape),
  },
  {
    receiver: 'rule',
    expected: ['name', 'regex', 'schema', 'type'],
    declaredBy: 'ObjectSchema.validations[] (the ValidationRuleSchema union)',
    keys: () => shapeKeysOf(ObjectSchema.shape.validations),
  },
];

describe('validateRuleCompilability — reads only keys the spec declares (meta-test, #5096)', () => {
  it.each(READ_SURFACES)('every key read off `$receiver` is declared by $declaredBy', (surface) => {
    const read = keysReadOff(surface.receiver);
    expect(read).toEqual(surface.expected);
    const declared = surface.keys();
    expect(declared.length, `${surface.declaredBy} resolved to no keys — the guard would be vacuous`).toBeGreaterThan(0);
    expect(read.filter((k) => !declared.includes(k))).toEqual([]);
  });

  it('the COMPUTED `rule[branch]` reads are declared too — the dotted scan cannot see them', () => {
    // `flattenRules` descends via `rule[branch]` over a literal list, so the
    // regex scan above is blind to `then` / `otherwise`. Read the literal out of
    // the source and check it the same way, or this rule's most interesting
    // reads would sit outside every guard in this file.
    const literal = /for \(const branch of \[([^\]]*)\] as const\)/.exec(RULE_CODE_WITH_LITERALS);
    expect(literal, 'flattenRules no longer iterates a literal branch list — re-check this guard').not.toBeNull();
    const branches = [...literal![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(branches).toEqual(['otherwise', 'then']);
    const declared = shapeKeysOf(ObjectSchema.shape.validations);
    expect(branches.filter((b) => !declared.includes(b))).toEqual([]);
  });

  it('covers every receiver in the source that is not explicitly excused', () => {
    // Without this, a NEW receiver (a new loop variable over a new collection)
    // would carry undeclared reads with nothing to notice — the table only
    // guards what the table lists.
    const receivers = [...new Set([...RULE_CODE.matchAll(/\b([a-z][\w$]*)\??\.[A-Za-z_$]/g)].map((m) => m[1]))];
    const tabled = new Set([...READ_SURFACES.map((r) => r.receiver), ...Object.keys(NOT_SCHEMA_RECEIVERS)]);
    // Locals whose "keys" are JS methods / this file's own plumbing, not metadata.
    const PLUMBING = new Set(['findings', 'v', 'out']);
    expect(receivers.filter((r) => !tabled.has(r) && !PLUMBING.has(r))).toEqual([]);

    // …and no excuse outlives the read it excuses. A stale name in either list
    // is a hole a future receiver can walk through under a familiar alias, and
    // is also how an excuse list quietly becomes decorative.
    const present = new Set(receivers);
    expect(
      [...Object.keys(NOT_SCHEMA_RECEIVERS), ...PLUMBING].filter((r) => !present.has(r)),
      'these names are excused but no longer read anything — drop them',
    ).toEqual([]);
  });
});

/**
 * ── Reachability: every branch is reachable from a stack the spec ACCEPTS ────
 */
function pushedRuleIds(): string[] {
  const sites = RULE_CODE.split('findings.push({').slice(1);
  return sites.map((block, i) => {
    const ruleConst = /rule:\s*([A-Z_][A-Z0-9_]*)/.exec(block)?.[1];
    if (!ruleConst) throw new Error(`findings.push site #${i} has no literal \`rule:\` — the guard cannot map it`);
    const id = RULE_IDS[ruleConst];
    if (!id) throw new Error(`findings.push site #${i} emits unknown rule id \`${ruleConst}\``);
    return id;
  });
}

const RULE_IDS: Record<string, string> = {
  VALIDATION_RULE_REGEX_UNCOMPILABLE,
  VALIDATION_RULE_SCHEMA_UNCOMPILABLE,
};

/** A full, spec-VALID stack carrying the given validation rules. */
const parseableStackWith = (...validations: unknown[]) => ({
  manifest: MANIFEST,
  objects: [
    {
      name: 'account',
      label: 'Account',
      fields: {
        tax_id: { type: 'text', label: 'Tax ID' },
        support_config: { type: 'json', label: 'Support Config' },
      },
      validations,
    },
  ],
});

const REACHABILITY_CORPUS: Array<{ label: string; stack: Record<string, unknown> }> = [
  {
    label: 'regex-uncompilable (top level)',
    stack: parseableStackWith({ type: 'format', name: 'tax_id_format', field: 'tax_id', regex: '([', message: 'm' }),
  },
  {
    label: 'json-schema-uncompilable (top level)',
    stack: parseableStackWith({
      type: 'json_schema',
      name: 'support_config_shape',
      field: 'support_config',
      schema: { type: 'not-a-type' },
      message: 'm',
    }),
  },
  {
    label: 'both, nested in a `conditional` branch',
    stack: parseableStackWith({
      type: 'conditional',
      name: 'churn_reason_consistency',
      when: "record.status == 'churned'",
      message: 'm',
      then: { type: 'format', name: 'churn_code_shape', field: 'tax_id', regex: 'a{2,1}', message: 'm' },
      otherwise: {
        type: 'json_schema',
        name: 'config_shape',
        field: 'support_config',
        schema: { required: 'tier' },
        message: 'm',
      },
    }),
  },
];

describe('validateRuleCompilability — every branch is reachable from a PARSING stack (meta-test, #5096)', () => {
  it.each(REACHABILITY_CORPUS)('$label: the fixture is spec-valid', ({ stack }) => {
    const result = ObjectStackSchema.safeParse(stack);
    expect(
      result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    ).toEqual([]);
  });

  it('maps every `findings.push` site in the source', () => {
    expect(pushedRuleIds()).toHaveLength(2);
  });

  it('reaches every `findings.push` site from that corpus — through the PARSED stack', () => {
    // Parsed, not raw: the corpus has to reach these sites as the rule actually
    // receives them on the compile path (`input: 'parsed'`). A fixture that only
    // works pre-parse would prove nothing about the gate authors meet.
    const emitted = new Set(
      REACHABILITY_CORPUS.flatMap(({ stack }) =>
        validateRuleCompilability(ObjectStackSchema.parse(stack)).map((f) => f.rule),
      ),
    );
    expect([...emitted].sort()).toEqual([...new Set(pushedRuleIds())].sort());
  });
});
