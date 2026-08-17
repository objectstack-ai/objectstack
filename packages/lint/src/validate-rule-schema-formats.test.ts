// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5178 — a MISSPELLED `format` in a `json_schema` validation rule is logged
// once by ajv and DROPPED, so the rule ships, runs on every write, and enforces
// nothing for the keyword its author wrote. The record is ACCEPTED, so no
// downstream signal exists either.
//
// The three halves this file has to prove, because any one alone is worthless:
//
//  1. the misspelling goes RED, naming the rule, the object, the JSON POINTER
//     and the nearest legitimate name (an author cannot act on "unknown
//     format");
//  2. every LEGITIMATE registered format stays GREEN — table-driven over the
//     enumerated set, not a sample. A gate that turns working metadata red gets
//     switched off, and then protects nothing;
//  3. the compile gate next door is UNCHANGED by any of it. #4762/#5029's
//     parity — the publish gate compiles in the runtime's exact environment —
//     is the thing this rule must lay beside, never fold into.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ObjectStackSchema } from '@objectstack/spec';

import {
  validateRuleSchemaFormats,
  nearestRegisteredFormat,
  MAX_SCHEMA_WALK_DEPTH,
  VALIDATION_RULE_SCHEMA_UNKNOWN_FORMAT,
} from './validate-rule-schema-formats.js';
import { registeredFormatNames, validateRuleCompilability } from './validate-rule-compilability.js';
import { AUTHORING_COMMANDS, AUTHORING_RULES, authoringRulesFor, runAuthoringRules } from './authoring-rules.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
const MANIFEST = { id: 'schema_format_probe', name: 'schema_format_probe', version: '1.0.0', type: 'app' } as const;

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

/** A `json_schema` rule named `support_shape` carrying `schema`. */
const schemaRule = (schema: unknown, name = 'support_shape') => ({
  type: 'json_schema',
  name,
  field: 'support_config',
  message: 'Support config does not match its schema.',
  schema,
});

const ids = (stack: unknown) => validateRuleSchemaFormats(stack).map((f) => f.rule);
const paths = (stack: unknown) => validateRuleSchemaFormats(stack).map((f) => f.path);

// ── Red: declared, schema-valid, compiling, and enforcing nothing ────

