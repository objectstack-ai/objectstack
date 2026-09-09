// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16194] The ADR-0030 notification cut-over is RETIRED — the spec half.
 *
 * `migrateSysNotificationToEvent` had no way to be run: zero production
 * callers, and no `os migrate` sub-command, while the two sibling members of
 * {@link CREATION_ATTESTED_MIGRATION_IDS} had both. Giving it an operator door
 * or a boot-time invoker were the two other answers and both were refused; the
 * runner, its barrel export, its tests, the ruled `sys_migration`
 * receipt-claim matrix, that matrix's pin and this id's membership in the
 * attested array were withdrawn together.
 *
 * ## What is pinned here, and why each half
 *
 * ⭐ **The survivors are asserted by name, not by counting.** A case that only
 * says "the retired id is gone" cannot tell a correct removal from an array
 * that lost everything — the two ADR-0104 ids keep their sub-commands, their
 * receipt rows and their attestation, and this file is where that is stated.
 * So every case below carries the positive half beside the negative one.
 *
 * ⭐ **The membership is read as a LITERAL, in order.** Every runtime reader
 * (`attestFreshDatastore` in `@objectstack/platform-objects`, and its own
 * pins) iterates the array, so they follow any change to it by construction: a
 * member silently added back would leave all of them green.
 *
 * ⭐ **The docblock is read for the matrix's ABSENCE.** The retired half was
 * prose, and prose is what comes back first — a `last_run_at` / `applied_at` /
 * `verified_at` claim matrix re-entering this constant's docblock is a receipt
 * contract for a migration that cannot run. The self-test at the bottom feeds
 * the pre-retirement paragraph to the same reader, so the absence check cannot
 * pass merely because the reader stopped finding anything.
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
  expect(open, 'no JSDoc block precedes `NOTIFICATION_EVENT_MIGRATION_ID`').toBeGreaterThan(-1);
  const close = source.indexOf('*/', open);
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

/** The columns the withdrawn receipt-claim matrix stated, as bullet leads. */
const MATRIX_COLUMNS = ['last_run_at', 'applied_at', 'verified_at', 'details.outcome'] as const;

/** True when `block` carries a claim matrix — a bullet led by a ledger column. */
function statesClaimMatrix(block: string): boolean {
  const leads = bullets(block);
  return MATRIX_COLUMNS.some((column) => leads.some((b) => b.startsWith('`' + column + '`')));
}

/**
 * The docblock as it stood BEFORE the retirement, abbreviated to the shape the
 * reader above judges. The self-test feeds it back in: it must be recognised
 * as a claim matrix, or the absence assertion would pass on any prose at all.
 */
const PRE_RETIREMENT_MATRIX = `/**
 * Well-known migration id: ADR-0030 notification convergence.
 *
 *   - \`last_run_at\`: set on every COMPLETED non-\`error\` run — \`migrated\`,
 *     \`already_done\` and \`not_applicable\` alike.
 *   - \`applied_at\`: set only on \`migrated\` (legacy inbox rows were rewritten).
 *   - \`verified_at\`: NEVER set by a run of this migration.
 *   - \`details.outcome\`: the four-valued result, verbatim.
 */`;

describe('[#16194] adr-0030-notification-event: the id left the creation-attested set', () => {
  it('CREATION_ATTESTED_MIGRATION_IDS is exactly the TWO surviving ids, in order', () => {
    // Literal on purpose. A length alone would not notice which member went,
    // and a `not.toContain` alone would pass on an array that lost everything.
    expect([...CREATION_ATTESTED_MIGRATION_IDS]).toEqual([
      FILE_REFERENCES_MIGRATION_ID,
      VALUE_SHAPES_MIGRATION_ID,
    ]);
    expect([...CREATION_ATTESTED_MIGRATION_IDS]).toEqual([
      'adr-0104-file-references',
      'adr-0104-value-shapes',
    ]);
    expect(CREATION_ATTESTED_MIGRATION_IDS).toHaveLength(2);
  });

  it('the two ADR-0104 siblings SURVIVE — the control that tells removal from collapse', () => {
    expect(FILE_REFERENCES_MIGRATION_ID).toBe('adr-0104-file-references');
    expect(VALUE_SHAPES_MIGRATION_ID).toBe('adr-0104-value-shapes');
    expect(CREATION_ATTESTED_MIGRATION_IDS).toContain(FILE_REFERENCES_MIGRATION_ID);
    expect(CREATION_ATTESTED_MIGRATION_IDS).toContain(VALUE_SHAPES_MIGRATION_ID);
  });

  it('the retired id is not a member, by value', () => {
    expect(
      (CREATION_ATTESTED_MIGRATION_IDS as readonly string[]).includes(NOTIFICATION_EVENT_MIGRATION_ID),
    ).toBe(false);
  });

  it('the id itself is KEPT — it still names rows already written under it', () => {
    // The retirement withdrew the runner and the membership, not the name of
    // a `sys_migration` row a deployment already holds. Re-adding a runner is
    // what is refused; deleting the constant is a separate question.
    expect(NOTIFICATION_EVENT_MIGRATION_ID).toBe('adr-0030-notification-event');
  });
});

describe('[#16194] adr-0030-notification-event: the ruled receipt-claim matrix is withdrawn', () => {
  it("the id's docblock no longer states a ledger-claim matrix", () => {
    const doc = notificationEventDoc();
    expect(
      statesClaimMatrix(doc),
      'a receipt-claim matrix is back on an id no code can write a row for — re-read #16194',
    ).toBe(false);
  });

  it('the docblock says the runner is gone and refuses both rejected alternatives', () => {
    const prose = flatten(notificationEventDoc());
    expect(prose).toMatch(/RETIRED/);
    expect(prose).toMatch(/migrateSysNotificationToEvent/);
    // The two answers the ruling refused, named so a later author meets them.
    expect(prose).toMatch(/os migrate/);
    expect(prose).toMatch(/boot-time invoker/);
    // The reversal path, so retirement is not read as a dead end.
    expect(prose).toMatch(/files-to-references/);
  });

  it('self-test: the PRE-retirement matrix is recognised by the same reader', () => {
    // Without this the absence assertion above would pass on a docblock that
    // simply said less — including one that never had bullets at all.
    expect(statesClaimMatrix(PRE_RETIREMENT_MATRIX)).toBe(true);
    expect(bullets(PRE_RETIREMENT_MATRIX).length).toBeGreaterThan(0);
  });
});
