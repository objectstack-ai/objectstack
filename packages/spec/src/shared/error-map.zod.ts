// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { suggestFieldType, formatSuggestion, findClosestMatches } from './suggestions.zod';
import { FieldType } from '../data/field.zod';
import {
  CONTAINER_ISSUE_CODES,
  NESTED_EXPANSION_DEPTH_LIMIT,
  selectUnionBranches,
} from './union-branch-policy';

/**
 * Zod v4 raw issue type used by the error map.
 */
export type ObjectStackRawIssue = z.core.$ZodRawIssue;

/**
 * ObjectStack Custom Zod Error Map
 *
 * Provides contextual, actionable error messages for ObjectStack schema validation.
 * Instead of generic Zod messages like "Invalid option", this error map returns
 * messages that explain the ObjectStack context and suggest fixes.
 *
 * In Zod v4, the error map is a function `(issue) => { message: string } | string | null`.
 * Pass it via the `error` option on `.safeParse()` / `.parse()`.
 *
 * @example
 * ```ts
 * import { objectStackErrorMap } from '@objectstack/spec';
 *
 * // Per-parse usage
 * SomeSchema.safeParse(data, { error: objectStackErrorMap });
 * ```
 */
export const objectStackErrorMap = (issue: ObjectStackRawIssue): { message: string } | null => {
  // --- Invalid value (enum) with suggestions ---
  if (issue.code === 'invalid_value') {
    const values = issue.values as unknown[];
    const input = issue.input;
    const received = String(input ?? '');
    const options = values.map(String);

    // Check if this looks like a FieldType enum
    const fieldTypeOptions = FieldType.options as readonly string[];
    const isFieldTypeEnum = options.length > 10 &&
      fieldTypeOptions.every((ft) => options.includes(ft));

    if (isFieldTypeEnum) {
      const suggestions = suggestFieldType(received);
      const suggestion = formatSuggestion(suggestions);
      const base = `Invalid field type '${received}'.`;
      return {
        message: suggestion ? `${base} ${suggestion}` : `${base} Valid types: ${options.slice(0, 10).join(', ')}...`,
      };
    }

    // Generic enum suggestion
    const suggestions = findClosestMatches(received, options);
    const suggestion = formatSuggestion(suggestions);
    const base = `Invalid value '${received}'.`;
    return {
      message: suggestion
        ? `${base} ${suggestion}`
        : `${base} Expected one of: ${options.join(', ')}.`,
    };
  }

  // --- String/array/number size validation ---
  if (issue.code === 'too_small') {
    const origin = issue.origin as string;
    const minimum = issue.minimum as number;
    if (origin === 'string') {
      return {
        message: `Must be at least ${minimum} character${minimum === 1 ? '' : 's'} long.`,
      };
    }
  }

  if (issue.code === 'too_big') {
    const origin = issue.origin as string;
    const maximum = issue.maximum as number;
    if (origin === 'string') {
      return {
        message: `Must be at most ${maximum} character${maximum === 1 ? '' : 's'} long.`,
      };
    }
  }

  // --- String format validation (regex) ---
  if (issue.code === 'invalid_format') {
    const format = issue.format as string;
    const input = issue.input as string | undefined;
    if (format === 'regex' && input) {
      const pathArr = issue.path as (string | number)[] | undefined;
      const pathStr = pathArr?.join('.') ?? '';
      if (pathStr.endsWith('name') || pathStr === 'name') {
        return {
          message: `Invalid identifier '${input}'. Must be lowercase snake_case (e.g., 'my_object', 'task_name'). No uppercase, spaces, or hyphens allowed.`,
        };
      }
    }
  }

  // --- Missing required / type mismatch ---
  if (issue.code === 'invalid_type') {
    const expected = issue.expected as string;
    const input = issue.input;
    if (input === undefined) {
      const pathArr = issue.path as (string | number)[] | undefined;
      const field = pathArr?.[pathArr.length - 1] ?? '';
      return {
        message: `Required property '${field}' is missing.`,
      };
    }
    const receivedType = input === null ? 'null' : typeof input;
    return {
      message: `Expected ${expected} but received ${receivedType}.`,
    };
  }

  // --- Unrecognized keys ---
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys as string[];
    const keyStr = keys.join(', ');
    return {
      message: `Unrecognized key${keys.length > 1 ? 's' : ''}: ${keyStr}. Check for typos in property names.`,
    };
  }

  // Fallback to Zod default
  return null;
};

