// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inputs of a STORED computed field's `expression` — the two the write
 * cannot keep current.
 *
 * A field that is not a `formula` and declares an `expression` is a stored
 * computed field (`packages/spec/src/data/field.zod.ts`, the `expression`
 * describe): the engine computes the expression from the row the write stores
 * and stores the result, on every insert and every update by id
 * (`planStoredExpressions` / `computeStoredExpressions` in
 * `packages/objectql/src/engine-top-level.ts`). It evaluates through the same
 * formula plan a `formula` read uses (`applyFormulaPlan`), so it reads what a
 * formula reads: the record, ONE hop through a reference field, the clock, and
 * the acting user. Two of those are not facts of the row, and the stored value
 * keeps what they were at the write:
 *
 *  - **A read of another record** (`record.employee.daily_hours`), the one hop
 *    the plan preloads, read as the writer. When that record changes, nothing
 *    computes this row again, so the stored value goes stale with no signal.
 *    Warned (`warning`, {@link STORED_EXPRESSION_CROSS_RECORD_INPUT}): the
 *    ruling is to refuse or warn at authoring, never to build a cross-record
 *    recompute engine, and the lane warns because a first-party title is
 *    stored on purpose in this shape (an import matches a record by its stored
 *    title) and the drift is repairable (`os migrate stored-expressions
 *    --changed`). The hop is judged through the definitions the registry
 *    SERVES the object with (`fieldDefOf`): a field an object extension adds
 *    and a reference column the registry injects (`owner_id`, `created_by`,
 *    `updated_by`) count like a declared one. A read of the hop's `id` is the
 *    reference this row stores, so it is not one.
 *  - **A volatile input** — the clock (`now()`, `today()`, `daysFromNow()`,
 *    `daysAgo()`, the four stdlib functions that read the evaluation's `now`),
 *    the acting user (`current_user`, `user`, `ctx.user`, `os.user`, the four
 *    spellings `buildScope` mounts the one `EvalUser` under, each member also
 *    counted in its index spelling `ctx['user']` / `os['user']`), and the acting
 *    user's permissions (`can()`, `hasCapability()`, the two receiver methods
 *    the permission binding answers). Each holds the value of the moment of
 *    the write, where the same expression on a `formula` is computed again on
 *    every read. Warned (`warning`, {@link STORED_EXPRESSION_VOLATILE_INPUT}),
 *    the ruled direction: the value is legal and sometimes meant (who last
 *    wrote the row), so the author is told, not refused.
 *
 * `os.org` is not volatile: it is the writer's organization, which is the
 * row's. `label()` reads the DECLARED option labels for a stored value, never
 * the reader's locale, so it is not volatile either.
 *
 * Judged on the stored field only; a `formula` field reading the same inputs is
 * computed on every read and is not reported. The reasoning an author needs
 * once lives in `os explain` (`rule-explanations.ts`), not in the finding.
 */
import { analyzeRelationshipTraversals, parseCelToAst } from '@objectstack/formula';
import { referenceTargetOf } from '@objectstack/spec/data';

/** A stored field's `expression` reads another record through a reference: warned. */
export const STORED_EXPRESSION_CROSS_RECORD_INPUT = 'stored-expression-cross-record-input';

/** A stored field's `expression` reads the clock, the acting user or a permission: warned. */
export const STORED_EXPRESSION_VOLATILE_INPUT = 'stored-expression-volatile-input';

/** The stdlib functions that read the evaluation's clock (`stdlib.ts`, `registerBoundStdLib`). */
const CLOCK_FUNCTIONS: ReadonlySet<string> = new Set(['now', 'today', 'daysFromNow', 'daysAgo']);

/** The receiver methods the permission binding answers for the acting user (`stdlib.ts`). */
const PERMISSION_METHODS: ReadonlySet<string> = new Set(['can', 'hasCapability']);

/** The roots `buildScope` mounts the acting user under directly. */
const USER_ROOTS: ReadonlySet<string> = new Set(['current_user', 'user']);

