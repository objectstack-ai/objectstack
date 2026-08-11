// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A deliberately strict, in-process reader of the pipelines
 * `buildAggregationPipeline` emits — the server-free half #5517 requires, in the
 * one place both suites that need it can share it.
 *
 * ## Why it exists
 *
 * The builder's output is a PIPELINE and every contract it must satisfy is
 * stated as VALUES: `AGGREGATION_CASES` names the numbers each group must
 * produce, and `bucketDateValue` names the label each instant must carry. Pinning
 * the emitted stages literally would pin today's spelling rather than the
 * semantics — and it is the semantics that keep being wrong. Every defect
 * #6850/#6814 found emitted a perfectly well-formed pipeline; the
 * `"[object Object]"` `$group._id` was valid MongoDB that grouped by nothing.
 *
 * ## Why it is strict
 *
 * Every stage, accumulator and expression it does not model is a thrown
 * {@link UnsupportedShape}, never a tolerated no-op. A stand-in more permissive
 * than the real engine turns a suite into a green light for broken code. Its own
 * discrimination is proved in `mongodb-aggregation-translation.test.ts`, where
 * each pre-fix lowering is replayed through it and must FAIL the case it broke.
 *
 * ## ⚠️ What it deliberately does NOT answer
 *
 * Whether a real mongod agrees. Every operator below is modelled from the
 * MongoDB manual, not observed: this fleet cannot fetch a mongod binary at all
 * (proxy 403 on the download — #5517), and a suite nobody has executed against
 * the real thing is a claim, not a check. The date operators added for #7580
 * (`$convert` → date, `$dateToString`, `$concat`, `$switch`, `$lte`) carry that
 * bound exactly as the #6850/#6814 ones do.
 *
 * The single most important discipline that makes the bound survivable: this
 * file models the DOCUMENTED semantics, never the behaviour the lowering
 * happens to want. `$convert`'s string arm parses ISO-8601 with its own
 * grammar rather than deferring to JS `new Date(...)` — otherwise the evaluator
 * and the in-memory reference would agree by construction and the legacy-format
 * divergence `mongodb-aggregation.ts#instantOf` documents would be invisible
 * here. Likewise `%G`/`%V` are computed from the ISO-8601 week-date definition,
 * not transcribed from `bucketDateValue`.
 *
 * `.testkit.ts` (not `.test.ts`) so it carries no `describe` of its own and can
 * be imported by two suites without registering their tests twice — the
 * `legacy-datetime-storage.testkit.ts` convention from `driver-sql`.
 */

/** Thrown for any shape this evaluator does not model — never swallowed. */
export class UnsupportedShape extends Error {}

/** A field path that resolved to nothing. MongoDB distinguishes it from `null`. */
export const MISSING = Symbol('missing');

export type Doc = Record<string, unknown>;

/** Resolve a `'$a.b'` field path against a document, or {@link MISSING}. */
export function resolvePath(doc: Doc, ref: string): unknown {
  if (!ref.startsWith('$')) throw new UnsupportedShape(`not a field path: ${ref}`);
  let current: unknown = doc;
  for (const part of ref.slice(1).split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return MISSING;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return MISSING;
    current = (current as Doc)[part];
  }
  return current;
}

// ── Date semantics, modelled from the manual ────────────────────────────────

/**
 * The ISO-8601 grammar `$dateFromString` accepts with no explicit `format` —
 * which is also what `$convert … to: 'date'` uses for a string input.
 *
 * Written out rather than delegated to `new Date(s)` ON PURPOSE. JS's parser
 * additionally accepts a pile of legacy spellings (`'2024-01-15 10:00:00'` with a
 * space separator, `'2024/01/15'`, RFC-2822 dates); deferring to it here would
 * make this evaluator accept exactly what the in-memory reference accepts, so the
 * one storage-form divergence `instantOf` documents would compare EQUAL in every
 * parity assertion instead of showing up. A model that cannot disagree with the
 * thing it is checking is not a model.
 */
const ISO_8601 =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function parseIso8601(s: string): Date | null {
  const m = ISO_8601.exec(s);
  if (!m) return null;
  const [, y, mo, d, hh = '0', mi = '0', ss = '0', frac = '0', zone] = m;
  const ms = Number(`${frac}00`.slice(0, 3));
  let epoch = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss), ms);
  if (zone && zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const [oh, om] = zone.slice(1).replace(':', '').match(/\d{2}/g)!.map(Number);
    epoch -= sign * (oh * 60 + om) * 60_000;
  }
  const out = new Date(epoch);
  // A syntactically well-formed but impossible date (`2024-02-31`) rolls over in
  // `Date.UTC`; MongoDB rejects it, so reject it here too rather than silently
  // labelling March.
  if (
    out.getUTCFullYear() !== Number(y)
    || out.getUTCMonth() !== Number(mo) - 1
    || out.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return out;
}