describe('validateRuleSchemaFormats — the dropped keyword goes RED (#5178)', () => {
  it('rejects `format: \'emial\'`, naming rule, object, pointer and the nearest real name', () => {
    const findings = validateRuleSchemaFormats(
      objectWith(schemaRule({ type: 'object', properties: { email: { type: 'string', format: 'emial' } } })),
    );

    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.rule).toBe(VALIDATION_RULE_SCHEMA_UNKNOWN_FORMAT);
    // Named: which rule, on which object, and exactly where in the schema.
    expect(f.where).toBe("object 'account' · validation 'support_shape'");
    expect(f.path).toBe('objects.account.validations.support_shape.schema#/properties/email/format');
    expect(f.message).toContain("format: 'emial'");
    expect(f.message).toContain('#/properties/email/format');
    // The consequence, in the direction that matters: the record is accepted.
    expect(f.message).toContain('ACCEPTED');
    // The fix, concretely — an author cannot act on "unknown format".
    expect(f.hint).toContain("Did you mean `format: 'email'`?");
    // …and the full vocabulary, so a name that is merely unfamiliar is
    // resolvable without reading ajv-formats' source.
    expect(f.hint).toContain('date-time');
    expect(f.hint).toContain('uri-reference');
  });

  it('is reachable on a stack the spec fully accepts — a VALUE verdict needs a green safeParse', () => {
    // The rule judges a VALUE (the format name) inside `schema`, a key
    // `JSONValidationSchema` declares as `z.record(z.string(), z.unknown())`.
    // So the bar is a full parse, not merely "no unrecognized_keys": if the
    // stack could not parse, the finding would be unreachable on the compile
    // path this rule is registered `input: 'parsed'` for (#5018/#5046).
    const stack = {
      manifest: MANIFEST,
      ...objectWith(schemaRule({ type: 'object', properties: { email: { type: 'string', format: 'emial' } } })),
    };
    const parsed = ObjectStackSchema.safeParse(stack);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [], null, 2)).toBe(true);
    expect(ids(parsed.success ? parsed.data : stack)).toEqual([VALIDATION_RULE_SCHEMA_UNKNOWN_FORMAT]);
  });

  it('finds a misspelling at ANY schema depth — one finding per pointer', () => {
    // The walker must reach every subschema position, not just `properties`:
    // `$defs`, `items` (both forms), `anyOf`/`allOf`/`oneOf`, `if`/`then`/`else`,
    // `additionalProperties`, `patternProperties`, `contains`, `not`,
    // `propertyNames`, `dependentSchemas`, draft-07 `dependencies`.
    const deep = {
      $defs: { stamp: { type: 'string', format: 'datetime' } },
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            anyOf: [
              { type: 'object', properties: { at: { type: 'string', format: 'date_time' } } },
              { type: 'object', additionalProperties: { type: 'string', format: 'urireference' } },
            ],
          },
        },
        pair: { type: 'array', items: [{ format: 'ipv_4' }, { format: 'ipv6' }] },
        bag: { type: 'object', patternProperties: { '^x-': { format: 'uuid4' } } },
      },
      if: { properties: { kind: { const: 'web' } } },
      then: { properties: { site: { format: 'ur1' } } },
      else: { properties: { host: { format: 'hostname' } } },
      dependentSchemas: { site: { properties: { canonical: { format: 'uri-ref' } } } },
      dependencies: { legacy: { properties: { old: { format: 'e-mail' } } } },
      allOf: [{ not: { properties: { banned: { format: 'passwrd' } } } }],
      oneOf: [{ contains: { format: 'json-pointr' } }, { propertyNames: { format: 'regexp' } }],
    };

    const findings = validateRuleSchemaFormats(objectWith(schemaRule(deep)));
    // Every planted misspelling, and none of the two legitimate names
    // (`ipv6`, `hostname`) that sit right beside them.
    expect(findings.map((f) => f.path.split('#')[1]).sort()).toEqual(
      [
        '/$defs/stamp/format',
        '/allOf/0/not/properties/banned/format',
        '/dependencies/legacy/properties/old/format',
        '/dependentSchemas/site/properties/canonical/format',
        '/oneOf/0/contains/format',
        '/oneOf/1/propertyNames/format',
        '/properties/bag/patternProperties/^x-/format',
        '/properties/pair/items/0/format',
        '/properties/rows/items/anyOf/0/properties/at/format',
        '/properties/rows/items/anyOf/1/additionalProperties/format',
        '/then/properties/site/format',
      ].sort(),
    );
    expect(new Set(findings.map((f) => f.rule))).toEqual(new Set([VALIDATION_RULE_SCHEMA_UNKNOWN_FORMAT]));
  });

  it('judges the rules nested in a `conditional`, and names the branch', () => {
    // `evaluateRule` recurses into `then` / `otherwise` and reaches the very
    // same `checkJsonSchema`, so a misspelling in a branch is just as inert.
    const findings = validateRuleSchemaFormats(
      objectWith({
        type: 'conditional',
        name: 'when_enterprise',
        message: 'Enterprise accounts need a full support config.',
        when: 'record.tier == "enterprise"',
        then: schemaRule({ properties: { email: { format: 'emial' } } }, 'support_shape_strict'),
      }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe("object 'account' · validation 'when_enterprise' → 'support_shape_strict'");
    expect(findings[0].path).toBe(
      'objects.account.validations.when_enterprise.then.support_shape_strict.schema#/properties/email/format',
    );
  });

  it('escapes `~` and `/` in pointer segments (RFC 6901)', () => {
    expect(
      paths(objectWith(schemaRule({ properties: { 'a/b~c': { format: 'emial' } } }))),
    ).toEqual(['objects.account.validations.support_shape.schema#/properties/a~1b~0c/format']);
  });
});

// ── Green: the red line — legitimate metadata must not turn red ──────

