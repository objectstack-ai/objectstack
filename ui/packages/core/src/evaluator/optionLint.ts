/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Build-time / authoring guardrail for cascading `select` options (#1583, #2284).
 *
 * A per-option `visibleWhen` predicate (see {@link ./optionRules.js}) fails
 * *closed*: a broken or wrong predicate makes its option silently never show.
 * That is invisible at runtime — the offered set just quietly lacks a value —
 * so the class of bug this catches is exactly the one runtime fail-open can't
 * surface. The motivating case (#2284) is an AI-authored literal typo:
 *
 *   { value: 'zj', visibleWhen: "record.country == 'chna'" }   // 'chna' ≠ 'cn'
 *
 * `country`'s own options are `cn` / `us`, so `record.country` can never equal
 * `'chna'` and Zhejiang is unreachable. The reference *parses*, the field
 * *exists* — only the compared literal is outside the controlling field's value
 * domain, which no syntax/existence check knows about. This linter closes that
 * hole by cross-checking each option predicate against its sibling fields.
 *
 * Three checks, in order of confidence:
 *   1. `syntax`      — the predicate is valid CEL. Delegated to the canonical
 *                      `@objectstack/formula` `validateExpression` (no schema
 *                      hint → pure parse validation, so a legitimate
 *                      `current_user.positions` reference is never flagged).
 *   2. `unknown-field` — a `record.<name>` reference names a field the form
 *                      doesn't declare (a sibling typo, `record.contry`).
 *   3. `option-literal-not-in-domain` — a `record.<enum> == '<literal>'` (or
 *                      `!=` / `in [...]`) compares against a value outside that
 *                      *enum* sibling's declared option set (the `'chna'` case).
 *
 * Deliberately **conservative**: it only flags what it can statically prove and
 * never guesses. Anything it can't resolve — a non-`record.` root
 * (`current_user.*`), a reference to a non-enum field (free text / number /
 * lookup, whose domain is open), a comparison it doesn't recognise — is left
 * alone. False positives would train authors to ignore it, so there are none by
 * construction; it is a safety net, not a schema validator.
 */
import { validateExpression } from '@objectstack/formula';
import type { FieldRulePredicate } from './fieldRules.js';
import type { DependsOnInput, OptionLike } from './optionRules.js';

/** Field types whose value set is a closed, statically-known enum. */
const OPTION_FIELD_TYPES = new Set(['select', 'radio', 'multiselect']);

/** A lint finding on one option's `visibleWhen` predicate. */
export interface OptionLintIssue {
  /** Name of the `select`/`radio` field that owns the option (`''` if unnamed). */
  field: string;
  /** `value` of the option whose predicate is faulty. */
  option: string;
  /** Machine-readable finding kind. */
  code: 'syntax' | 'unknown-field' | 'option-literal-not-in-domain';
  /** Human-readable, self-correcting explanation. */
  message: string;
}

/**
 * Minimal field shape the linter reads — structurally satisfied by
 * `FormFieldConfig`, `SelectFieldMetadata`, and a bare object-schema field.
 * Only `name`, the type (`type` or `widget`), `options`, and `dependsOn` are
 * consulted.
 */
export interface LintFieldLike {
  name?: string;
  type?: string;
  widget?: string;
  dependsOn?: DependsOnInput;
  options?: readonly OptionLike[] | null;
}

/** The literal source of a predicate (`string` or `{ source }` envelope). */
function predicateSource(pred: FieldRulePredicate): string {
  return typeof pred === 'string' ? pred : (pred?.source ?? '');
}

/** Resolved value type of a field, or `select`/`radio`/`multiselect` for enums. */
function fieldType(f: LintFieldLike): string {
  return (f.widget || f.type || '').toString();
}

/** All `record.<name>` field references in a predicate source. */
function recordRefs(source: string): string[] {
  const refs: string[] = [];
  const re = /record\.([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) refs.push(m[1]);
  return refs;
}

/**
 * Every `(field, literal)` pair where the predicate compares a `record.<field>`
 * to a string literal via `==`, `!=`, or `in [...]` — the forms whose literal
 * can be domain-checked. Recognises both operand orders for equality. Anything
 * else (ranges, function calls, arithmetic) yields nothing and is skipped.
 */
function literalComparisons(source: string): Array<{ field: string; literal: string }> {
  const out: Array<{ field: string; literal: string }> = [];

  // record.field == 'lit'  /  record.field != 'lit'
  const eqRight = /record\.([A-Za-z_$][\w$]*)\s*[=!]=\s*'([^']*)'/g;
  // 'lit' == record.field  /  'lit' != record.field
  const eqLeft = /'([^']*)'\s*[=!]=\s*record\.([A-Za-z_$][\w$]*)/g;
  // record.field in ['a', 'b', ...]
  const inList = /record\.([A-Za-z_$][\w$]*)\s+in\s+\[([^\]]*)\]/g;

  let m: RegExpExecArray | null;
  while ((m = eqRight.exec(source)) !== null) out.push({ field: m[1], literal: m[2] });
  while ((m = eqLeft.exec(source)) !== null) out.push({ field: m[2], literal: m[1] });
  while ((m = inList.exec(source)) !== null) {
    const field = m[1];
    const listRe = /'([^']*)'/g;
    let lm: RegExpExecArray | null;
    while ((lm = listRe.exec(m[2])) !== null) out.push({ field, literal: lm[1] });
  }
  return out;
}

