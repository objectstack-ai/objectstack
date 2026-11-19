// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33724] The column definition the Turso REMOTE face sends to relax a NOT
 * NULL column in place, read from the table's own stored `CREATE TABLE`.
 *
 * # The statement, and why the definition comes from the database
 *
 * The maintainer's ruling on #33724 (record 6915086281, letter A): the REMOTE
 * face relaxes with libSQL's own column statement,
 * `ALTER TABLE t ALTER COLUMN c TO c <definition>`, and runs no table rebuild.
 * libSQL replaces the column's definition in the stored `CREATE TABLE` with the
 * text after `TO`, and does not rewrite or revalidate a row. Whatever that text
 * leaves out is gone from the column: measured on libSQL (SQLite 3.45.1), a
 * definition written as just the type and the default drops the column's
 * COLLATE, CHECK, UNIQUE or REFERENCES clause with the NOT NULL.
 *
 * Ruling parameter 5 is "only nullability changes": the new definition
 * restates what the database holds today. So it is not composed from metadata
 * or from `pragma_table_info` (which strips a parenthesised DEFAULT's
 * parentheses, and knows nothing of COLLATE or CHECK). It is the column's own
 * definition, cut out of the stored `CREATE TABLE`, with its NOT NULL clause
 * removed (`[CONSTRAINT name] NOT NULL [ON CONFLICT algorithm]`) and every
 * other byte kept.
 *
 * The caller also gets the table's whole stored SQL as it must read after the
 * statement ({@link RelaxedColumnPlan.expectedTableSql}): the statement is sent
 * in one `write` batch with a check of exactly that, so a definition the
 * database splices in some other way rolls back instead of landing.
 *
 * # What this module does not do
 *
 * It sends nothing and decides nothing about drift: it answers a plan or the
 * reason there is none ({@link RelaxedColumnRefusal}). The driver's REMOTE
 * column drift arm sends, checks and reads back.
 */

/** One lexical token of a stored `CREATE TABLE`, with its span in the source. */
interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** `punct` is an unquoted `(`, `)` or `,`: the only tokens that nest or separate. */
  readonly kind: 'word' | 'quoted' | 'punct' | 'other';
}

const WORD_CHAR = /[A-Za-z0-9_$\u0080-￿]/;

/**
 * SQLite's lexical structure, as far as finding a column definition needs it:
 * whitespace and both comment forms are skipped; `'…'`, `"…"`, `` `…` `` (a
 * doubled delimiter is an escaped one) and `[…]` are one token each, so a
 * parenthesis or a comma inside them never counts. `null` when a quote or a
 * comment is not closed.
 */
function tokenize(sql: string): Token[] | null {
  const out: Token[] = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const ch = sql[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? n : nl + 1;
    } else if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      if (close < 0) return null;
      i = close + 2;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      for (;;) {
        const k = sql.indexOf(ch, j);
        if (k < 0) return null;
        if (sql[k + 1] === ch) {
          j = k + 2;
          continue;
        }
        j = k + 1;
        break;
      }
      out.push({ text: sql.slice(i, j), start: i, end: j, kind: 'quoted' });
      i = j;
    } else if (ch === '[') {
      const k = sql.indexOf(']', i + 1);
      if (k < 0) return null;
      out.push({ text: sql.slice(i, k + 1), start: i, end: k + 1, kind: 'quoted' });
      i = k + 1;
    } else if (ch === '(' || ch === ')' || ch === ',') {
      out.push({ text: ch, start: i, end: i + 1, kind: 'punct' });
      i++;
    } else if (WORD_CHAR.test(ch)) {
      let j = i + 1;
      while (j < n && WORD_CHAR.test(sql[j]!)) j++;
      out.push({ text: sql.slice(i, j), start: i, end: j, kind: 'word' });
      i = j;
    } else {
      out.push({ text: ch, start: i, end: i + 1, kind: 'other' });
      i++;
    }
  }
  return out;
}

/** An identifier token's name: quotes taken off and a doubled delimiter undoubled. */
function identifierName(token: Token): string {
  if (token.kind !== 'quoted') return token.text;
  const open = token.text[0]!;
  const body = token.text.slice(1, -1);
  return open === '[' ? body : body.split(open + open).join(open);
}

const isWord = (token: Token | undefined, word: string): boolean =>
  token?.kind === 'word' && token.text.toUpperCase() === word;