describe('validateRuleSchemaFormats — legitimate metadata stays GREEN', () => {
  const registered = registeredFormatNames();

  it('the registered set is enumerated from the plugin, not written down here', () => {
    // The whole cost #5178 weighed was "the gate must enumerate the registered
    // format set, which couples it to the plugin version". This is how that
    // cost is paid: the set comes off a live ajv built exactly the way
    // `rule-validator.ts` builds its own, so an `ajv-formats` upgrade moves the
    // gate with it and no edit here is possible to forget.
    const require_ = createRequire(import.meta.url);
    const AjvMod = require_('ajv');
    const formatsMod = require_('ajv-formats');
    const Ajv = AjvMod.default ?? AjvMod;
    const addFormats = formatsMod.default ?? formatsMod;
    const probe = new Ajv({ allErrors: true, strict: false });
    addFormats(probe);

    expect([...registered]).toEqual(Object.keys(probe.formats).sort());
    expect(registered.length).toBeGreaterThan(0);
    // A sample, so a plugin that silently registered nothing is visible here
    // rather than only as "every format in your stack is misspelled".
    expect(registered).toContain('email');
    expect(registered).toContain('date-time');
    expect(registered).toContain('uri-reference');

    // …and no hardcoded vocabulary crept back into the rule's source. A list
    // there would start refusing formats the write path enforces the day the
    // plugin adds one — the failure mode this rule exists to avoid, aimed at
    // the gate itself.
    const source = readFileSync(join(srcDir, 'validate-rule-schema-formats.ts'), 'utf8');
    for (const name of ['date-time', 'uri-reference', 'json-pointer', 'ipv4']) {
      expect(source, `the rule hardcodes the format name "${name}" — enumerate instead`).not.toContain(`'${name}'`);
    }
  });

  it.each([...registered])('publishes `format: %s` — every registered name', (name) => {
    const stack = objectWith(schemaRule({ type: 'object', properties: { value: { format: name } } }));
    expect(ids(stack)).toEqual([]);
    // …and the schema really is publishable end to end: the #4762 compile gate
    // is green on it too, so this table is not quietly green because the
    // metadata was broken in some other way.
    expect(validateRuleCompilability(stack)).toEqual([]);
  });

  it('says nothing about a schema that names no format at all', () => {
    expect(
      ids(
        objectWith(
          schemaRule({
            type: 'object',
            properties: { plan: { type: 'string', enum: ['free', 'pro'] }, seats: { type: 'integer', minimum: 1 } },
            required: ['plan'],
            'x-vendor-hint': { anything: true },
          }),
        ),
      ),
    ).toEqual([]);
  });

  it('never reads `format` out of DATA — `default`, `const`, `enum`, `examples`', () => {
    // The false-positive trap a naive "collect every `format` key" walker falls
    // into. These hold arbitrary values ajv never reads as schema, so a
    // `format` inside one enforces nothing and was never meant to; reporting it
    // would be inventing a defect out of a legal document.
    expect(
      ids(
        objectWith(
          schemaRule({
            type: 'object',
            properties: {
              tpl: { type: 'object', default: { format: 'emial' }, examples: [{ format: 'nonsense' }] },
              mode: { const: { format: 'also-not-a-format' } },
              pick: { enum: [{ format: 'still-not' }, 'plain'] },
            },
          }),
        ),
      ),
    ).toEqual([]);
  });

  it('leaves a NON-STRING `format` to the compile gate, which refuses it by name', () => {
    // `format: 42` fails ajv's own meta-schema check, so #4762's rule already
    // rejects the schema with ajv's words. A second finding here would be noise
    // — and a `$data` reference is resolved at validation time, not statically.
    const bad = objectWith(schemaRule({ type: 'object', properties: { e: { format: 42 } } }));
    expect(ids(bad)).toEqual([]);
    expect(validateRuleCompilability(bad).map((f) => f.rule)).toEqual(['validation-rule-json-schema-uncompilable']);

    expect(ids(objectWith(schemaRule({ properties: { e: { format: { $data: '1/fmt' } } } })))).toEqual([]);
  });

  it('says nothing about the other five validation-rule types, or a schema-less rule', () => {
    expect(
      ids(
        objectWith(
          { type: 'format', name: 'tax', field: 'tax_id', regex: '^\\d{2}$', format: 'email', message: 'm' },
          { type: 'script', name: 's', condition: 'record.tax_id != null', message: 'm' },
          { type: 'json_schema', name: 'no_schema', field: 'support_config', message: 'm' },
        ),
      ),
    ).toEqual([]);
  });

  it('tolerates junk without throwing — it is a pure (stack) => Finding[]', () => {
    for (const junk of [undefined, null, 42, 'stack', [], {}, { objects: 'nope' }, { objects: [null] }]) {
      expect(() => validateRuleSchemaFormats(junk)).not.toThrow();
      expect(validateRuleSchemaFormats(junk)).toEqual([]);
    }
  });

  it('stops at MAX_SCHEMA_WALK_DEPTH instead of hanging on a self-referential schema', () => {
    // `os lint` never parses, so it hands this walker whatever object the
    // author's module actually built — and a self-reference is a two-line
    // accident. Same cheap promise `MAX_RULE_NESTING_DEPTH` makes next door.
    const cyclic: Record<string, unknown> = { type: 'object', properties: { bad: { format: 'emial' } } };
    (cyclic.properties as Record<string, unknown>).self = cyclic;
    expect(MAX_SCHEMA_WALK_DEPTH).toBeGreaterThan(8);
    const findings = validateRuleSchemaFormats(objectWith(schemaRule(cyclic)));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.length).toBeLessThanOrEqual(MAX_SCHEMA_WALK_DEPTH + 1);
  });
});