/** The namespace roots that hold the acting user one member down (`ctx.user`, `os.user`). */
const USER_NAMESPACE_ROOTS: ReadonlySet<string> = new Set(['ctx', 'os']);

/** The CEL comprehension macros: each binds its first argument as a loop variable. */
const COMPREHENSION_MACROS: ReadonlySet<string> = new Set(['all', 'exists', 'exists_one', 'map', 'filter']);

/** What a volatile input makes the stored value, by kind, in reading order. */
const VOLATILE_KIND_ORDER = ['clock', 'user', 'permission'] as const;
type VolatileKind = (typeof VOLATILE_KIND_ORDER)[number];

const VOLATILE_CONSEQUENCE: Readonly<Record<VolatileKind, string>> = {
  clock: 'the date or time of the last write, which does not move as time passes',
  user: 'the user who last wrote the record, not the one reading it',
  permission: 'the writer\'s permission at that write, not the reader\'s',
};

/** One volatile read, spelled as the author wrote it. */
interface VolatileRead {
  kind: VolatileKind;
  spelling: string;
}

/** One finding of this member, in the shape `validate-expressions.ts` collects. */
export interface StoredExpressionInputIssue {
  rule: typeof STORED_EXPRESSION_CROSS_RECORD_INPUT | typeof STORED_EXPRESSION_VOLATILE_INPUT;
  message: string;
  severity: 'warning';
}

interface CelNode {
  op: string;
  args: unknown;
}

function isCelNode(node: unknown): node is CelNode {
  return !!node && typeof node === 'object' && !Array.isArray(node) && typeof (node as CelNode).op === 'string';
}

function idName(node: unknown): string | undefined {
  return isCelNode(node) && node.op === 'id' && typeof node.args === 'string' ? node.args : undefined;
}

/**
 * The volatile reads in one parsed expression, in source order, each spelling
 * once. A comprehension's loop variable shadows a root of the same name inside
 * its body (`record.items.map(user, user.qty)` reads no acting user).
 */
function volatileReads(ast: unknown): VolatileRead[] {
  const out: VolatileRead[] = [];
  const note = (kind: VolatileKind, spelling: string): void => {
    if (!out.some((r) => r.spelling === spelling)) out.push({ kind, spelling });
  };
  const walk = (node: unknown, bound: ReadonlySet<string>): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, bound);
      return;
    }
    if (!isCelNode(node)) return;
    const { op, args } = node;
    if (op === 'id') {
      if (typeof args === 'string' && USER_ROOTS.has(args) && !bound.has(args)) note('user', args);
      return;
    }
    if ((op === '.' || op === '.?' || op === '[]' || op === '[?]') && Array.isArray(args)) {
      const root = idName(args[0]);
      if (root && USER_NAMESPACE_ROOTS.has(root) && !bound.has(root) && memberName(op, args[1]) === 'user') {
        note('user', `${root}.user`);
        return;
      }
      if (op === '[]' || op === '[?]') {
        walk(args, bound);
        return;
      }
      walk(args[0], bound);
      return;
    }
    if (op === 'call' && Array.isArray(args)) {
      const [name, list] = args as [unknown, unknown];
      if (typeof name === 'string' && CLOCK_FUNCTIONS.has(name)) note('clock', `${name}()`);
      walk(list, bound);
      return;
    }
    if (op === 'rcall' && Array.isArray(args)) {
      const [name, receiver, list] = args as [unknown, unknown, unknown];
      if (typeof name === 'string' && PERMISSION_METHODS.has(name)) note('permission', `${name}()`);
      const variable = Array.isArray(list) ? idName(list[0]) : undefined;
      if (typeof name === 'string' && COMPREHENSION_MACROS.has(name) && Array.isArray(list) && variable) {
        walk(receiver, bound);
        walk(list.slice(1), new Set([...bound, variable]));
        return;
      }
      walk(receiver, bound);
      walk(list, bound);
      return;
    }
    if (op === 'value') return;
    walk(args, bound);
  };
  walk(ast, new Set());
  return out;
}

