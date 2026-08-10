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

/**
 * The format an `autonumber` field renders with when it declares none — the
 * **contract default**, not a per-caller fallback (#6555).
 *
 * Before this constant existed, "what does a format-less autonumber look
 * like?" was answered twice, by hand, and differently: the SQL driver
 * substituted `'{0000}'` locally (`0001`, `0002`, …) while the engine's
 * in-memory fallback path parsed the empty string and rendered the bare
 * counter through {@link renderAutonumber}'s no-slot branch (`1`, `2`, …). One
 * metadata document therefore produced a different number *shape* depending on
 * which driver served it — a test asserting `'1'` against the memory driver
 * did not hold in production on SQL.
 *
 * The maintainer ruling of 2026-08-08 on #6555 settles it at `{0000}` and puts
 * the default in the contract rather than in either fallback: `{@link
 * FieldSchema}`'s `autonumberFormat` declares it, and both sides resolve it
 * through {@link resolveAutonumberFormat}. `{0000}` is the shape already
 * stored by SQL deployments, so choosing it leaves landed data undisturbed.
 */
export const DEFAULT_AUTONUMBER_FORMAT = '{0000}';

/**
 * A field declaration, as far as autonumber formatting is concerned. Both
 * spellings appear in real metadata: `autonumberFormat` is the spec-canonical
 * key, `format` the shorthand that predates it (#1603). Typed loosely because
 * the engine and the drivers both reach this with an unvalidated field
 * document in hand, not a parsed {@link FieldSchema}.
 */
export interface AutonumberFormatSource {
  autonumberFormat?: unknown;
  format?: unknown;
}

/**
 * Resolve the format an autonumber field renders with — the ONE place the
 * contract default is applied, so no caller has to keep its own copy (#6555).
 *
 * Precedence: the canonical `autonumberFormat`, then the `format` shorthand,
 * then {@link DEFAULT_AUTONUMBER_FORMAT}. A key holding anything other than a
 * NON-EMPTY string counts as undeclared — which is deliberately the SQL
 * driver's long-standing truthiness rule, not the engine's `??`. The two
 * disagreed on `format: ''` as well as on the missing key, and resolving the
 * empty string to the default is the direction that leaves already-stored
 * driver-sql numbers unchanged.
 *
 * A format that IS declared is honoured exactly as written, including one with
 * no `{0..0}` slot (`'CASE-'` → `CASE-1`) — see {@link renderAutonumber}.
 */
export function resolveAutonumberFormat(field: AutonumberFormatSource | null | undefined): string {
  const canonical = field?.autonumberFormat;
  if (typeof canonical === 'string' && canonical) return canonical;
  const shorthand = field?.format;
  if (typeof shorthand === 'string' && shorthand) return shorthand;
  return DEFAULT_AUTONUMBER_FORMAT;
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
  // The scope IS the rendered prefix. Two records whose tokens render to the
  // same prefix string (e.g. `{a}{b}` for ('AB','C') and ('A','BC')) also render
  // the same VISIBLE number, so they must share one counter to stay unique —
  // splitting them by token boundary would mint duplicate record numbers. The
  // remedy for genuinely-distinct groups is an unambiguous format (a delimiter
  // literal between variable tokens); the compile lint nudges authors there.
  const scope = dynamic ? prefix : '';
  const value = width === null
    // No `{0..0}` slot — append the bare counter (legacy behaviour).
    //
    // This branch is no longer how a FORMAT-LESS field renders (#6555): a
    // field that declares no format now carries the contract default
    // `{0000}` (see {@link DEFAULT_AUTONUMBER_FORMAT} /
    // {@link resolveAutonumberFormat}), so it takes the padded branch below
    // on both the engine and the SQL driver. What still reaches here is a
    // format the author DID declare that happens to carry no sequence slot —
    // `'CASE-'` → `CASE-1` — plus any caller that tokenizes a raw string
    // without going through the resolver.
    ? `${prefix}${seq}`
    : `${prefix}${String(seq).padStart(width, '0')}${suffix}`;
  return { prefix, suffix, scope, value };
}

