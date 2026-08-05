// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { suggestFieldType, formatSuggestion, findClosestMatches } from './suggestions.zod';
import { FieldType } from '../data/field.zod';

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
}

/** One indent step of a formatted issue line. */
const ISSUE_INDENT = '  ';

/**
 * How many levels of nested `invalid_union` are expanded below a top-level
 * issue. Unions nest (a union member that is itself a union — `StateMachine →
 * on.GO → actions[0]` is two levels in this repo today), and each level can
 * render several branches, so the expansion is bounded rather than left to the
 * shape of whatever the author typed.
 */
const UNION_EXPANSION_DEPTH_LIMIT = 3;

/** How many equally-informative branches are rendered at one level. */
const UNION_BRANCH_RENDER_LIMIT = 3;

/**
 * True when a branch only complains that the value is the wrong *kind* at the
 * branch root — `expected string, received object` for the string member of
 * `z.union([z.string(), SomeObject])`.
 *
 * Such a branch carries no prescription: the author never intended it, and
 * printing it is the "N branches, N times the noise" failure that made
 * `view.zod.ts`'s `submitBehavior` reach for `discriminatedUnion`. An empty
 * branch (the `invalid_union` "matched multiple" variant carries `errors: []`)
 * counts as uninformative too — `every` on an empty list is `true`.
 */
function isKindMismatchOnly(issues: readonly ZodIssueMinimal[]): boolean {
  return issues.every(
    (issue) =>
      issue.path.length === 0 &&
      (issue.code === 'invalid_type' || issue.code === 'invalid_value'),
  );
}

/** True when a branch carries the #4001 campaign's unknown-key prescription. */
function carriesUnknownKey(issues: readonly ZodIssueMinimal[]): boolean {
  return issues.some((issue) => issue.code === 'unrecognized_keys');
}

/**
 * Pick the branch(es) of a failed union whose issues actually explain the
 * failure.
 *
 * Ranking, in order:
 *
 * 1. **Kind-mismatch-only branches are dropped entirely** (see
 *    {@link isKindMismatchOnly}). If *every* branch is one — a plain
 *    `z.union([z.string(), z.number()])` handed an object — nothing is
 *    selected and the union renders exactly as it always has.
 * 2. **Fewest issues wins.** The branch the author was closest to hitting
 *    complains least: given `z.union([A, B, C])` of strict objects and one
 *    mistyped key, the intended member reports *only* that key while the other
 *    two also report a wrong discriminator and their own missing requireds. So
 *    "fewest" is what keeps a single unknown key from being reported once per
 *    branch.
 * 3. **A branch carrying `unrecognized_keys` breaks a tie**, because that is
 *    where the curated prose lives.
 * 4. Declaration order breaks what remains, so the output is deterministic.
 *
 * Branches that tie at the top are *all* rendered (capped): when two shapes
 * explain the failure equally well, privileging the first one by accident of
 * declaration order would be a lie about which shape was expected.
 */
function selectUnionBranches(
  branches: readonly (readonly ZodIssueMinimal[])[],
): { selected: readonly (readonly ZodIssueMinimal[])[]; omitted: number } {
  const informative = branches
    .map((issues, index) => ({ issues, index }))
    .filter((branch) => !isKindMismatchOnly(branch.issues));

  if (informative.length === 0) return { selected: [], omitted: 0 };

  const rank = (branch: { issues: readonly ZodIssueMinimal[] }): [number, number] => [
    branch.issues.length,
    carriesUnknownKey(branch.issues) ? 0 : 1,
  ];

  const sorted = [...informative].sort((a, b) => {
    const [aCount, aKeys] = rank(a);
    const [bCount, bKeys] = rank(b);
    return aCount - bCount || aKeys - bKeys || a.index - b.index;
  });

  const [bestCount, bestKeys] = rank(sorted[0]!);
  const tied = sorted.filter((branch) => {
    const [count, keys] = rank(branch);
    return count === bestCount && keys === bestKeys;
  });

  return {
    selected: tied.slice(0, UNION_BRANCH_RENDER_LIMIT).map((branch) => branch.issues),
    omitted: Math.max(0, tied.length - UNION_BRANCH_RENDER_LIMIT),
  };
}

/** Render a path array the way the CLI has always rendered it. */
function renderPath(path: PropertyKey[]): string {
  return path.length > 0 ? path.join('.') : '(root)';
}

/**
 * Render one issue and — for `invalid_union` — the selected branches beneath
 * it, one indent level deeper, with paths resolved against the union's own.
 *
 * `seen` de-duplicates leaf lines *within one top-level issue*: two branches
 * that reject the same key with the same words say it once. Union lines
 * themselves are never de-duplicated, since two same-path `"Invalid input"`
 * lines can head genuinely different sub-trees.
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
  const expandable = branches.length > 0 && depth < UNION_EXPANSION_DEPTH_LIMIT;

  if (!expandable) {
    const key = JSON.stringify([depth, rendered, issue.message]);
    if (seen.has(key)) return [];
    seen.add(key);
  }

  const lines = [`${ISSUE_INDENT.repeat(depth + 1)}✗ ${rendered}: ${issue.message}`];
  if (!expandable) return lines;

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
 * The issue **count** stays the count of `error.issues` — the union is one
 * issue no matter how many lines explain it, which keeps this header agreeing
 * with the structural consumers (REST error bodies, `ZodError.message`).
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
