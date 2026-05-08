/**
 * ObjectStack standard CEL function library.
 *
 * Registered into the per-evaluation `Environment` by the CEL engine. All
 * functions are pure given a pinned `now` — that determinism is what makes
 * `objectstack build` artifacts byte-stable across runs.
 *
 * Function naming intentionally avoids the `os.` prefix because cel-js binds
 * dotted names to receiver types. Instead, the `os` namespace in CEL holds
 * *data* (`os.user`, `os.org`, `os.env`) supplied by the caller's
 * {@link EvalContext}.
 */

import type { Environment } from '@marcbachmann/cel-js';

import type { EvalContext } from './types';

/** Truncate a Date to start-of-day in UTC. */
function startOfDayUtc(d: Date): Date {
  const out = new Date(d.getTime());
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/** Add `n` days to a Date in UTC; returns a new Date. */
function addDaysUtc(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * Register the ObjectStack standard library into a CEL environment.
 *
 * The `now` resolver is closed over so each call uses the pinned
 * `EvalContext.now` (or wall-clock fallback). Implementations are kept tiny
 * and dependency-free — they're the contract surface for AI authors and must
 * stay legible.
 */
export function registerStdLib(
  env: Environment,
  now: () => Date,
): Environment {
  return env
    .registerFunction('now(): google.protobuf.Timestamp', () => now())
    .registerFunction(
      'today(): google.protobuf.Timestamp',
      () => startOfDayUtc(now()),
    )
    .registerFunction(
      'daysFromNow(int): google.protobuf.Timestamp',
      (n: bigint | number) => addDaysUtc(now(), Number(n)),
    )
    .registerFunction(
      'daysAgo(int): google.protobuf.Timestamp',
      (n: bigint | number) => addDaysUtc(now(), -Number(n)),
    );
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
  if (ctx.user !== undefined) os.user = ctx.user;
  if (ctx.org !== undefined) os.org = ctx.org;
  if (ctx.env !== undefined) os.env = ctx.env;
  if (Object.keys(os).length > 0) scope.os = os;

  if (ctx.extra !== undefined) Object.assign(scope, ctx.extra);

  return scope;
}