/**
 * Read the counter back out of ONE stored record number — the inverse companion
 * of {@link renderAutonumber}, and the reason this file's header says "shared by
 * the ObjectQL engine and the SQL driver": both sides MUST call this rather than
 * re-derive the rule, in either direction.
 *
 * # Why this lives here (#6560)
 *
 * `renderAutonumber` composes `prefix + zero-padded(seq) + suffix`, so a format
 * with tokens AFTER the `{0..0}` slot renders a value that does NOT end in its
 * counter (`{000}-{YYYY}` → `001-2026`). PR #6553 (#6468) taught both seeding
 * paths to locate the counter by that declared pair — but as two hand-written
 * copies of the same four lines, one in `packages/objectql` and one in
 * `packages/drivers/driver-sql`. The defect they were fixing was *precisely*
 * that shape: two independent readings of one composition rule had drifted into
 * two DIFFERENT wrong answers over one dataset, so the record-number band a
 * tenant received depended on which driver happened to run, and numbers burned
 * that way are not reclaimable.
 *
 * The maintainer's ruling on #6560 (2026-08-10, and twice on 2026-08-08) puts
 * the reverse rule beside the forward one: the composition is spec's, so its
 * inverse is spec's, and no lower package exists for both consumers to share.
 * Pure and non-authorable — no Zod, no vocabulary, nothing acceptance-facing.
 *
 * # The rule
 *
 * `prefix` and `suffix` are `renderAutonumber`'s own declared output for the
 * record being written; a caller passing anything else is asking a question this
 * function does not answer.
 *
 *   - **Either one non-empty ⇒ the slot is ANCHORED**: the counter is the digit
 *     run at the START of what follows `prefix`, after removing `suffix` when
 *     this value carries it.
 *   - The suffix is stripped *when it matches*, never *required* to match. A
 *     dynamic suffix renders differently per row (`{000}-{YYYY}` is `-2025` on
 *     last year's rows) while the counter scope is the rendered PREFIX — `''`
 *     there — so those rows share this very counter and must still be read.
 *     Requiring the match would read BELOW the real max, which is the
 *     duplicate-record-number harm #6249 fixed on the scan side.
 *   - A value outside the scope (it does not carry `prefix`) reads as
 *     `undefined`: it belongs to another counter and must not lift this one.
 *     Callers that pre-filtered with a looser matcher — a SQL `LIKE` under a
 *     case-insensitive collation — get that re-check here for free.
 *
 * `undefined` means "this value teaches this counter nothing", never `0`.
 *
 * # What this deliberately does NOT decide
 *
 * An UNANCHORED slot (both strings empty) has no canonical reading, and this
 * returns `undefined` for it rather than inventing one. The two consumers keep
 * *different* legacy readings there — the engine takes the LAST digit run of the
 * value, the SQL driver concatenates every digit — and PR #6553 preserved both
 * byte-for-byte on purpose: a format with no `{0..0}` slot renders a bare
 * trailing counter, and values predating any format have no anchor at all.
 * Hoisting either one here would make this contract claim an agreement that does
 * not exist. Each side documents its own fallback at its own call site.
 *
 * # The declared boundary: mixed-content unanchored values are OUT OF CONTRACT (#7287)
 *
 * That refusal is not a gap waiting to be filled — as of the maintainer's ruling
 * on #7287 (2026-08-10, 「宣告边界」, treatment (2)) it IS the contract:
 *
 * > **On an UNANCHORED format (`prefix === '' && suffix === ''`), a stored value
 * > carrying any non-digit content is out of contract for counter readback.**
 * > `undefined` is this function's answer for that slot, permanently.
 *
 * Why declare it rather than pick a reading. The two consumers have read such a
 * value differently since before this helper existed, and both readings are
 * pinned by their own tests:
 *
 *   - the engine's `readStoredAutonumberCounter`
 *     (`packages/objectql/src/engine.ts`) takes the **last digit run** —
 *     `'SO-2024-0007'` → `7`;
 *   - the SQL driver's `scanMaxNumericTail`
 *     (`packages/drivers/driver-sql/src/sql-driver.ts`) **concatenates every
 *     digit** — the same value → `20240007`.
 *
 * Ruling either one to be the contract would move live behavior on the other
 * side, over stored business identifiers that are not reclaimable once issued —
 * which is why #7247 refused the hoist as a rider, and why #7287 rejects it
 * outright rather than picking a side. Declaring the input out of contract costs
 * nothing that was ever promised: no reading was ever specified for it.
 *
 * The boundary is drawn by CONTENT, and deliberately wider than the observed
 * divergence. A **pure-digit** value — which is exactly what `renderAutonumber`
 * emits for an unanchored format — is inside the contract, and both sides answer
 * the same number for it: `'0007'` reads as `7` either way. Everything else is
 * outside, including mixed-content values the two readings happen to agree on
 * (`'CASE-12'` is `12` both ways: divergence needs TWO digit runs, and that one
 * has one). Narrowing the boundary to "values the sides actually disagree on"
 * would make it undecidable from the value alone — a caller would have to know
 * which consumer is running to know whether its input is in contract, which is
 * the very "same metadata, different driver, different number" property this
 * boundary exists to bound. So the out-of-contract face is simply
 * legacy/migrated data: a dash-separated string in a column later declared
 * autonumber.
 *
 * Reachability, and why the boundary is worth stating now: #6555's Route-3
 * ruling (PR #7265) made `{0000}` the declared default for format-less
 * autonumber fields, and `{0000}` renders neither prefix nor suffix — so the
 * DEFAULT authoring shape resolves to this unanchored slot on both sides.
 *
 * Consequence for the consumers, also recorded by the ruling: neither moves.
 * Each keeps its current unanchored reading as **implementation detail outside
 * this boundary**, not as a contract this file underwrites. See the pins in
 * `autonumber-unanchored-boundary.test.ts`, and the ruling itself at
 * https://github.com/objectstack-ai/objectstack/issues/7287#issuecomment-5238560707.
 *
 * The digit match is the linear `/^\d+/` — a backtracking lookahead here is a
 * polynomial-ReDoS sink on stored values full of zeros (CodeQL
 * js/polynomial-redos).
 */
export function readAutonumberCounter(value: string, prefix: string, suffix: string): number | undefined {
  if (prefix === '' && suffix === '') return undefined;
  if (prefix && !value.startsWith(prefix)) return undefined;
  let core = value.slice(prefix.length);
  if (suffix && core.endsWith(suffix)) core = core.slice(0, core.length - suffix.length);
  const head = core.match(/^\d+/);
  if (!head) return undefined;
  const n = parseInt(head[0], 10);
  return Number.isFinite(n) ? n : undefined;
}
