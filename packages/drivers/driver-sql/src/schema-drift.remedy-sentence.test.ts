// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23925 — the remedy sentence a destructive COLUMN entry's message ends with,
 * `os migrate apply --allow-destructive`, comes off the finding exactly, and
 * the message itself is the one the differ always wrote.
 *
 * `os migrate plan` takes the sentence off ({@link driftFindingWithoutRemedy})
 * only for an entry whose reporting driver declares it cannot apply it (the
 * Turso REMOTE face, which runs no SQLite table rebuild), and shows the
 * driver's limit in its place. Every other reader (the boot `[schema-drift]`
 * warning, the artifact-pinned boot gate, the plan's `--json` document, the
 * apply) keeps the message as written, so these pins hold both halves:
 *
 *  1. each destructive column entry's message, character for character as it
 *     was before the sentence was spelled once (`DESTRUCTIVE_COLUMN_REMEDY`);
 *  2. the finding without the sentence: the message minus exactly that tail,
 *     with no `--allow-destructive` left in it;
 *  3. every other message comes back unchanged, and so does a message that
 *     does not end with its op's sentence.
 */

import { describe, expect, it } from 'vitest';
import { diffManagedTable, driftFindingWithoutRemedy, type ManagedDriftEntry } from './schema-drift';

function only(entries: ManagedDriftEntry[], op: string): ManagedDriftEntry {
  const found = entries.filter((d) => d.op.type === op);
  expect(found, JSON.stringify(entries.map((d) => d.op.type))).toHaveLength(1);
  return found[0]!;
}

/** `code` declares the NOT NULL its column lacks; `memo` has a NOT NULL nobody declared; `legacy` is declared by nothing. */
const sqliteDrift = diffManagedTable({
  table: 't',
  fields: {
    code: { type: 'text', storage: { notNull: true } },
    memo: { type: 'text' },
  } as never,
  columns: [
    { name: 'code', type: 'text', nullable: true },
    { name: 'memo', type: 'text', nullable: false },
    { name: 'legacy', type: 'text', nullable: true },
  ],
  dialect: 'sqlite',
});

/** A width the declaration caps below the column's: PostgreSQL enforces a varchar length, SQLite does not. */
const postgresDrift = diffManagedTable({
  table: 't',
  fields: { name: { type: 'text', maxLength: 50 } } as never,
  columns: [{ name: 'name', type: 'character varying', nullable: true, maxLength: 100 }],
  dialect: 'postgres',
});

const CASES: Array<[op: string, entry: ManagedDriftEntry, message: string, finding: string]> = [
  [
    'tighten_not_null',
    only(sqliteDrift, 'tighten_not_null'),
    't.code: metadata declares `storage.notNull` but the column is nullable — existing nulls must be backfilled. Run "os migrate apply --allow-destructive".',
    't.code: metadata declares `storage.notNull` but the column is nullable — existing nulls must be backfilled.',
  ],
  [
    'drop_column',
    only(sqliteDrift, 'drop_column'),
    't.legacy: column exists in the database but not in metadata (orphaned) — "os migrate apply --allow-destructive" to drop it.',
    't.legacy: column exists in the database but not in metadata (orphaned)',
  ],
  [
    'narrow_varchar',
    only(postgresDrift, 'narrow_varchar'),
    't.name: metadata caps at 50 chars but the column allows 100 — narrowing may truncate. "os migrate apply --allow-destructive".',
    't.name: metadata caps at 50 chars but the column allows 100 — narrowing may truncate.',
  ],
];

describe('the destructive column entries: the message as always, and the finding without its remedy', () => {
  it.each(CASES)('%s', (_op, entry, message, finding) => {
    expect(entry.category).toBe('destructive');
    expect(entry.message).toBe(message);
    const bare = driftFindingWithoutRemedy(entry);
    expect(bare).toBe(finding);
    expect(bare).not.toContain('--allow-destructive');
    // Exactly the tail, nothing else: the finding plus the sentence is the message.
    expect(entry.message.startsWith(bare)).toBe(true);
  });
});

describe('every other message comes back unchanged', () => {
  it('a needs-confirm column entry (its remedy is not the --allow-destructive sentence)', () => {
    const relax = only(sqliteDrift, 'relax_not_null');
    expect(driftFindingWithoutRemedy(relax)).toBe(relax.message);
  });

  it('a message that does not end with its op\'s sentence is not cut', () => {
    const tighten = only(sqliteDrift, 'tighten_not_null');
    const reworded = { ...tighten, message: 't.code: written by some other build, with no remedy sentence.' };
    expect(driftFindingWithoutRemedy(reworded)).toBe(reworded.message);
  });
});
