// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Rendering a zod rejection so an AUTHOR can act on it.
 *
 * Written for #5020 (`<ObjectChart aggregate={…}>` against
 * `ChartAggregateSchema`) and lifted here at #5068, where a second gate —
 * the SDUI component-props gate, which safeParses `ComponentPropsMap[type]`
 * against a page component's `properties` bag — needs the identical rendering.
 * Two copies of this would drift in exactly the way #5020's own note describes
 * about the contract it replaced: the value is in there being one function.
 *
 * Two things zod 4 does not do for us, both measured against real schemas
 * rather than assumed:
 *
 * 1. **Union arms collapse.** A union's arm failures never reach
 *    `error.issues` — the whole union is reported as ONE `invalid_union` whose
 *    own `message` is the bare string `"Invalid input"`, with the named arm
 *    messages tucked inside `issue.errors` (one array per arm). Reporting it
 *    verbatim would tell an author only that *something* about the value is
 *    wrong, which is precisely the class of unhelpful diagnostic these gates
 *    exist to replace. `aggregate.groupBy` is a union (`ChartGroupBySchema` —
 *    bare field name or `{ field, dateGranularity?, alias? }`) and so is
 *    `RecordHighlightsProps.fields[]` (`RecordHighlightsField` — bare field
 *    name or `{ name, label?, icon?, type?, readonly? }`), so this is the
 *    common path on both surfaces. **As of #5583 it is also the only thing
 *    carrying a STRICT rejection out of a union arm**: `ChartGroupBySchema`'s
 *    object arm is a `strictObject` now, and the `unrecognized_keys` it raises
 *    collapses exactly like any other arm failure — so this unpacking, not the
 *    schema, is what puts the named surface and the rename in front of the
 *    author. `validate-react-page-props.test.ts` pins that end to end; deleting
 *    the unpacking turns it red while `packages/spec`'s own tests stay green.
 * 2. **The offending value is dropped.** `Invalid option: expected one of
 *    "count"|"sum"|…` never echoes what was actually written, and the
 *    hand-rolled check #5020 replaced did (`aggregate.function "median" is not
 *    an aggregation…`). It is recovered from the INPUT by path — generic, and
 *    no contract knowledge restated here to do it.
 */

/**
 * The subset of a zod issue these gates read. Declared structurally rather than
 * imported as `z.core.$ZodIssue` so `packages/lint` keeps its single spec
 * dependency and does not take a direct zod one for two field reads.
 */
export interface LintZodIssue {
  readonly code: string;
  readonly message: string;
  readonly path: ReadonlyArray<PropertyKey>;
  /** Present on `invalid_union` only: the arms' own issues, one array each. */
  readonly errors?: ReadonlyArray<ReadonlyArray<LintZodIssue>>;
  /** Present on `unrecognized_keys` only: the keys the strict object refused. */
  readonly keys?: ReadonlyArray<string>;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export const valueAtPath = (root: unknown, path: ReadonlyArray<PropertyKey>): unknown => {
  let cur: unknown = root;
  for (const key of path) {
    if (!isRec(cur) && !Array.isArray(cur)) return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
};

/** The author's own value, short enough to sit inside a diagnostic. */
export const preview = (value: unknown): string => {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
};

/** One rejected value's issue, rendered so an author can act on it. */
export function describeIssue(issue: LintZodIssue, root: unknown, depth = 0): string {
  const value = depth === 0 ? valueAtPath(root, issue.path) : undefined;
  // Suppressed in the two cases where it would only repeat what the message
  // already says: a `custom` refinement names the missing key itself, and zod's
  // `invalid_type` text ends in `received <type>` of its own accord. What is
  // left is where the value genuinely is missing from the diagnostic — the enum
  // rejections and the collapsed `invalid_union` (whose message is just
  // "Invalid input").
  const seen =
    depth > 0 || issue.code === 'custom' || issue.message.includes('received ')
      ? ''
      : value === undefined
        ? ' (nothing is set there)'
        : ` (received ${preview(value)})`;

  // Deliberately NOT `Array.isArray(issue.errors)`: that narrows a
  // `ReadonlyArray<…>` to `any[]` and silently drops the element type, which is
  // the TS7006 trap AGENTS.md names — the arms below would then be `any`.
  const armIssues = issue.code === 'invalid_union' ? issue.errors : undefined;
  if (!armIssues || armIssues.length === 0) {
    return `${issue.message}${seen}`;
  }

  const arms = armIssues
    .map((arm) =>
      arm
        .map((inner) => {
          const where = inner.path.length ? `${inner.path.join('.')} — ` : '';
          return `${where}${describeIssue(inner, root, depth + 1)}`;
        })
        .join('; '),
    )
    .filter((text) => text.length > 0);
  if (arms.length === 0) return `${issue.message}${seen}`;
  return (
    `${issue.message}${seen} — no accepted form matched: ` +
    arms.map((text, i) => `(${i + 1}) ${text}`).join(' ')
  );
}