/** The member a `.`/`.?` access names, or the string literal a `[]`/`[?]` index names. */
function memberName(op: string, member: unknown): string | undefined {
  if (op === '.' || op === '.?') return typeof member === 'string' ? member : undefined;
  return isCelNode(member) && member.op === 'value' && typeof member.args === 'string' ? member.args : undefined;
}

/** `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Judge one field's `expression` for the inputs a stored value cannot keep
 * current. Answers nothing for a `formula` field (computed on every read), for
 * a field with no `expression`, and for a source that is not CEL or does not
 * parse (the expression pass owns that verdict).
 *
 * `fieldDefOf` resolves a field of the same object by name AS THE REGISTRY
 * SERVES IT (the declared field, an extension's, or an injected reference
 * column), so a hop is judged through the declaration the engine plans it by
 * (`referenceTargetOf`, the spec's one arbiter of "what does this field point
 * at").
 */
export function storedExpressionInputIssues(
  fieldName: string,
  def: Record<string, unknown>,
  source: string | undefined,
  fieldDefOf: (name: string) => unknown,
): StoredExpressionInputIssue[] {
  // The engine's own test (`planStoredExpressions`): every field that is not a
  // `formula` and declares an `expression`.
  if (def.type === 'formula' || !def.expression || !source) return [];
  const ast = parseCelToAst(source);
  if (!ast) return [];
  const issues: StoredExpressionInputIssue[] = [];
  const typeLabel = typeof def.type === 'string' ? ` (a \`${def.type}\`, not a \`formula\`)` : '';
  const stored = `\`${fieldName}\` is a stored field${typeLabel}, so its \`expression\` is computed when the record is written and the result is stored`;

  const traversals = analyzeRelationshipTraversals(source, 'record')?.traversals;
  const reads: string[] = [];
  const targets: string[] = [];
  for (const [field, columns] of traversals ?? []) {
    const target = referenceTargetOf(fieldDefOf(field))?.trim();
    if (!target) continue;
    // The hop's `id` is the reference this row stores, not another record's value.
    const related = [...columns].filter((c) => c !== 'id').sort();
    if (related.length === 0) continue;
    reads.push(`${listed(related.map((c) => `\`record.${field}.${c}\``))} (on '${target}', through \`record.${field}\`)`);
    if (!targets.includes(target)) targets.push(target);
  }
  if (reads.length > 0) {
    const where = targets.length === 1 ? `'${targets[0]}'` : 'the related object';
    issues.push({
      rule: STORED_EXPRESSION_CROSS_RECORD_INPUT,
      severity: 'warning',
      message: `${stored}. It reads ${listed(reads)}, a value of another record, read as the writer, and a change `
        + 'to that record does not compute this one again: the stored value keeps what that record held at this '
        + `record's last write. To read the current value, make \`${fieldName}\` a \`formula\` field (computed on `
        + 'every read; a `formula` cannot be totalled). To keep a stored copy current, write it as a snapshot '
        + `field with a flow on ${where} that updates the records pointing at it when the value changes. To `
        + 'repair values that have drifted, run `os migrate stored-expressions --changed`.',
    });
  }

  const volatile = volatileReads(ast);
  if (volatile.length > 0) {
    const consequences = VOLATILE_KIND_ORDER
      .filter((kind) => volatile.some((r) => r.kind === kind))
      .map((kind) => VOLATILE_CONSEQUENCE[kind]);
    const holds = consequences.length > 1
      ? `${consequences.slice(0, -1).join('; ')}; and ${consequences[consequences.length - 1]}`
      : consequences[0];
    issues.push({
      rule: STORED_EXPRESSION_VOLATILE_INPUT,
      severity: 'warning',
      message: `${stored}. It reads ${listed(volatile.map((r) => `\`${r.spelling}\``))}, so the stored value holds `
        + `${holds}. `
        + 'The same `expression` on a `formula` field is computed again on every read. To show the current value, make '
        + `\`${fieldName}\` a \`formula\` field (not summable); to keep a stored value current as time passes, `
        + 'recompute it with a scheduled flow.',
    });
  }
  return issues;
}