/**
 * Zod Issue interface (subset needed for formatting).
 */
interface ZodIssueMinimal {
  path: PropertyKey[];
  message: string;
  code?: string;
  /**
   * Only on `invalid_union`: one issue list **per union branch**, with each
   * branch's paths RELATIVE to the union issue's own path. Zod raises a single
   * `invalid_union` issue whose own `message` is the literal `"Invalid input"`,
   * so everything a failing branch has to say lives down here.
   */
  errors?: readonly (readonly ZodIssueMinimal[])[];
  /**
   * [#5389] Only on `invalid_key` / `invalid_element`: the ONE issue list the
   * failing key / element schema produced, with paths RELATIVE to this issue's
   * own path — the same relationship `errors` has, spelled with a different
   * property name and without the per-branch nesting (a container has one
   * inner schema, not N alternatives).
   *
   * The distinction that makes this a separate field rather than a second
   * shape of `errors`: a union's branches are *candidates* and have to be
   * ranked ({@link selectUnionBranches}), while these issues are simply what
   * went wrong — every one of them is true and none of them is speculative.
   */
  issues?: readonly ZodIssueMinimal[];
}

/** One indent step of a formatted issue line. */
const ISSUE_INDENT = '  ';

/** Render a path array the way the CLI has always rendered it. */
function renderPath(path: PropertyKey[]): string {
  return path.length > 0 ? path.join('.') : '(root)';
}

/**
 * Render one issue and — for `invalid_union`, and since #5389 for
 * `invalid_key` / `invalid_element` — the issues beneath it, one indent level
 * deeper, with paths resolved against the parent issue's own.
 *
 * The two descents differ in exactly one way, and it is the reason they are not
 * merged into one loop: a union's branches are competing CANDIDATES, so they
 * are ranked and capped ({@link selectUnionBranches}) to keep one mistake from
 * being reported once per member; a container's `issues` are the one list the
 * key/element schema actually produced, so every one of them is rendered —
 * there is no branch to choose between and nothing to omit.
 *
 * [#8318] The ranking, the two limits and {@link CONTAINER_ISSUE_CODES} are NOT
 * declared here: they are the package-internal policy in
 * `./union-branch-policy.ts`, which `../api/zod-issues-to-fields.ts` imports
 * too. This walk owns the PROSE — the indent, the `✗` glyph, the `(root)`
 * spelling and the trailing "… and N more branches" line the wire deliberately
 * omits — and nothing about which branches explain the failure. ⛔ Do not
 * re-declare the ranking here to tune the rendering; a verdict that differs
 * between the terminal and the API is the defect #5014 named, and
 * `union-branch-policy.parity.test.ts` will refuse it.
 *
 * `seen` de-duplicates leaf lines *within one top-level issue*: two branches
 * that reject the same key with the same words say it once. Expanded lines
 * (union and container heads) are themselves never de-duplicated, since two
 * same-path wrapper lines can head genuinely different sub-trees.
 */
function renderIssue(
  issue: ZodIssueMinimal,
  parentPath: PropertyKey[],
  depth: number,
  seen: Set<string>,
): string[] {
  const path = [...parentPath, ...issue.path];
  const rendered = renderPath(path);
  const branches = issue.code === 'invalid_union' ? (issue.errors ?? []) : [];
  const contained = issue.code && CONTAINER_ISSUE_CODES.has(issue.code) ? (issue.issues ?? []) : [];
  const expandable =
    (branches.length > 0 || contained.length > 0) && depth < NESTED_EXPANSION_DEPTH_LIMIT;

  if (!expandable) {
    const key = JSON.stringify([depth, rendered, issue.message]);
    if (seen.has(key)) return [];
    seen.add(key);
  }

  const lines = [`${ISSUE_INDENT.repeat(depth + 1)}✗ ${rendered}: ${issue.message}`];
  if (!expandable) return lines;

  if (branches.length > 0) {
    const { selected, omitted } = selectUnionBranches(branches);
    for (const branch of selected) {
      for (const nested of branch) {
        lines.push(...renderIssue(nested, path, depth + 1, seen));
      }
    }
    if (selected.length > 0 && omitted > 0) {
      lines.push(
        `${ISSUE_INDENT.repeat(depth + 2)}… and ${omitted} more branch${omitted === 1 ? '' : 'es'} rejected this value`,
      );
    }
    return lines;
  }

  for (const nested of contained) {
    lines.push(...renderIssue(nested, path, depth + 1, seen));
  }
  return lines;
}