/** The words that open a TABLE constraint, never a column definition (a column so named is quoted). */
const TABLE_CONSTRAINT_OPENERS = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN']);

/** How the REMOTE face relaxes one column in place. */
export interface RelaxedColumnPlan {
  /** The column's definition as the stored `CREATE TABLE` holds it, name first. */
  readonly definition: string;
  /** The same text with its NOT NULL clause removed: what follows `ALTER COLUMN c TO`. */
  readonly relaxed: string;
  /** The table's whole stored SQL as it must read once the statement has landed. */
  readonly expectedTableSql: string;
}

/** Why there is no {@link RelaxedColumnPlan}: the stored SQL does not say what the relax would need. */
export interface RelaxedColumnRefusal {
  readonly refusal: string;
}

/**
 * Plan the in-place relax of `column` from the table's stored `CREATE TABLE`
 * (`sqlite_master.sql`): its definition, the definition without NOT NULL, and
 * the table SQL the statement must leave behind. A refusal names what in the
 * stored SQL stops it; nothing is guessed.
 */
export function planRelaxedColumnDefinition(tableSql: string, column: string): RelaxedColumnPlan | RelaxedColumnRefusal {
  const tokens = tokenize(tableSql);
  if (!tokens) return { refusal: 'its stored CREATE TABLE has an unterminated quote or comment' };
  const open = tokens.findIndex((t) => t.kind === 'punct' && t.text === '(');
  if (open < 0) return { refusal: 'its stored CREATE TABLE declares no column list' };

  // The column list's elements: split on the commas at its own depth.
  const elements: Token[][] = [];
  let depth = 0;
  let from = open + 1;
  let closed = false;
  for (let k = open; k < tokens.length && !closed; k++) {
    const t = tokens[k]!;
    if (t.kind !== 'punct') continue;
    if (t.text === '(') depth++;
    else if (t.text === ')') {
      depth--;
      if (depth === 0) {
        elements.push(tokens.slice(from, k));
        closed = true;
      }
    } else if (depth === 1) {
      elements.push(tokens.slice(from, k));
      from = k + 1;
    }
  }
  if (!closed) return { refusal: 'its stored CREATE TABLE has an unbalanced column list' };

  const wanted = column.toLowerCase();
  const matches = elements.filter((e) => {
    const first = e[0];
    if (!first) return false;
    if (first.kind === 'word' && TABLE_CONSTRAINT_OPENERS.has(first.text.toUpperCase())) return false;
    return (first.kind === 'word' || first.kind === 'quoted') && identifierName(first).toLowerCase() === wanted;
  });
  if (matches.length !== 1) {
    return { refusal: `its stored CREATE TABLE has ${matches.length} definitions of column "${column}"` };
  }
  const element = matches[0]!;

  // The NOT NULL clauses at the definition's own depth: never one inside a
  // CHECK, a DEFAULT expression or a REFERENCES clause's parentheses.
  const cuts: Array<[number, number]> = [];
  depth = 0;
  for (let k = 1; k < element.length; k++) {
    const t = element[k]!;
    if (t.kind === 'punct' && t.text === '(') depth++;
    else if (t.kind === 'punct' && t.text === ')') depth--;
    else if (depth === 0 && isWord(t, 'NOT') && isWord(element[k + 1], 'NULL')) {
      let first = k;
      let last = k + 1;
      if (first >= 3 && isWord(element[first - 2], 'CONSTRAINT')) first -= 2;
      if (isWord(element[last + 1], 'ON') && isWord(element[last + 2], 'CONFLICT') && element[last + 3]?.kind === 'word') last += 3;
      cuts.push([first, last]);
      k = last;
    }
  }
  if (cuts.length === 0) {
    return { refusal: `the stored definition of column "${column}" carries no NOT NULL clause` };
  }

  const start = element[0]!.start;
  const end = element[element.length - 1]!.end;
  // Each clause goes with the whitespace in front of it: the token before it
  // (the column name at least) ends where the cut begins.
  let relaxed = '';
  let at = start;
  for (const [first, last] of cuts) {
    relaxed += tableSql.slice(at, element[first - 1]!.end);
    at = element[last]!.end;
  }
  relaxed += tableSql.slice(at, end);

  return {
    definition: tableSql.slice(start, end),
    relaxed,
    expectedTableSql: tableSql.slice(0, start) + relaxed + tableSql.slice(end),
  };
}
