// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5178 — a MISSPELLED `format` name in a `json_schema` validation rule
 * enforces nothing, and every existing gate is structurally blind to it.
 *
 * After #5029 the runtime's shared ajv is `new Ajv({ allErrors: true, strict:
 * false })` + `addFormats(ajv)`, so `format: 'email'` really does reject
 * `not-an-email`. But `strict: false` is also what makes an UNRECOGNISED format
 * name a non-event: ajv logs `unknown format "emial" ignored in schema at path
 * "#/properties/e"` once at compile time and **drops the keyword**. The rule
 * then compiles, ships, appears in the metadata, appears in every "what
 * protects this object" listing, runs on every write, enforces `type` and
 * `required` — and enforces nothing at all for the keyword its author actually
 * wrote. The record is ACCEPTED, which is the silent direction.
 *
 * That is the #4649 family shape again — declared ≠ enforced, with a stderr line
 * naming no rule and no object as the only signal — with the trigger moved from
 * "we forgot the plugin" (#5029) to "the author made a typo". And a typo is the
 * single most likely mistake in a hand-written or AI-generated JSON Schema:
 * `emial`, `e-mail`, `datetime` for `date-time`, `urireference` for
 * `uri-reference`, `ipv_4` for `ipv4`, `Email` for `email`.
 *
 * ## Why a rule BESIDE the compile, not inside it
 *
 * `validate-rule-compilability.ts` (#4762) compiles each `json_schema` rule with
 * the SAME ajv environment the runtime uses — deliberately, and #5029 extended
 * that parity to the `ajv-formats` registration. A schema whose format name the
 * runtime silently drops is therefore a schema that gate also compiles happily,
 * and it must stay that way: a gate inventing a COMPILE verdict the runtime does
 * not share is the `strict: true` mistake in a different hat. Its `#5029` pin —
 * "a MISSPELLED format name is published, not refused" — still passes verbatim,
 * because it is a statement about the compile.
 *
 * So this is a second, independent judgement over the same artifact, and it
 * never compiles anything. Two questions, two rules:
 *
 * | question                                | rule                                       |
 * |-----------------------------------------|--------------------------------------------|
 * | does ajv ACCEPT this schema?            | `validation-rule-json-schema-uncompilable` |
 * | will this `format` keyword DO anything? | `validation-rule-json-schema-unknown-format` |
 *
 * Both are decidable from the metadata alone, with no record in hand — the very
 * property #4762 used to argue for an authoring-time gate — so both are refused
 * before deployment rather than at write time. The runtime is untouched
 * (option 2 on #5178, `strict: 'log'` → throw, was rejected: it fires at
 * runtime and fail-OPEN, since `checkJsonSchema` catches, logs and skips, so it
 * would trade one silent gap for another; and `strict: false` is load-bearing
 * for the vendor keywords author-written schemas legitimately carry).
 *
 * ## The vocabulary is enumerated, never written down
 *
 * {@link registeredFormatNames} reads the names off a live instance of the very
 * ajv this repo's gate builds to mirror the runtime. A hardcoded list would be a
 * third opinion that nobody updates: the day `ajv-formats` adds a name, the list
 * starts refusing a format the write path enforces — a gate that turns working
 * metadata red, which gets switched off and then protects nothing. Enumerating
 * makes the gate follow the plugin across an upgrade with no edit here at all.
 *
 * ## The walk is JSON-Schema-aware, because `format` is not a magic word
 *
 * A naive "collect every `format` key at any depth" walker reports false
 * positives on data, and false positives are this rule's red line. `default: {
 * format: 'emial' }`, `const`, `enum` and `examples` all hold arbitrary VALUES
 * that ajv never reads as schema — a `format` inside one enforces nothing and
 * was never meant to. So the walk descends only into positions JSON Schema
 * defines as subschemas ({@link SUBSCHEMA_KEYS} and friends), which is exactly
 * the set of places ajv would apply the keyword. Positions ajv does not treat as
 * a schema cannot carry an enforced `format`, so skipping them loses nothing.
 *
 * Non-string `format` values are skipped too, for the complementary reason:
 * `format: 42` fails ajv's own meta-schema check (`data/properties/e/format must
 * be string`), so the compile gate already refuses it by name, and a second
 * finding here would only be noise. Same for `{ format: { $data: '1/f' } }`.
 *
 * ## Scope, and the keys read
 *
 * Object validation rules only, via {@link walkObjectValidationRules} — the same
 * traversal `validate-rule-compilability.ts` uses, shared rather than
 * re-implemented so the two rules can never disagree about which rules exist.
 * That covers `object.validations[]` including the rules nested in a
 * `conditional`'s `then` / `otherwise`, since `evaluateRule` recurses into those
 * and reaches the very same `checkJsonSchema`.
 *
 * | Read                             | Declared by            |
 * |----------------------------------|------------------------|
 * | `objects[].validations[]`        | `ObjectSchema`         |
 * | `validations[].type` / `.name`   | every `*ValidationSchema` variant |
 * | `validations[].schema`           | `JSONValidationSchema` |
 * | `validations[].then`/`.otherwise`| `ConditionalValidationSchema` |
 *
 * Every one is a key `@objectstack/spec` DECLARES; no alias is read, on either
 * side (#4984, #5009, #5017, #5096) — the strict sub-schemas reject an
 * undeclared key by NAME, so a branch keyed on one would be inert for every
 * stack an author can ship.
 *
 * ## Why `error`
 *
 * The severity bar `lint-flow-patterns.ts` states — gate when NO reading of the
 * metadata behaves as written. There is no deployment in which a dropped
 * keyword enforces the author's declared guarantee; it is inert for every
 * record, forever.
 */

import {
  registeredFormatNames,
  walkObjectValidationRules,
} from './validate-rule-compilability.js';

export type RuleSchemaFormatSeverity = 'error';

export interface RuleSchemaFormatFinding {
  severity: RuleSchemaFormatSeverity;
  /** Stable diagnostic rule id (`--json` consumers and allowlists key on it). */
  rule: string;
  /** Human-readable location, e.g. `object 'account' · validation 'support_shape'`. */
  where: string;
  /**
   * Config path of the offending keyword — the rule's `schema` key followed by
   * the RFC 6901 JSON Pointer into it, e.g.
   * `objects.account.validations.support_shape.schema#/properties/email/format`.
   */
  path: string;
  message: string;
  hint: string;
}