/**
 * Format a single Zod issue into human-readable line(s).
 *
 * One line for an ordinary issue. For an `invalid_union`, the union's own line
 * (zod's literal `"Invalid input"`) is followed by the branch issues that
 * explain the rejection, indented one level and carrying absolute paths —
 * without this, every rejection behind a union arrives at the author as
 * `✗ (root): Invalid input` with the prescription stranded in the payload
 * (#4971). Branch selection is described on {@link selectUnionBranches}.
 *
 * @param issue - A single Zod issue
 * @returns Formatted string; multi-line when a union is expanded
 */
export function formatZodIssue(issue: ZodIssueMinimal): string {
  return renderIssue(issue, [], 0, new Set<string>()).join('\n');
}

/**
 * Pretty-print Zod validation errors for CLI output.
 *
 * Formats a ZodError into a readable block suitable for terminal display.
 * Groups errors by path depth and includes a summary count.
 *
 * @param error - A ZodError to format
 * @param label - Optional label for the error block (e.g., 'Stack validation failed')
 * @returns Formatted multi-line string
 *
 * @example
 * ```ts
 * import { formatZodError, ObjectStackDefinitionSchema } from '@objectstack/spec';
 *
 * const result = ObjectStackDefinitionSchema.safeParse(data);
 * if (!result.success) {
 *   console.error(formatZodError(result.error, 'Stack validation failed'));
 * }
 * ```
 *
 * Output:
 * ```
 * Stack validation failed (3 issues):
 *
 *   ✗ manifest.name: Required property 'name' is missing.
 *   ✗ objects[0].fields.status.type: Invalid field type 'dropdown'. Did you mean 'select'?
 *   ✗ views[0].object: Invalid identifier 'MyTasks'. Must be lowercase snake_case.
 * ```
 *
 * A rejection behind a `z.union` is expanded one level deeper, so the branch's
 * message reaches the author instead of zod's bare `"Invalid input"` (#4971):
 * ```
 * Validation failed (1 issue):
 *
 *   ✗ states.s.on.GO.actions.0: Invalid input
 *     ✗ states.s.on.GO.actions.0: Unrecognized key(s) on this action reference: `args`. …
 * ```
 *
 * [#5389] `invalid_key` / `invalid_element` hide their diagnosis the same way —
 * on `issue.issues` rather than `issue.errors` — and are expanded the same way,
 * so a constrained `z.record` KEY reaches the author as the key schema's own
 * words instead of zod's bare `"Invalid key in record"`:
 * ```
 * Validation failed (1 issue):
 *
 *   ✗ fields.First Name: Invalid key in record
 *     ✗ fields.First Name: Invalid identifier 'First Name'. Must be lowercase snake_case …
 * ```
 *
 * The issue **count** stays the count of `error.issues` — the union (or the
 * container) is one issue no matter how many lines explain it, which keeps this
 * header agreeing with the structural consumers (REST error bodies,
 * `ZodError.message`).
 */
export function formatZodError(error: z.ZodError, label?: string): string {
  const count = error.issues.length;
  const header = label
    ? `${label} (${count} issue${count === 1 ? '' : 's'}):`
    : `Validation failed (${count} issue${count === 1 ? '' : 's'}):`;

  const lines = error.issues.map(formatZodIssue);

  return `${header}\n\n${lines.join('\n')}`;
}

/**
 * Parse with the ObjectStack error map and return formatted errors.
 *
 * A convenience function that combines parsing with the custom error map
 * and pretty-print formatting. Returns a discriminated union result.
 *
 * @param schema - Any Zod schema to parse with
 * @param data - Data to validate
 * @param label - Optional label for error formatting
 * @returns Object with `success`, `data`, and optional `formatted` error string
 *
 * @example
 * ```ts
 * const result = safeParsePretty(ObjectStackDefinitionSchema, config, 'objectstack.config.ts');
 * if (!result.success) {
 *   console.error(result.formatted);
 *   process.exit(1);
 * }
 * ```
 */
export function safeParsePretty<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  label?: string,
): { success: true; data: z.infer<T> } | { success: false; error: z.ZodError; formatted: string } {
  const result = schema.safeParse(data, { error: objectStackErrorMap });
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error,
    formatted: formatZodError(result.error, label),
  };
}
