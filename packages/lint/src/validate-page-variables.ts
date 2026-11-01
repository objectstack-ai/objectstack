// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Page variable declarations (#28663): a page's `variables` list must name each
 * variable once, by a non-empty name, with a `defaultValue` of its declared type.
 *
 * ## Why the parse does not already say so
 *
 * `PageVariableSchema` (`@objectstack/spec/ui`) types each entry on its own —
 * `name: string`, `type` from a closed enum defaulting to `string`,
 * `defaultValue: unknown` — and nothing judges the LIST, or the default against
 * the type beside it. So each of these published `valid: true`, and the console
 * (`usePageVariables`, which seeds the store from the declarations) did
 * something the author never asked for:
 *
 * | declaration | what the console does |
 * |---|---|
 * | the same `name` twice | keeps the LAST entry: the first one's type and default are gone |
 * | `name: ''` (or blank) | stores it under a key no `page.NAME` read can spell |
 * | `type: 'number', defaultValue: 'abc'` | seeds the string: `page.count > 0` compares text |
 *
 * A rule here rather than a refinement on the schema: the spec is not this
 * card's to change, and the rule reaches every door that already runs the page
 * rules — `os validate` / `os build` / `os lint` and the page save door (draft
 * `_diagnostics`, publish) — with one verdict.
 *
 * ## What a default of the declared type is
 *
 * The console's own empty value for each type is the yardstick
 * (`usePageVariables`: `0`, `false`, `{}`, `[]`, `''`):
 *
 * | `type` | admitted `defaultValue` |
 * |---|---|
 * | `string`, `record_id` | a string (`''` included) |
 * | `number` | a finite number |
 * | `boolean` | `true` / `false` |
 * | `object` | a plain object (not an array) |
 * | `array` | an array |
 *
 * An absent `defaultValue` is the console's empty value and is never judged.
 * `null` is admitted for every type: it is "no value yet" (a `record_id` with no
 * record picked), not a value of another type. An absent `type` is the parse's
 * default, `string`, and is judged as one — the console reads it so too.
 *
 * Out of scope here, and NOT judged: a `source` naming a component the page
 * does not hold, and a predicate reading a `page.NAME` the page does not
 * declare.
 */

import { collectionEntries } from './collection-entries.js';

type AnyRec = Record<string, unknown>;

/** Two entries of one page's `variables` share a name. */
export const PAGE_VARIABLE_NAME_DUPLICATE = 'page-variable-name-duplicate';
/** An entry of a page's `variables` has an empty or blank name. */
export const PAGE_VARIABLE_NAME_EMPTY = 'page-variable-name-empty';
/** An entry's `defaultValue` is not a value of its declared `type`. */
export const PAGE_VARIABLE_DEFAULT_TYPE = 'page-variable-default-type';

export interface PageVariableFinding {
  severity: 'error';
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `page "vars_page"`. */
  where: string;
  /** Config path, e.g. `pages[0].variables[1].name`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

/** The value the console seeds per type, quoted in the default-type hint. */
const EMPTY_VALUE: Record<string, string> = {
  string: "''",
  record_id: "''",
  number: '0',
  boolean: 'false',
  object: '{}',
  array: '[]',
};

/** What a value of each type is, in the words a verdict names it with. */
const TYPE_NOUN: Record<string, string> = {
  string: 'a string',
  record_id: 'a record id string',
  number: 'a number',
  boolean: '`true` or `false`',
  object: 'an object',
  array: 'an array',
};

function isPlainObject(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Does `value` belong to the declared `type`? Unknown types are not judged. */
function defaultMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
    case 'record_id':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    default:
      // A type outside the enum is the parse's refusal, not this rule's.
      return true;
  }
}

/** The JS kind of a refused default, for the verdict. */
function kindOf(value: unknown): string {
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return 'a string';
  if (typeof value === 'number') return 'a number';
  if (typeof value === 'boolean') return 'a boolean';
  return `a ${typeof value}`;
}

/** A default as it appears in a verdict: short, one line. */
function quoteValue(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

export function validatePageVariables(stack: AnyRec): PageVariableFinding[] {
  const findings: PageVariableFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  for (const { rec: page, path: pagePath } of collectionEntries(stack.pages, 'pages')) {
    if (!Array.isArray(page.variables)) continue;
    const where = `page "${typeof page.name === 'string' ? page.name : pagePath}"`;
    const firstIndex = new Map<string, number>();

    for (let i = 0; i < page.variables.length; i++) {
      const v = page.variables[i];
      if (!isPlainObject(v)) continue;
      const variable = v as AnyRec;
      const at = `${pagePath}.variables[${i}]`;
      const name = typeof variable.name === 'string' ? variable.name : undefined;
      const type = typeof variable.type === 'string' ? variable.type : 'string';

      if (
        Object.prototype.hasOwnProperty.call(variable, 'defaultValue')
        && variable.defaultValue !== undefined
        && variable.defaultValue !== null
        && !defaultMatches(type, variable.defaultValue)
      ) {
        const label = name && name.trim() ? `\`${name}\`` : `#${i}`;
        findings.push({
          severity: 'error',
          rule: PAGE_VARIABLE_DEFAULT_TYPE,
          where,
          path: `${at}.defaultValue`,
          message:
            `page variable ${label} is declared \`${type}\` but its \`defaultValue\` ` +
            `${quoteValue(variable.defaultValue)} is ${kindOf(variable.defaultValue)}, so the page starts ` +
            `with a value of the wrong type and every read of it compares the wrong kind of value`,
          hint:
            `Give it ${TYPE_NOUN[type] ?? `a ${type}`} as \`defaultValue\` (or omit it for ` +
            `\`${EMPTY_VALUE[type] ?? 'the empty value'}\`), or declare the \`type\` the default has`,
        });
      }

      // A name that is not a string at all is the parse's refusal.
      if (name === undefined) continue;
      if (!name.trim()) {
        findings.push({
          severity: 'error',
          rule: PAGE_VARIABLE_NAME_EMPTY,
          where,
          path: `${at}.name`,
          message:
            `page variable #${i} has no name, so no \`page.NAME\` read can reach it and no element ` +
            'can be bound to write it',
          hint: 'Name the variable — readers reference it as `page.NAME` — or remove the entry',
        });
        continue;
      }
      const first = firstIndex.get(name);
      if (first === undefined) {
        firstIndex.set(name, i);
        continue;
      }
      findings.push({
        severity: 'error',
        rule: PAGE_VARIABLE_NAME_DUPLICATE,
        where,
        path: `${at}.name`,
        message:
          `page variable \`${name}\` is declared twice (here and at \`variables[${first}]\`), so the page ` +
          'keeps only the last declaration and the other one\'s type and default are silently dropped',
        hint: `Rename one of the two \`${name}\` variables, or remove the duplicate entry`,
      });
    }
  }

  return findings;
}
