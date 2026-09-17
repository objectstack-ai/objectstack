/**
 * ObjectStack standard CEL function library.
 *
 * Registered into the per-evaluation `Environment` by the CEL engine. All
 * functions are pure given a pinned `now` and the pinned data this module is
 * handed — that determinism is what makes `objectstack build` artifacts
 * byte-stable across runs. ⛔ Nothing registered here may be handed a resolver,
 * a lazy getter or any other callback into the host: a function that reaches
 * outside its arguments and the data pinned at registration makes the same
 * source evaluate to different values on two runs of the same build.
 *
 * Function naming intentionally avoids the `os.` prefix because cel-js binds
 * dotted names to receiver types. Instead, the `os` namespace in CEL holds
 * *data* (`os.user`, `os.org`, `os.env`) supplied by the caller's
 * {@link EvalContext}. The one RECEIVER-form function this library registers —
 * `current_user.can(object, verb)` — uses that same binding rather than
 * fighting it: see {@link registerPermissionPredicate}.
 */

import type { Environment } from '@marcbachmann/cel-js';

import type { EvalContext, EvalPermissions } from './types';
import { createEvalUser, type EvalUser } from '@objectstack/spec';
// The verb vocabulary lives on the SECURITY subpath, where the permission
// contract it is seeded from lives — not on the root barrel, which exports a
// curated authoring surface and no domain tables.
import {
  objectPermissionGrants,
  resolveObjectPermissionVerb,
  OBJECT_PERMISSION_VERB_NAMES,
} from '@objectstack/spec/security';

/**
 * Calendar-day parts (y/m/d) of an instant *as seen in a timezone*
 * (ADR-0053 Phase 2). Uses `Intl.DateTimeFormat` so DST transitions are
 * handled correctly — never hand-rolled offset math. An unknown zone throws,
 * which the caller treats as a fall-through to UTC.
 */
function partsInTz(d: Date, tz: string): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), day: get('day') };
}

/**
 * The calendar day of an instant *in a reference timezone*, expressed as a
 * UTC-midnight `Date` (ADR-0053 Phase 2, decision D1). This is the one
 * representation consistent with how `Field.date` strings hydrate (UTC
 * midnight), how the SQL driver normalizes date filters, and how Phase 1
 * stores dates — so `record.date == today()` compares cleanly. Falls back to
 * the UTC calendar day for `UTC` or an invalid zone.
 */
function calendarDayUtc(d: Date, tz: string): Date {
  if (tz && tz !== 'UTC') {
    try {
      const { y, m, day } = partsInTz(d, tz);
      return new Date(Date.UTC(y, m - 1, day));
    } catch {
      // unknown zone → fall through to UTC
    }
  }
  return startOfDayUtc(d);
}

/** Truncate a Date to start-of-day in UTC. */
function startOfDayUtc(d: Date): Date {
  const out = new Date(d.getTime());
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/** Coerce a CEL value (Date | ISO string | epoch number) to a Date. */
function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'bigint') return new Date(Number(v));
  return new Date(String(v));
}

/** One UTC day in milliseconds. */
const MS_PER_DAY = 86_400_000;