/** A `json_schema` rule naming a `format` the runtime's ajv has not registered. */
export const VALIDATION_RULE_SCHEMA_UNKNOWN_FORMAT = 'validation-rule-json-schema-unknown-format';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Keywords whose value IS a subschema. */
const SUBSCHEMA_KEYS = [
  'additionalItems',
  'additionalProperties',
  'contains',
  'propertyNames',
  'if',
  'then',
  'else',
  'not',
  'unevaluatedItems',
  'unevaluatedProperties',
] as const;

/** Keywords whose value is an ARRAY of subschemas. */
const SUBSCHEMA_LIST_KEYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;

/** Keywords whose value is a MAP of name → subschema. */
const SUBSCHEMA_MAP_KEYS = [
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
] as const;

/**
 * Depth cap on the schema walk. Not a cycle guard for parsed metadata — that is
 * a tree — but the same cheap promise `flow-walk.ts`'s `MAX_REGION_DEPTH` and
 * `validate-rule-compilability.ts`'s `MAX_RULE_NESTING_DEPTH` make: `os lint`
 * never parses, so it hands this walker whatever object the author's module
 * actually built, and `const s = { type: 'object' }; s.properties = { self: s };`
 * is a two-line accident. Well past any reviewable schema.
 */
export const MAX_SCHEMA_WALK_DEPTH = 32;

