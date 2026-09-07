// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15710] What a run of `adr-0030-notification-event` may claim in the
 * `sys_migration` ledger — the ruled matrix, pinned to the docblock that
 * states it, to the array that carries the creation-attestation half, and to
 * the arbiter that makes "receipt, not gate" a fact rather than a sentence.
 *
 * When the id was registered (#14025) its docblock deliberately said the
 * column semantics were NOT settled and that "silence is not an answer": the
 * two ADR-0104 ids take their meaning from an `os migrate` command that scans,
 * self-checks and only then records, and this migration has neither. The
 * maintainer then ruled (decision batch #47 item 5, verbatim 「同意」; batch #21
 * had reserved the question): `last_run_at` on every completed non-`error`
 * run, `applied_at` only on `migrated`, `verified_at` never, `details.outcome`
 * carrying the four-valued result, an `error` run writing no claim; the row is
 * a receipt, not a gate; and the id joins `CREATION_ATTESTED_MIGRATION_IDS`.
 *
 * ## What is pinned, and why each half
 *
 * 1. The MEMBERSHIP, as a literal list in order. The runtime reader
 *    (`attestFreshDatastore` in `@objectstack/platform-objects`) and its own
 *    pins iterate the array, so they follow any change to it by construction —
 *    a member silently dropped would leave every one of them green. Only a
 *    literal notices.
 * 2. The DOCBLOCK, as relations rather than wording. The matrix is read as
 *    bullets: the `last_run_at` bullet names all three non-`error` outcomes,
 *    the `applied_at` bullet ties itself to `migrated` alone, the
 *    `verified_at` bullet carries the negation, the `details.outcome` and
 *    `error` bullets exist, and the retired "silence is not an answer"
 *    sentence is gone. Rewording freely is fine; dropping an outcome, or
 *    re-entering `verified_at` as a claim a run may make, goes red.
 * 3. The ARBITER. The receipt shape the ruling names (`verified_at: null`,
 *    `blocking: 0`, `last_run_at` set, `applied_at` set or not) must answer
 *    `false` to {@link isDataMigrationFlagVerified} — otherwise "receipt, not
 *    gate" would be prose over a row that authorises something. The control
 *    beside it proves the `false` is not vacuous.
 *
 * The self-test feeds the historical paragraph to the same readers, so the
 * docblock half cannot pass merely by the prose falling silent.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
  CREATION_ATTESTED_MIGRATION_IDS,
  FILE_REFERENCES_MIGRATION_ID,
  NOTIFICATION_EVENT_MIGRATION_ID,
  VALUE_SHAPES_MIGRATION_ID,
  isDataMigrationFlagVerified,
  type DataMigrationFlag,
} from './migration.zod';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'migration.zod.ts');

/** The JSDoc block attached to the `NOTIFICATION_EVENT_MIGRATION_ID` constant. */
function notificationEventDoc(): string {
  const source = readFileSync(SOURCE, 'utf8');
  const decl = source.indexOf(
    "export const NOTIFICATION_EVENT_MIGRATION_ID = 'adr-0030-notification-event'",
  );
  expect(decl, 'the `NOTIFICATION_EVENT_MIGRATION_ID` declaration moved — re-anchor this pin').toBeGreaterThan(-1);
  const open = source.lastIndexOf('/**', decl);
  const close = source.indexOf('*/', open);
  expect(open, 'no JSDoc block precedes `NOTIFICATION_EVENT_MIGRATION_ID`').toBeGreaterThan(-1);
  expect(close, 'unterminated JSDoc block').toBeLessThan(decl);
  return source.slice(open, close + 2);
}