/** Add `n` days to a Date in UTC; returns a new Date. */
function addDaysUtc(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * Add `n` calendar months to a Date in UTC; returns a new Date. Clamps the day
 * to the target month's last day so `addMonths(date('2026-01-31'), 1)` yields
 * Feb 28, never an overflow into March — matching how authors expect a
 * "next service date = last + N months" rule to behave.
 */
function addMonthsUtc(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1); // avoid roll-over while shifting the month
  out.setUTCMonth(out.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/**
 * What `current_user.can(object, verb)` is answered from: the acting subject
 * this evaluation bound, and that subject's effective object permissions.
 *
 * Both halves are DATA, pinned when the environment is built. `subject` is the
 * very object {@link buildScope} mounted under `current_user` (and its `user` /
 * `ctx.user` / `os.user` aliases), carried here so the binding can tell a call
 * ON the acting subject from a call on something else that happens to sit to
 * the left of a dot.
 */
export interface PermissionBinding {
  /**
   * The canonical `EvalUser` this evaluation bound, or `undefined` when the
   * evaluation carries no user at all (a parse-time environment, a system
   * write). Compared by IDENTITY, never by shape.
   */
  readonly subject: unknown;
  /** The subject's effective object permissions, or `undefined` when none were passed. */
  readonly permissions: EvalPermissions | undefined;
}

/**
 * Register `can` — the permission predicate — as a RECEIVER method, so the one
 * authored spelling is `current_user.can(object, verb)`.
 *
 * ## Receiver-only, deliberately
 *
 * cel-js binds dotted names to receiver types, and a bare `can(object, verb)`
 * is NOT registered: it keeps faulting (`found no matching overload for
 * 'can(dyn, dyn)'`), which is the right answer — a bare call names no subject,
 * and a permission question with no subject has no meaning. The name exists in
 * the environment either way, so the publish gate's function-existence verdict
 * (`firstUnknownFunctionCall`) reads a bare call as a call-FORM fault rather
 * than an existence one, exactly as it already does for `split`.
 *
 * ## Every refusal is LOUD — there is no quiet answer
 *
 * The binding throws, and the engine reports the throw as
 * `{ ok: false, error: { kind: 'runtime' } }`, for each of:
 *
 *  - **no permission data in the context.** ⛔ Never `true` (fail-open: an
 *    action shown to someone who cannot use it, and worse, a section of data
 *    revealed), ⛔ never a silent `false` (fail-shut: every gated element
 *    disappears for everyone, indistinguishable from a correct denial, and the
 *    author is told nothing). A context that was never given the data cannot
 *    tell "denied" from "nobody passed it", so it says so.
 *  - **a receiver that is not the acting subject.** `record.can(…)` reads as a
 *    question about the record and would silently be answered about the user.
 *  - **a verb outside the vocabulary.** `current_user.can('crm_lead', 'approve')`
 *    is an author asking about a capability this platform does not model; the
 *    refusal names the whole accepted vocabulary.
 *  - **a non-string object or verb.**
 *
 * The ONE quiet answer is a real one: an object the effective map does not
 * mention is an object with no grant, and answers `false` — the same answer an
 * all-`false` entry gives, because they mean the same thing.
 */
export function registerPermissionPredicate(
  env: Environment,
  binding: PermissionBinding | undefined,
): Environment {
  return env.registerFunction(
    'dyn.can(dyn, dyn): bool',
    (receiver: unknown, object: unknown, verb: unknown): boolean => {
      if (typeof object !== 'string' || object.length === 0) {
        throw new Error(
          'can(object, verb): `object` must be an object NAME (a non-empty string), e.g. ' +
          "current_user.can('crm_lead', 'edit').",
        );
      }
      if (typeof verb !== 'string' || verb.length === 0) {
        throw new Error(
          'can(object, verb): `verb` must be one of ' +
          `${OBJECT_PERMISSION_VERB_NAMES.join(', ')} (a non-empty string).`,
        );
      }
      const target = resolveObjectPermissionVerb(verb);
      if (!target) {
        throw new Error(
          `can(object, verb): \`${verb}\` is not a permission verb. The accepted verbs are ` +
          `${OBJECT_PERMISSION_VERB_NAMES.join(', ')}. A capability outside that list is not ` +
          'modelled as an object permission, so no answer about it would mean anything.',
        );
      }
      if (binding?.subject === undefined || receiver !== binding.subject) {
        throw new Error(
          'can(object, verb) answers about the ACTING SUBJECT and must be called on it: write ' +
          "current_user.can('<object>', '<verb>') (the `user` / `ctx.user` / `os.user` aliases " +
          'are the same object and work too). Calling it on anything else would answer a ' +
          'question about the current user while reading as a question about the receiver.',
        );
      }
      if (binding.permissions === undefined) {
        throw new Error(
          `can('${object}', '${verb}') cannot be answered: this evaluation context carries no ` +
          'permission data. Pass `permissions` on the EvalContext — the `objects` map of the ' +
          'published /auth/me/permissions response, object name -> EffectiveObjectPermission. ' +
          'Refusing loudly is deliberate: answering `true` would show what the subject may not ' +
          'have, and answering `false` would hide it from everyone with no way to tell that ' +
          'apart from a real denial.',
        );
      }
      const entry = Object.prototype.hasOwnProperty.call(binding.permissions, object)
        ? binding.permissions[object]
        : undefined;
      return objectPermissionGrants(entry, target);
    },
  );
}

/**
 * Register the ObjectStack standard library into a CEL environment.
 *
 * The `now` resolver is closed over so each call uses the pinned
 * `EvalContext.now` (or wall-clock fallback); `permissionBinding` is pinned the
 * same way and for the same reason — see {@link PermissionBinding}.
 * Implementations are kept tiny and dependency-free — they're the contract
 * surface for AI authors and must stay legible.
 *
 * `can` is registered UNCONDITIONALLY, binding or not: whether a name exists in
 * this environment is a fact about the platform, not about one call site's
 * data. A conditional registration would make the publish gate's answer depend
 * on which context happened to build the environment, so an authored predicate
 * could pass the gate and be unknown at runtime — the very split this binding
 * exists to close.
 */
export function registerStdLib(
  env: Environment,
  now: () => Date,
  timezone = 'UTC',
  permissionBinding?: PermissionBinding,
): Environment {
  registerPermissionPredicate(env, permissionBinding);
  // `today()` / `daysFromNow()` / `daysAgo()` are calendar-day functions: they
  // resolve to the reference-tz calendar day expressed as a UTC-midnight Date
  // (ADR-0053 Phase 2 D1), never an instant carrying wall-clock time. For a
  // genuine sub-day offset use `now() + duration("Nh")`.
  return env
    .registerFunction('now(): google.protobuf.Timestamp', () => now())
    .registerFunction(
      'today(): google.protobuf.Timestamp',
      () => calendarDayUtc(now(), timezone),
    )
    .registerFunction(
      'daysFromNow(int): google.protobuf.Timestamp',
      (n: bigint | number) => addDaysUtc(calendarDayUtc(now(), timezone), Number(n)),
    )
    .registerFunction(
      'daysAgo(int): google.protobuf.Timestamp',
      (n: bigint | number) => addDaysUtc(calendarDayUtc(now(), timezone), -Number(n)),
    )
    // Returns true when `value` is null, undefined, empty string, or empty list.
    // Matches the intent of legacy `ISBLANK()` while staying CEL-idiomatic.
    .registerFunction(
      'isBlank(dyn): bool',
      (value: unknown) => {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string') return value.length === 0;
        if (Array.isArray(value)) return value.length === 0;
        return false;
      },
    )
    // Returns `value` when not null/undefined, otherwise the `fallback`.
    // Use this to safely concatenate optional string fields:
    //   coalesce(record.salutation, '') + ' ' + coalesce(record.first_name, '')
    .registerFunction(
      'coalesce(dyn, dyn): dyn',
      (value: unknown, fallback: unknown) =>
        (value === null || value === undefined) ? fallback : value,
    )
    // Trim leading/trailing ASCII whitespace from a string. Returns '' for
    // null/undefined so it composes cleanly with `coalesce`.
    .registerFunction(
      'trim(dyn): string',
      (value: unknown) => {
        if (value === null || value === undefined) return '';
        return String(value).trim();
      },
    )
    // Join a list of values with `sep`, dropping null/undefined/empty entries
    // first. Designed for display-name formulas like:
    //   joinNonEmpty([record.salutation, record.first_name, record.last_name], ' ')
    // which produces 'Alice Martinez' (no leading/trailing/internal extra
    // spaces) when `salutation` is null.
    .registerFunction(
      'joinNonEmpty(list, string): string',
      (list: unknown, sep: unknown) => {
        const arr = Array.isArray(list) ? list : [];
        const separator = typeof sep === 'string' ? sep : ' ';
        const parts: string[] = [];
        for (const item of arr) {
          if (item === null || item === undefined) continue;
          const s = String(item).trim();
          if (s.length > 0) parts.push(s);
        }
        return parts.join(separator);
      },
    )
    // ── Dates ────────────────────────────────────────────────────────────
    // Whole days from `a` to `b` (negative if `b` is before `a`). The common
    // shape is `daysBetween(today(), record.due)` for "days remaining". Args are
    // coerced (Date | ISO string | epoch) so a `Field.date` that arrives as a
    // string still works without the caller hydrating it.
    .registerFunction(
      'daysBetween(dyn, dyn): int',
      (a: unknown, b: unknown) =>
        BigInt(Math.round((toDate(b).getTime() - toDate(a).getTime()) / MS_PER_DAY)),
    )
    // Shift an arbitrary date by a (possibly negative) number of days/months.
    // Unlike `daysFromNow`, these operate on a *given* date — the shape behind
    // "next service date = last service + cycle". Args are coerced (Date | ISO
    // string | epoch) so a `Field.date` arriving as a string works directly.
    // `addMonths` clamps to the target month's last day (Jan 31 +1mo → Feb 28).
    // `n` is typed `dyn` (not `int`): a record number field arrives as cel-js
    // `double`, so an `int` overload would fault `no such overload` (#1928).
    // We coerce defensively with `Number(...)`.
    .registerFunction(
      'addDays(dyn, dyn): google.protobuf.Timestamp',
      (d: unknown, n: unknown) => addDaysUtc(toDate(d), Math.trunc(Number(n))),
    )
    .registerFunction(
      'addMonths(dyn, dyn): google.protobuf.Timestamp',
      (d: unknown, n: unknown) => addMonthsUtc(toDate(d), Math.trunc(Number(n))),
    )
    // Parse an ISO date / date-time string to a Timestamp. `date` and `datetime`
    // are aliases — both accept either form (the field's own type decides the
    // intent); kept distinct because authors reach for whichever reads clearer.
    .registerFunction('date(dyn): google.protobuf.Timestamp', (s: unknown) => toDate(s))
    .registerFunction('datetime(dyn): google.protobuf.Timestamp', (s: unknown) => toDate(s))
    // ── Numbers ──────────────────────────────────────────────────────────
    .registerFunction('abs(dyn): double', (x: unknown) => Math.abs(Number(x)))
    .registerFunction('round(dyn): int', (x: unknown) => BigInt(Math.round(Number(x))))
    // `floor`/`ceil` round toward −∞ / +∞ (NOT toward zero like integer division),
    // so `floor(-1.2) == -2`, `ceil(-1.2) == -1`. Registered because they are
    // universally-expected math primitives that authors (and LLMs) reach for by
    // reflex — omitting them makes `floor(...)` fault and the formula silently
    // null (#3306). Return `int` to match `round`, coercing the arg with
    // `Number(...)` (a record number arrives as cel-js `double`).
    .registerFunction('floor(dyn): int', (x: unknown) => BigInt(Math.floor(Number(x))))
    .registerFunction('ceil(dyn): int', (x: unknown) => BigInt(Math.ceil(Number(x))))
    // min/max return the smaller/larger operand verbatim (type preserved) rather
    // than a coerced copy, so `min(record.a, record.b)` keeps int-ness when both
    // are ints. Comparison is numeric.
    .registerFunction('min(dyn, dyn): dyn', (a: unknown, b: unknown) => (Number(a) <= Number(b) ? a : b))
    .registerFunction('max(dyn, dyn): dyn', (a: unknown, b: unknown) => (Number(a) >= Number(b) ? a : b))
    // ── Strings ──────────────────────────────────────────────────────────
    // Free-function forms of the common string ops. CEL also exposes some as
    // receiver methods (`s.contains(x)`), but the authoring catalog advertises
    // the bare-call form, so register it to match what authors are told to use.
    .registerFunction('upper(dyn): string', (s: unknown) => String(s ?? '').toUpperCase())
    .registerFunction('lower(dyn): string', (s: unknown) => String(s ?? '').toLowerCase())
    .registerFunction('contains(dyn, dyn): bool', (s: unknown, sub: unknown) => String(s ?? '').includes(String(sub ?? '')))
    .registerFunction('startsWith(dyn, dyn): bool', (s: unknown, p: unknown) => String(s ?? '').startsWith(String(p ?? '')))
    .registerFunction('endsWith(dyn, dyn): bool', (s: unknown, p: unknown) => String(s ?? '').endsWith(String(p ?? '')))
    .registerFunction('matches(dyn, dyn): bool', (s: unknown, re: unknown) => new RegExp(String(re ?? '')).test(String(s ?? '')))
    // ── Collections ──────────────────────────────────────────────────────
    // `len` mirrors CEL's built-in `size()` for strings/lists/maps; `isEmpty` is
    // the inverse-of-non-empty companion to `isBlank` (true for null, '', []).
    .registerFunction('len(dyn): int', (v: unknown) => BigInt(lengthOf(v)))
    .registerFunction(
      'isEmpty(dyn): bool',
      (v: unknown) => v === null || v === undefined || lengthOf(v) === 0,
    );
}

/** Length of a string / list / map (0 for scalars and null). */
function lengthOf(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string' || Array.isArray(v)) return v.length;
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length;
  return 0;
}

/**
 * Register mixed `double <op> int` / `int <op> double` arithmetic overloads.
 *
 * cel-js types a record field number as `double` and a bare integer literal as
 * `int`, and ships overloads only for matching pairs (`double op double`,
 * `int op int`). So a formula as ordinary as `record.amount / 100` or
 * `record.price * 2` faults at runtime (`no such overload: dyn<double> / int`);
 * the engine catches the fault and the formula silently evaluates to `null`
 * (#1928). Authors then have to know the cel-js quirk and write `/ 100.0`.
 *
 * We close the gap by registering the missing mixed overloads. The result is
 * always computed as a JS `double`, matching CEL's promotion rule for mixed
 * numeric arithmetic. Pure `int op int` is untouched, so integer division
 * (`7 / 2 == 3`) keeps its semantics — these overloads only fire when the two
 * operands are genuinely a `double` and an `int`.
 */
export function registerNumericCoercions(env: Environment): Environment {
  const ops: Record<string, (a: number, b: number) => number> = {
    '+': (a, b) => a + b,
    '-': (a, b) => a - b,
    '*': (a, b) => a * b,
    '/': (a, b) => a / b,
    '%': (a, b) => a % b,
  };
  for (const [op, fn] of Object.entries(ops)) {
    const impl = (a: unknown, b: unknown) => fn(Number(a), Number(b));
    env.registerOperator(`double ${op} int`, impl);
    env.registerOperator(`int ${op} double`, impl);
  }
  return env;
}

/**
 * Normalize the loosely-typed EvalContext user into the canonical EvalUser
 * (ADR-0068, renamed by ADR-0090 D3): `positions` is the one canonical
 * membership array. One-step rename — no legacy `roles`/`role` aliases parse.
 */
function toEvalUser(u: NonNullable<EvalContext['user']>): EvalUser {
  const positions = Array.isArray(u.positions) ? (u.positions as string[]) : [];
  const canonical = createEvalUser({
    id: u.id,
    name: typeof u.name === 'string' ? u.name : undefined,
    email: typeof u.email === 'string' ? u.email : undefined,
    positions,
    organizationId:
      typeof u.organizationId === 'string' || u.organizationId === null
        ? (u.organizationId as string | null)
        : undefined,
  });
  return canonical;
}

/**
 * Build the variable scope for a single evaluation. Absent fields are simply
 * not bound — CEL macros (`has(record.foo)`) handle missing-key safely.
 */
export function buildScope(ctx: EvalContext): Record<string, unknown> {
  const scope: Record<string, unknown> = {};

  if (ctx.record !== undefined) scope.record = ctx.record;
  if (ctx.previous !== undefined) scope.previous = ctx.previous;
  if (ctx.input !== undefined) scope.input = ctx.input;

  // Namespaced data — written as `os.user.id`, `os.env`, etc. in CEL.
  const os: Record<string, unknown> = {};
  if (ctx.user !== undefined) {
    // ADR-0068: one canonical EvalUser under every alias (`current_user`,
    // `user`, `ctx.user`, `os.user`) — the SAME object, so a predicate
    // evaluates identically wherever it is authored.
    const currentUser = toEvalUser(ctx.user);
    scope.current_user = currentUser;
    scope.user = currentUser;
    scope.ctx = {
      ...(typeof scope.ctx === 'object' && scope.ctx !== null ? scope.ctx : {}),
      user: currentUser,
    };
    os.user = currentUser;
  }
  if (ctx.org !== undefined) os.org = ctx.org;
  if (ctx.env !== undefined) os.env = ctx.env;
  if (Object.keys(os).length > 0) scope.os = os;

  if (ctx.extra !== undefined) Object.assign(scope, ctx.extra);

  return scope;
}