/**
 * Statically lint the per-option `visibleWhen` predicates of a field list
 * (a form's `fields`, or an object's fields) and return every provable issue.
 * An empty array means nothing was disprovable — not that every predicate is
 * semantically correct (see the conservative-by-design note above).
 *
 * @param fields  Sibling fields sharing one record scope. Enum fields
 *                (`select`/`radio`/`multiselect`) contribute their option
 *                `value`s as the value domain for cross-checks.
 */
export function lintOptionPredicates(fields: readonly LintFieldLike[] | null | undefined): OptionLintIssue[] {
  if (!fields || fields.length === 0) return [];

  const knownFields = new Set<string>();
  // Value domain of each *enum* field; fields with an open domain are absent.
  const domainByField = new Map<string, Set<string>>();
  for (const f of fields) {
    if (!f?.name) continue;
    knownFields.add(f.name);
    if (OPTION_FIELD_TYPES.has(fieldType(f)) && f.options && f.options.length > 0) {
      // Values stringify at this boundary (#3090 widened OptionLike.value):
      // the domain is compared against CEL literal TEXT, so the canonical
      // string form is the right footing for numeric/boolean options too.
      domainByField.set(f.name, new Set(f.options.map((o) => String(o.value))));
    }
  }

  const issues: OptionLintIssue[] = [];
  for (const f of fields) {
    if (!OPTION_FIELD_TYPES.has(fieldType(f)) || !f.options) continue;
    const field = f.name ?? '';
    for (const opt of f.options) {
      if (opt?.visibleWhen == null) continue;
      const source = predicateSource(opt.visibleWhen);
      if (!source.trim()) continue;
      const option = String(opt.value); // report key — display form (#3090)

      // 1. Syntax — canonical CEL parse (no schema hint = no scope false-positives).
      const parsed = validateExpression('predicate', source);
      if (!parsed.ok) {
        issues.push({
          field,
          option,
          code: 'syntax',
          message: parsed.errors[0]?.message ?? `invalid CEL predicate: ${source}`,
        });
        // Extraction below trusts a parseable source; skip it for broken CEL.
        continue;
      }

      // 2. Unknown sibling field — a `record.<name>` the form never declares.
      for (const ref of recordRefs(source)) {
        if (!knownFields.has(ref)) {
          issues.push({
            field,
            option,
            code: 'unknown-field',
            message: `option '${option}' visibleWhen references record.${ref}, which is not a field of this form`,
          });
        }
      }

      // 3. Literal outside the controlling enum's value domain (the #2284 case).
      for (const { field: ref, literal } of literalComparisons(source)) {
        const domain = domainByField.get(ref);
        if (domain && !domain.has(literal)) {
          issues.push({
            field,
            option,
            code: 'option-literal-not-in-domain',
            message:
              `option '${option}' visibleWhen compares record.${ref} to '${literal}', ` +
              `which is not one of ${ref}'s option values (${[...domain].map((v) => `'${v}'`).join(', ')})`,
          });
        }
      }
    }
  }
  return issues;
}