/** A conversion the manual defines as an error, so the caller's `onError` answers. */
const CONVERT_ERROR = Symbol('convert-error');

/**
 * `$convert … to: 'date'`, per the manual's conversion table: a date converts to
 * itself, a numeric is read as epoch milliseconds, a string is parsed as
 * ISO-8601, and every other input is a conversion ERROR (which the caller's
 * `onError` then answers). `null` and a missing field take `onNull`.
 */
function convertToDate(value: unknown): Date | typeof CONVERT_ERROR | null {
  if (value === MISSING || value === null) return null; // → onNull
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? CONVERT_ERROR : value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return CONVERT_ERROR;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? CONVERT_ERROR : d;
  }
  if (typeof value === 'string') return parseIso8601(value) ?? CONVERT_ERROR;
  return CONVERT_ERROR;
}

const pad = (n: number, w: number): string => String(Math.abs(n)).padStart(w, '0');

/**
 * The ISO-8601 week date of an instant: its week-numbering YEAR (`%G`) and week
 * number (`%V`).
 *
 * Straight from the definition — week 1 is the week containing the year's first
 * Thursday, weeks run Monday..Sunday — rather than transcribed from
 * `bucketDateValue`. Both implement the same standard, which is the point: they
 * have to agree because ISO-8601 says so, not because one was copied.
 */
function isoWeekDate(d: Date): { year: number; week: number } {
  // Move to the Thursday of this instant's week; the year that Thursday falls in
  // IS the ISO week-numbering year, by definition.
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const isoWeekday = thursday.getUTCDay() === 0 ? 7 : thursday.getUTCDay(); // Mon=1..Sun=7
  thursday.setUTCDate(thursday.getUTCDate() + (4 - isoWeekday));
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const dayOfYear = Math.round((thursday.getTime() - jan1) / 86_400_000); // 0-based
  return { year, week: Math.floor(dayOfYear / 7) + 1 };
}

/** `$dateToString`'s format specifiers, for the ones this builder emits. */
function formatDate(d: Date, format: string): string {
  let out = '';
  for (let i = 0; i < format.length; i += 1) {
    if (format[i] !== '%') {
      out += format[i];
      continue;
    }
    const spec = format[i + 1];
    i += 1;
    switch (spec) {
      case '%': out += '%'; break;
      case 'Y': out += pad(d.getUTCFullYear(), 4); break;
      case 'm': out += pad(d.getUTCMonth() + 1, 2); break;
      case 'd': out += pad(d.getUTCDate(), 2); break;
      case 'H': out += pad(d.getUTCHours(), 2); break;
      case 'M': out += pad(d.getUTCMinutes(), 2); break;
      case 'S': out += pad(d.getUTCSeconds(), 2); break;
      case 'G': out += pad(isoWeekDate(d).year, 4); break;
      case 'V': out += pad(isoWeekDate(d).week, 2); break;
      default:
        throw new UnsupportedShape(`unsupported $dateToString format specifier '%${String(spec)}'`);
    }
  }
  return out;
}