/** A JSDoc block as flat prose — decorations dropped, wrapped lines rejoined. */
function flatten(block: string): string {
  return block
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The `- ` bullets of a JSDoc block, each rejoined with its continuation
 * lines. A bullet ends at the next bullet or at a blank comment line.
 */
function bullets(block: string): string[] {
  const out: string[] = [];
  let current: string[] | null = null;
  for (const raw of block.split('\n')) {
    const line = raw.replace(/^\s*\*\s?/, '').replace(/^\s*\*\/?\s*$/, '').trim();
    if (line.startsWith('- ')) {
      if (current) out.push(current.join(' '));
      current = [line.slice(2)];
    } else if (line === '' || line === '/**' || line === '*/') {
      if (current) out.push(current.join(' '));
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  if (current) out.push(current.join(' '));
  return out.map((b) => b.replace(/\s+/g, ' ').trim());
}

/** The bullet whose subject is `column` — written as a backticked lead. */
function bulletFor(block: string, column: string): string {
  const found = bullets(block).find((b) => b.startsWith('`' + column + '`'));
  expect(found, `the matrix has no \`${column}\` bullet`).toBeDefined();
  return found as string;
}

/** The sentence the registration wrote and the ruling retired. */
const RETIRED_CLAIM = /silence is not an answer/i;

/**
 * The registration's paragraph, verbatim (#14025 / PR #15450). The self-test
 * feeds it to every reader above: it must fail the matrix and trip the
 * retired-claim predicate, or a docblock that quietly went back to it would
 * pass.
 */
const HISTORICAL_PARAGRAPH = `/**
 * WARNING — what a row under this id MEANS is deliberately NOT settled here,
 * and its silence is not an answer. The two ids above are written by an
 * \`os migrate\` command that scans, self-checks, and only then records, which is
 * what gives \`last_run_at\` / \`applied_at\` / \`verified_at\` / \`blocking\` their
 * meaning for them. This migration has no such command and no self-check: it
 * reports \`migrated\` / \`already_done\` / \`not_applicable\` / \`error\` to its
 * caller and nothing else. Which of those columns a run of it may legitimately
 * claim, whether anything may gate on the row, and whether a datastore created
 * after the cut-over belongs in {@link CREATION_ATTESTED_MIGRATION_IDS}, are
 * open contract questions on this surface (#14025) — not facts this constant
 * asserts, and not ones to settle by copying the neighbours above.
 */`;

const AT = '2026-09-05T00:00:00.000Z';

/** The receipt a run may write, per outcome — never `verified_at`. */
function runReceipt(outcome: 'migrated' | 'already_done' | 'not_applicable'): DataMigrationFlag {
  return {
    id: NOTIFICATION_EVENT_MIGRATION_ID,
    last_run_at: AT,
    verified_at: null,
    applied_at: outcome === 'migrated' ? AT : null,
    blocking: 0,
    details: JSON.stringify({ outcome }),
  };
}

describe('adr-0030-notification-event: creation-attested membership (#15710 ruling 3)', () => {
  it('the id is the well-known string the runner is registered under', () => {
    expect(NOTIFICATION_EVENT_MIGRATION_ID).toBe('adr-0030-notification-event');
  });

  it('CREATION_ATTESTED_MIGRATION_IDS is exactly the three ids, in registration order', () => {
    // Literal on purpose — see the header. A `toContain` alone would not
    // notice a member swapped for another, and a length would not notice
    // which one went.
    expect([...CREATION_ATTESTED_MIGRATION_IDS]).toEqual([
      FILE_REFERENCES_MIGRATION_ID,
      VALUE_SHAPES_MIGRATION_ID,
      NOTIFICATION_EVENT_MIGRATION_ID,
    ]);
    expect([...CREATION_ATTESTED_MIGRATION_IDS]).toEqual([
      'adr-0104-file-references',
      'adr-0104-value-shapes',
      'adr-0030-notification-event',
    ]);
  });

  it('the member is a TYPE of the array too, not only a value', () => {
    // Fails to compile if the tuple type loses the member: the writer's
    // `migrationIds` option is typed against `readonly string[]`, so nothing
    // downstream would notice a narrowing at the type level either.
    const member: (typeof CREATION_ATTESTED_MIGRATION_IDS)[number] = 'adr-0030-notification-event';
    expect(CREATION_ATTESTED_MIGRATION_IDS.includes(member)).toBe(true);
  });
});

describe('adr-0030-notification-event: the docblock states the ruled ledger-claim matrix (#15710 ruling 1)', () => {
  it('`last_run_at` is claimed on every completed non-`error` run — all three outcomes named', () => {
    const bullet = bulletFor(notificationEventDoc(), 'last_run_at');
    expect(bullet).toMatch(/non-`error`/);
    expect(bullet).toMatch(/`migrated`/);
    expect(bullet).toMatch(/`already_done`/);
    expect(bullet).toMatch(/`not_applicable`/);
  });

  it('`applied_at` is claimed only on `migrated`', () => {
    const bullet = bulletFor(notificationEventDoc(), 'applied_at');
    expect(bullet).toMatch(/only on `migrated`/);
    expect(bullet).not.toMatch(/`already_done`|`not_applicable`/);
  });

  it('`verified_at` is never claimed by a run — the bullet carries the negation and says why', () => {
    const bullet = bulletFor(notificationEventDoc(), 'verified_at');
    expect(bullet).toMatch(/\bNEVER\b/);
    expect(bullet).toMatch(/self-check/);
  });

  it('`details.outcome` carries the four-valued result, and an `error` run writes no claim', () => {
    const doc = notificationEventDoc();
    expect(bulletFor(doc, 'details.outcome')).toMatch(/four-valued/);
    const error = bullets(doc).find((b) => /^an `error` run/.test(b));
    expect(error, 'the matrix has no `error` bullet').toBeDefined();
    expect(error).toMatch(/\bNO\b[^.]*claim/);
  });

  it('says "receipt, not gate", cites the receipt precedent, and no longer defers the question', () => {
    const prose = flatten(notificationEventDoc());
    expect(prose).toMatch(/Receipt, not gate/);
    expect(prose).toMatch(/sys-migration\.object\.ts/);
    expect(prose).toMatch(/`verified_at: null`, `blocking: 0`/);
    expect(prose).not.toMatch(RETIRED_CLAIM);
  });

  it('points at the array for the creation-attested half', () => {
    expect(flatten(notificationEventDoc())).toMatch(/\{@link CREATION_ATTESTED_MIGRATION_IDS\}/);
  });

  it('self-test: the registration-era paragraph fails every reader above', () => {
    // No bullets → no matrix; the retired sentence trips the predicate. A
    // docblock that went back to deferring cannot pass by saying less.
    expect(bullets(HISTORICAL_PARAGRAPH)).toEqual([]);
    expect(flatten(HISTORICAL_PARAGRAPH)).toMatch(RETIRED_CLAIM);
  });
});

describe('adr-0030-notification-event: the run receipt authorises nothing (#15710 ruling 2)', () => {
  it.each(['migrated', 'already_done', 'not_applicable'] as const)(
    'a `%s` receipt reads as not verified to the one arbiter',
    (outcome) => {
      expect(isDataMigrationFlagVerified(runReceipt(outcome))).toBe(false);
    },
  );

  it('control: the same row with `verified_at` set WOULD authorise — the `false` above is the null, not the shape', () => {
    expect(isDataMigrationFlagVerified({ ...runReceipt('migrated'), verified_at: AT })).toBe(true);
  });
});
