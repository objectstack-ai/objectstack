// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Auto-number format renderer — shared by the ObjectQL engine (in-memory
 * fallback) and the SQL driver (persistent atomic sequence) so both paths
 * render identical record numbers from one `autonumberFormat` string (#1603).
 *
 * A format is literal text interleaved with `{...}` tokens:
 *
 *   - Sequence token `{0000}` — one or more `0`s. The running counter,
 *     zero-padded to that width. At most one per format; a format with none
 *     appends the bare counter (legacy behaviour).
 *   - Date tokens `{YYYY} {YY} {MM} {DD} {YYYYMMDD}` — the generation date in
 *     the request's business timezone (ADR-0053), falling back to UTC.
 *   - Field tokens `{field_name}` — the value of another field on the SAME
 *     record (e.g. `{island_zone}`, `{plan_no}`), interpolated as a string.
 *   - Everything else is literal text.
 *
 * The counter is scoped to whatever the tokens BEFORE the sequence render to
 * (the "scope"): `AD{YYYYMMDD}{0000}` counts per day, `{island_zone}{000}`
 * counts per island, `{plan_no}{000}` counts per parent record. A fresh scope
 * value starts a fresh count — so period reset (yearly/monthly/daily) and
 * per-group numbering both fall out of one mechanism with no extra config.
 *
 * Backward compatibility: a format with NO date/field tokens (e.g.
 * `CASE-{0000}`) has an empty scope, so existing fixed-prefix sequences keep
 * their single global counter and their behaviour is unchanged.
 */

export type AutonumberToken =
  | { kind: 'literal'; text: string }
  | { kind: 'date'; pattern: 'YYYY' | 'YY' | 'MM' | 'DD' | 'YYYYMMDD' }
  | { kind: 'field'; field: string }
  | { kind: 'seq'; width: number };

const DATE_PATTERNS = new Set(['YYYY', 'YY', 'MM', 'DD', 'YYYYMMDD']);

/**
 * Parse an `autonumberFormat` into an ordered token list. An unrecognized
 * `{...}` group is kept verbatim as literal text, so a stray brace or a typo
 * never throws — it just renders literally.
 */
export function parseAutonumberFormat(format: string): AutonumberToken[] {
  const tokens: AutonumberToken[] = [];
  if (!format) return tokens;
  const re = /\{([^{}]*)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let seenSeq = false;
  while ((m = re.exec(format)) !== null) {
    if (m.index > last) tokens.push({ kind: 'literal', text: format.slice(last, m.index) });
    const body = m[1];
    if (/^0+$/.test(body) && !seenSeq) {
      // First `{0..0}` is the sequence slot. A second one is ambiguous, so
      // treat it as literal rather than silently producing two counters.
      tokens.push({ kind: 'seq', width: body.length });
      seenSeq = true;
    } else if (DATE_PATTERNS.has(body)) {
      tokens.push({ kind: 'date', pattern: body as 'YYYY' | 'YY' | 'MM' | 'DD' | 'YYYYMMDD' });
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(body)) {
      tokens.push({ kind: 'field', field: body });
    } else {
      tokens.push({ kind: 'literal', text: m[0] });
    }
    last = re.lastIndex;
  }
  if (last < format.length) tokens.push({ kind: 'literal', text: format.slice(last) });
  return tokens;
}

/** True when the format interpolates anything date- or record-dependent. */
export function hasDynamicTokens(tokens: AutonumberToken[]): boolean {
  return tokens.some((t) => t.kind === 'date' || t.kind === 'field');
}

/** The sequence token's pad width, or `fallback` (default 4) when none. */
export function sequenceWidth(tokens: AutonumberToken[], fallback = 4): number {
  const seq = tokens.find((t) => t.kind === 'seq');
  return seq && seq.kind === 'seq' ? seq.width : fallback;
}

/** Field names referenced by `{field}` tokens (for read-back / validation). */
export function referencedFields(tokens: AutonumberToken[]): string[] {
  return tokens.filter((t): t is Extract<AutonumberToken, { kind: 'field' }> => t.kind === 'field').map((t) => t.field);
}

/**
 * `{field}` tokens whose value is missing on the record (null / undefined /
 * empty string). Such a field would silently render to an empty prefix and
 * collapse the counter into the wrong scope (a different group's sequence), so
 * callers should refuse to generate rather than emit a wrong record number.
 * Returns the referenced field names in format order, deduplicated.
 */
export function missingFieldValues(
  tokens: AutonumberToken[],
  record?: Record<string, unknown>,
): string[] {
  const missing: string[] = [];
  for (const field of referencedFields(tokens)) {
    const v = record ? record[field] : undefined;
    if ((v == null || v === '') && !missing.includes(field)) missing.push(field);
  }
  return missing;
}

interface CalendarParts {
  YYYY: string;
  YY: string;
  MM: string;
  DD: string;
}

/** Resolve the calendar Y/M/D of `now` in `timezone` (IANA), UTC on failure. */
function calendarParts(now: Date, timezone?: string): CalendarParts {
  let y: string;
  let mo: string;
  let d: string;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(now);
    y = parts.find((p) => p.type === 'year')?.value ?? '0000';
    mo = parts.find((p) => p.type === 'month')?.value ?? '01';
    d = parts.find((p) => p.type === 'day')?.value ?? '01';
  } catch {
    y = String(now.getUTCFullYear()).padStart(4, '0');
    mo = String(now.getUTCMonth() + 1).padStart(2, '0');
    d = String(now.getUTCDate()).padStart(2, '0');
  }
  return { YYYY: y, YY: y.slice(-2), MM: mo, DD: d };
}

function renderDate(pattern: string, p: CalendarParts): string {
  switch (pattern) {
    case 'YYYY': return p.YYYY;
    case 'YY': return p.YY;
    case 'MM': return p.MM;
    case 'DD': return p.DD;
    case 'YYYYMMDD': return `${p.YYYY}${p.MM}${p.DD}`;
    default: return '';
  }
}

export interface RenderAutonumberInput {
  /** Parsed tokens (from {@link parseAutonumberFormat}). */
  tokens: AutonumberToken[];
  /** The reserved counter value. */
  seq: number;
  /** The record being written — source for `{field}` interpolation. */
  record?: Record<string, unknown>;
  /** Generation instant. Callers pass an explicit `Date` (no implicit clock). */
  now: Date;
  /** Business timezone for date tokens (ADR-0053); falls back to UTC. */
  timezone?: string;
}

export interface RenderedAutonumber {
  /** Rendered text before the sequence slot. */
  prefix: string;
  /** Rendered text after the sequence slot. */
  suffix: string;
  /**
   * Counter scope: the rendered prefix when the format has date/field tokens,
   * else '' (legacy fixed-prefix formats keep one global counter under a
   * stable empty scope). Drives per-period / per-group numbering and reset.
   */
  scope: string;
  /** Final value: prefix + zero-padded(seq) + suffix. */
  value: string;
}

/**
 * Render a record number for a reserved counter value. Pure: identical inputs
 * yield identical output, which is what lets the engine and the SQL driver
 * agree on the same string.
 */
export function renderAutonumber(input: RenderAutonumberInput): RenderedAutonumber {
  const { tokens, seq, record, now, timezone } = input;
  const dp = calendarParts(now, timezone);
  let prefix = '';
  let suffix = '';
  let width: number | null = null;
  for (const t of tokens) {
    if (t.kind === 'seq') {
      width = t.width;
      continue;
    }
    let piece = '';
    if (t.kind === 'literal') piece = t.text;
    else if (t.kind === 'date') piece = renderDate(t.pattern, dp);
    else if (t.kind === 'field') {
      const v = record ? record[t.field] : undefined;
      piece = v == null ? '' : String(v);
    }
    if (width === null) prefix += piece;
    else suffix += piece;
  }
  const dynamic = hasDynamicTokens(tokens);
  const scope = dynamic ? prefix : '';
  const value = width === null
    // No `{0..0}` slot — append the bare counter (legacy behaviour).
    ? `${prefix}${seq}`
    : `${prefix}${String(seq).padStart(width, '0')}${suffix}`;
  return { prefix, suffix, scope, value };
}