/**
 * BSON canonical sort order, for the two types `$lte` meets here. Null sorts
 * BELOW every string — which is why the `quarter` lowering can let its `$switch`
 * run on a null instant without a guard: it answers a digit, and the surrounding
 * `$concat` has already decided the whole label is null.
 */
function bsonLte(left: unknown, right: unknown): boolean {
  const rank = (v: unknown): number => {
    if (v === MISSING || v === null) return 0;
    if (typeof v === 'number') return 1;
    if (typeof v === 'string') return 2;
    throw new UnsupportedShape(`$lte over an unmodelled BSON type: ${typeof v}`);
  };
  const lr = rank(left);
  const rr = rank(right);
  if (lr !== rr) return lr < rr;
  if (lr === 0) return true; // null <= null
  return (left as string | number) <= (right as string | number);
}

/** MongoDB's expression truthiness: `false`, `null`, `0` and missing are false. */
function truthy(v: unknown): boolean {
  return !(v === false || v === null || v === MISSING || v === 0 || v === undefined);
}

// ── Expressions ─────────────────────────────────────────────────────────────

/**
 * Evaluate an aggregation EXPRESSION against one document.
 *
 * Models only the operators this builder emits. `$$`-prefixed system variables
 * are refused rather than guessed at — `$$ROOT` reaches the `array_agg` arm, and
 * an evaluator that quietly resolved it would be asserting a semantics nobody
 * checked.
 */