/** RFC 6901 — `~` and `/` are the two characters a pointer segment must escape. */
const escapePointerSegment = (segment: string) => segment.replace(/~/g, '~0').replace(/\//g, '~1');

/** One `format: '<name>'` found at a real schema position. */
interface FormatUse {
  /** JSON Pointer to the `format` KEYWORD, without the leading `#` (e.g. `/properties/email/format`). */
  pointer: string;
  name: string;
}

/**
 * Collect every `format` string reachable from `schema` through positions JSON
 * Schema defines as subschemas. Order is deterministic (declaration order within
 * each keyword group) so findings are stable across runs.
 */
function collectFormatUses(schema: unknown, pointer: string, out: FormatUse[], depth: number): void {
  if (!isRec(schema)) return;

  if (typeof schema.format === 'string') {
    out.push({ pointer: `${pointer}/format`, name: schema.format });
  }

  if (depth >= MAX_SCHEMA_WALK_DEPTH) return;

  for (const key of SUBSCHEMA_KEYS) {
    if (key in schema) {
      collectFormatUses(schema[key], `${pointer}/${escapePointerSegment(key)}`, out, depth + 1);
    }
  }

  for (const key of SUBSCHEMA_LIST_KEYS) {
    const value = schema[key];
    if (!Array.isArray(value)) continue;
    value.forEach((entry, index) => {
      collectFormatUses(entry, `${pointer}/${escapePointerSegment(key)}/${index}`, out, depth + 1);
    });
  }

  for (const key of SUBSCHEMA_MAP_KEYS) {
    const value = schema[key];
    if (!isRec(value)) continue;
    for (const [name, entry] of Object.entries(value)) {
      collectFormatUses(entry, `${pointer}/${escapePointerSegment(key)}/${escapePointerSegment(name)}`, out, depth + 1);
    }
  }

  // `items` is a schema in 2020-12 and an ARRAY of schemas in draft-07's tuple
  // form. ajv accepts both (the runtime pins no `$schema`), so both are walked.
  const items = schema.items;
  if (Array.isArray(items)) {
    items.forEach((entry, index) => collectFormatUses(entry, `${pointer}/items/${index}`, out, depth + 1));
  } else if (isRec(items)) {
    collectFormatUses(items, `${pointer}/items`, out, depth + 1);
  }

  // draft-07 `dependencies`: name → schema OR name → string[]. Only the schema
  // form is a schema position; the string list is data.
  const dependencies = schema.dependencies;
  if (isRec(dependencies)) {
    for (const [name, entry] of Object.entries(dependencies)) {
      if (!isRec(entry)) continue;
      collectFormatUses(entry, `${pointer}/dependencies/${escapePointerSegment(name)}`, out, depth + 1);
    }
  }
}

/** Plain Levenshtein distance. Small inputs (format names are ≤ 26 chars). */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The registered name closest to `name`, or `null` when nothing is close enough
 * to be worth suggesting.
 *
 * The budget scales with the typo's own length — three edits on a twelve-letter
 * name is a plausible slip, three edits on a four-letter one is a different word
 * — so a genuinely invented name (`shoe_size`) gets no suggestion instead of a
 * confident wrong one. Comparison is case-insensitive on the authored side so
 * `Email` is diagnosed as the case typo it is; ajv's own lookup is
 * case-SENSITIVE, which is exactly why `Email` is unregistered in the first
 * place. Ties break alphabetically, so the suggestion is stable.
 */
export function nearestRegisteredFormat(name: string, registered: readonly string[]): string | null {
  const budget = Math.min(3, Math.floor(name.length / 2));
  if (budget < 1) return null;

  const authored = name.toLowerCase();
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of [...registered].sort()) {
    const distance = editDistance(authored, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= budget ? best : null;
}

/**
 * Reject every `json_schema` validation rule that names a `format` the runtime's
 * ajv has not registered — the keyword ajv logs once and drops, leaving the rule
 * declared and inert. Pure `(stack) => Finding[]`.
 *
 * Lazier than the compile gate on purpose: the registered set is only asked for
 * once a schema actually NAMES a format, so a stack whose `json_schema` rules
 * use none never loads ajv at all (`lazy-deps.test.ts` pins this).
 */
export function validateRuleSchemaFormats(stack: unknown): RuleSchemaFormatFinding[] {
  const findings: RuleSchemaFormatFinding[] = [];

  const pending: Array<{ use: FormatUse; where: string; label: string; objectName: string; basePath: string }> = [];
  for (const { rule, objectName, label, where, basePath } of walkObjectValidationRules(stack)) {
    if (rule.type !== 'json_schema' || !isRec(rule.schema)) continue;
    const uses: FormatUse[] = [];
    collectFormatUses(rule.schema, '', uses, 0);
    for (const use of uses) pending.push({ use, where, label, objectName, basePath });
  }
  if (pending.length === 0) return findings;

  const registered = registeredFormatNames();
  const known = new Set(registered);

  for (const { use, where, label, objectName, basePath } of pending) {
    if (known.has(use.name)) continue;
    const suggestion = nearestRegisteredFormat(use.name, registered);
    const pointer = `#${use.pointer}`;
    findings.push({
      severity: 'error',
      rule: VALIDATION_RULE_SCHEMA_UNKNOWN_FORMAT,
      where,
      path: `${basePath}.schema${pointer}`,
      message:
        `\`json_schema\` validation ${label} on object '${objectName}' names \`format: '${use.name}'\` at ` +
        `\`${pointer}\`, which is not a registered format. ajv logs \`unknown format "${use.name}" ignored\` ` +
        `once at compile time and DROPS the keyword — in the write path (rule-validator.ts, ` +
        `\`strict: false\`) and in the publish gate alike — so the schema compiles, the rule ships and runs ` +
        `on every write, its \`type\`/\`required\` keywords are enforced, and this constraint is enforced ` +
        `on no record, ever. The record is ACCEPTED, so nothing downstream reports the gap either.`,
      hint:
        (suggestion ? `Did you mean \`format: '${suggestion}'\`? ` : '') +
        `The registered names are: ${registered.join(', ')} — the default \`ajv-formats\` set, the one ` +
        `\`rule-validator.ts\` registers (#5029). Names are case-sensitive and hyphenated ` +
        `(\`date-time\`, not \`datetime\`). If you meant a constraint ajv has no format for, express it ` +
        `with \`pattern\` instead — a regex is enforced, an unknown format name is not.`,
    });
  }

  return findings;
}