// ── The suggestion has to be worth printing ──────────────────────────

describe('nearestRegisteredFormat — the suggestion half of the message', () => {
  const registered = registeredFormatNames();

  it.each([
    ['emial', 'email'],
    ['e-mail', 'email'],
    ['Email', 'email'],
    ['datetime', 'date-time'],
    ['date_time', 'date-time'],
    ['urireference', 'uri-reference'],
    ['ipv_4', 'ipv4'],
    ['uuid4', 'uuid'],
    ['hostnmae', 'hostname'],
  ])('suggests %s → %s', (typo, expected) => {
    expect(nearestRegisteredFormat(typo, registered)).toBe(expected);
  });

  it('suggests NOTHING for a name that is not a typo of anything', () => {
    // A confident wrong suggestion is worse than none: it sends the author to
    // rename a constraint they never meant to write.
    for (const invented of ['shoe_size', 'company-tax-identifier', 'zz']) {
      expect(nearestRegisteredFormat(invented, registered)).toBeNull();
    }
  });

  it('is deterministic — ties break alphabetically, so a message never flickers', () => {
    expect(nearestRegisteredFormat('emial', [...registered].reverse())).toBe(
      nearestRegisteredFormat('emial', registered),
    );
  });
});

// ── The compile gate next door is untouched ──────────────────────────

describe('#4762/#5029 parity is laid BESIDE, never folded in', () => {
  it('the compile gate still PUBLISHES a misspelled format — its #5029 pin stands', () => {
    // The direction matters and was decided before it was run: this is NOT a
    // "revert the fix and watch it go red" case. `validateRuleCompilability`
    // compiles in the runtime's exact environment, a typo'd format compiles
    // there, and so it must keep returning [] — its pin
    // ('a MISSPELLED format name is published, not refused') passes unchanged.
    // What changed is that a SECOND rule, which compiles nothing, now refuses
    // the same stack. If this assertion ever goes red, the two judgements have
    // been merged and the parity contract broken.
    const stack = objectWith(schemaRule({ type: 'object', properties: { email: { format: 'emial' } } }));
    expect(validateRuleCompilability(stack)).toEqual([]);
    expect(ids(stack)).toEqual([VALIDATION_RULE_SCHEMA_UNKNOWN_FORMAT]);
  });

  it('the rule never compiles a schema — the parity instance is only asked what it registered', () => {
    const source = readFileSync(join(srcDir, 'validate-rule-schema-formats.ts'), 'utf8');
    expect(source, 'this rule must not compile — that is the neighbouring gate\'s job').not.toMatch(
      /\.compile\s*\(/,
    );
  });

  it('an uncompilable schema still yields BOTH verdicts, each from its own rule', () => {
    const stack = objectWith(schemaRule({ type: 'not-a-type', properties: { e: { format: 'emial' } } }));
    expect(validateRuleCompilability(stack).map((f) => f.rule)).toEqual(['validation-rule-json-schema-uncompilable']);
    expect(ids(stack)).toEqual([VALIDATION_RULE_SCHEMA_UNKNOWN_FORMAT]);
  });
});

// ── Wired, or it protects nothing (#4409/#4449) ──────────────────────

describe('validateRuleSchemaFormats is wired into every authoring command', () => {
  it('is a gating registry entry on all three commands', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateRuleSchemaFormats');
    expect(entry, 'the rule must be registered in AUTHORING_RULES').toBeDefined();
    expect(entry!.tier).toBe('gating');
    expect(entry!.source).toBe('packages/lint/src/validate-rule-schema-formats.ts');
    for (const command of AUTHORING_COMMANDS) {
      expect(
        authoringRulesFor(command).map((r) => r.name),
        `os ${command} must run validateRuleSchemaFormats`,
      ).toContain('validateRuleSchemaFormats');
    }
  });

  it.each([...AUTHORING_COMMANDS])('os %s reports the misspelling as an error', (command) => {
    const stack = {
      manifest: MANIFEST,
      ...objectWith(schemaRule({ type: 'object', properties: { email: { type: 'string', format: 'emial' } } })),
    };
    const findings = runAuthoringRules(command, { normalized: stack, parsed: stack });
    const mine = findings.filter((f) => f.rule === VALIDATION_RULE_SCHEMA_UNKNOWN_FORMAT);
    expect(mine).toHaveLength(1);
    expect(mine[0].severity).toBe('error');
  });
});