export function evalExpr(doc: Doc, expr: unknown): unknown {
  if (typeof expr === 'string' && expr.startsWith('$')) {
    if (expr.startsWith('$$')) throw new UnsupportedShape(`system variable '${expr}' is not modelled`);
    return resolvePath(doc, expr);
  }
  if (expr === null || typeof expr !== 'object') return expr; // literal
  if (Array.isArray(expr)) return expr.map((e) => evalExpr(doc, e));

  const keys = Object.keys(expr as Doc);
  if (keys.length !== 1) throw new UnsupportedShape(`expression with ${keys.length} keys: ${keys.join(', ')}`);
  const [op] = keys;
  const arg = (expr as Doc)[op];

  switch (op) {
    case '$ifNull': {
      if (!Array.isArray(arg) || arg.length !== 2) throw new UnsupportedShape('$ifNull takes [expr, replacement]');
      const value = evalExpr(doc, arg[0]);
      return value === MISSING || value === null ? evalExpr(doc, arg[1]) : value;
    }
    case '$eq': {
      if (!Array.isArray(arg) || arg.length !== 2) throw new UnsupportedShape('$eq takes two operands');
      // MISSING and null compare EQUAL under `$eq` in the aggregation language,
      // which is why the `count` lowering routes through `$ifNull` first rather
      // than relying on it.
      const left = evalExpr(doc, arg[0]);
      const right = evalExpr(doc, arg[1]);
      const norm = (v: unknown) => (v === MISSING ? null : v);
      return norm(left) === norm(right);
    }
    case '$lte': {
      if (!Array.isArray(arg) || arg.length !== 2) throw new UnsupportedShape('$lte takes two operands');
      return bsonLte(evalExpr(doc, arg[0]), evalExpr(doc, arg[1]));
    }
    case '$cond': {
      if (!Array.isArray(arg) || arg.length !== 3) throw new UnsupportedShape('$cond takes [if, then, else]');
      return truthy(evalExpr(doc, arg[0])) ? evalExpr(doc, arg[1]) : evalExpr(doc, arg[2]);
    }
    case '$switch': {
      const spec = arg as { branches?: Array<{ case: unknown; then: unknown }>; default?: unknown };
      if (!spec || !Array.isArray(spec.branches)) throw new UnsupportedShape('$switch takes { branches, default? }');
      for (const branch of spec.branches) {
        if (!branch || !('case' in branch) || !('then' in branch)) {
          throw new UnsupportedShape('$switch branch takes { case, then }');
        }
        if (truthy(evalExpr(doc, branch.case))) return evalExpr(doc, branch.then);
      }
      // The manual: no matching branch and no `default` is an ERROR, not null.
      if (!('default' in spec)) throw new UnsupportedShape('$switch matched no branch and declares no default');
      return evalExpr(doc, spec.default);
    }
    case '$concat': {
      if (!Array.isArray(arg)) throw new UnsupportedShape('$concat takes an array of operands');
      const parts = arg.map((a) => evalExpr(doc, a));
      // "If any argument resolves to null or refers to a field that is missing,
      // $concat returns null" — the whole of this lowering's null propagation.
      if (parts.some((p) => p === null || p === MISSING)) return null;
      for (const p of parts) {
        if (typeof p !== 'string') throw new UnsupportedShape(`$concat over a non-string operand: ${typeof p}`);
      }
      return parts.join('');
    }
    case '$convert': {
      const spec = arg as { input?: unknown; to?: unknown; onError?: unknown; onNull?: unknown };
      if (!spec || typeof spec !== 'object') throw new UnsupportedShape('$convert takes a document');
      if (spec.to !== 'date') throw new UnsupportedShape(`$convert to '${String(spec.to)}' is not modelled`);
      const converted = convertToDate(evalExpr(doc, spec.input));
      if (converted === CONVERT_ERROR) {
        if (!('onError' in spec)) throw new UnsupportedShape('$convert failed and declares no onError');
        return evalExpr(doc, spec.onError);
      }
      if (converted === null) {
        if (!('onNull' in spec)) throw new UnsupportedShape('$convert saw null and declares no onNull');
        return evalExpr(doc, spec.onNull);
      }
      return converted;
    }
    case '$dateToString': {
      const spec = arg as { format?: unknown; date?: unknown; onNull?: unknown };
      if (!spec || typeof spec.format !== 'string') throw new UnsupportedShape('$dateToString takes { format, date }');
      const value = evalExpr(doc, spec.date);
      // "If the date is null or missing, $dateToString returns null" unless
      // `onNull` says otherwise.
      if (value === null || value === MISSING) return 'onNull' in spec ? evalExpr(doc, spec.onNull) : null;
      if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        // A real mongod raises here rather than answering; refusing keeps the
        // evaluator from blessing a lowering that feeds it a non-date.
        throw new UnsupportedShape('$dateToString received a non-date — the lowering must convert first');
      }
      return formatDate(value, spec.format);
    }
    default:
      throw new UnsupportedShape(`unsupported aggregation expression operator '${op}'`);
  }
}

/** One accumulator, folded over the documents of a single group. */
export function accumulate(rows: Doc[], acc: unknown): unknown {
  if (acc === null || typeof acc !== 'object' || Array.isArray(acc)) {
    throw new UnsupportedShape(`accumulator must be a one-key document, got ${JSON.stringify(acc)}`);
  }
  const keys = Object.keys(acc as Doc);
  if (keys.length !== 1) throw new UnsupportedShape(`accumulator with ${keys.length} keys`);
  const [op] = keys;
  const arg = (acc as Doc)[op];
  const values = rows.map((row) => evalExpr(row, arg));
  /** MongoDB's arithmetic accumulators ignore missing and non-numeric values. */
  const numbers = values.filter((v): v is number => typeof v === 'number');

  switch (op) {
    case '$sum':
      return numbers.reduce((a, b) => a + b, 0);
    case '$avg':
      return numbers.length === 0 ? null : numbers.reduce((a, b) => a + b, 0) / numbers.length;
    case '$min':
      return numbers.length === 0 ? null : Math.min(...numbers);
    case '$max':
      return numbers.length === 0 ? null : Math.max(...numbers);
    case '$addToSet': {
      // `$addToSet` skips a MISSING field and keeps an explicit `null` — the
      // whole of #6814 lives in that second half.
      const set: unknown[] = [];
      for (const v of values) {
        if (v === MISSING) continue;
        if (!set.includes(v)) set.push(v);
      }
      return set;
    }
    case '$push':
      return values.filter((v) => v !== MISSING);
    default:
      throw new UnsupportedShape(`unsupported accumulator '${op}'`);
  }
}

/** Execute an emitted pipeline over the fixture. Throws on any shape not modelled. */
export function runPipeline(rows: readonly Doc[], pipeline: readonly Doc[]): Doc[] {
  let docs: Doc[] = rows.map((row) => ({ ...row }));

  for (const stage of pipeline) {
    const keys = Object.keys(stage);
    if (keys.length !== 1) throw new UnsupportedShape(`pipeline stage with ${keys.length} keys`);
    const [name] = keys;
    const spec = stage[name];

    switch (name) {
      case '$group': {
        const { _id: idSpec, ...accumulators } = spec as Doc;
        const groups = new Map<string, { id: unknown; rows: Doc[] }>();
        for (const doc of docs) {
          let id: unknown;
          if (idSpec === null) {
            id = null;
          } else if (idSpec && typeof idSpec === 'object' && !Array.isArray(idSpec)) {
            const key: Doc = {};
            for (const [outKey, ref] of Object.entries(idSpec as Doc)) {
              const value = evalExpr(doc, ref);
              key[outKey] = value === MISSING ? null : value;
            }
            id = key;
          } else {
            throw new UnsupportedShape(`$group._id must be null or a document, got ${JSON.stringify(idSpec)}`);
          }
          const bucket = JSON.stringify(id);
          if (!groups.has(bucket)) groups.set(bucket, { id, rows: [] });
          groups.get(bucket)!.rows.push(doc);
        }
        docs = [...groups.values()].map(({ id, rows: groupRows }) => {
          const out: Doc = { _id: id };
          for (const [alias, acc] of Object.entries(accumulators)) {
            out[alias] = accumulate(groupRows, acc);
          }
          return out;
        });
        break;
      }
      case '$project': {
        docs = docs.map((doc) => {
          const out: Doc = {};
          for (const [key, rule] of Object.entries(spec as Doc)) {
            if (rule === 0 || rule === false) continue;
            if (rule === 1 || rule === true) {
              const value = resolvePath(doc, `$${key}`);
              if (value !== MISSING) out[key] = value;
              continue;
            }
            if (typeof rule === 'string') {
              const value = resolvePath(doc, rule);
              if (value !== MISSING) out[key] = value;
              continue;
            }
            throw new UnsupportedShape(`unsupported $project rule for '${key}': ${JSON.stringify(rule)}`);
          }
          return out;
        });
        break;
      }
      case '$match':
        // Reachable only from `opts.where`, which no case in the shared set
        // spells. Refused rather than approximated: this file's `$match` would
        // be a second, weaker copy of the matcher
        // `mongodb-filter-logic-translation.test.ts` already owns.
        throw new UnsupportedShape('$match is not modelled here — see mongodb-filter-logic-translation.test.ts');
      case '$sort': {
        const entries = Object.entries(spec as Doc);
        docs = [...docs].sort((a, b) => {
          for (const [field, dir] of entries) {
            if (dir !== 1 && dir !== -1) throw new UnsupportedShape(`$sort direction ${String(dir)}`);
            const av = a[field];
            const bv = b[field];
            if (av === bv) continue;
            return ((av as never) < (bv as never) ? -1 : 1) * (dir as number);
          }
          return 0;
        });
        break;
      }
      case '$skip':
        docs = docs.slice(spec as number);
        break;
      case '$limit':
        docs = docs.slice(0, spec as number);
        break;
      default:
        throw new UnsupportedShape(`unsupported pipeline stage '${name}'`);
    }
  }

  return docs;
}
