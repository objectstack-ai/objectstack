// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21166] ONE `TursoDriver`, ONE answer on an upsert keyed on a business
 * column: the stored row keeps its identity on BOTH faces, and the call
 * answers the row it landed on.
 *
 * # The contract
 *
 * `SqlDriver.upsert`'s merge set leaves out the columns
 * `SqlDriver.insertOnlyUpsertColumns` names: `id`, `created_at` and every
 * `auto_number` column. Its docblock (#8622) says why for `id`: the moment
 * `conflictKeys` names a business key, writing `id` on the merge leg silently
 * replaces the merged row's identity, and that "dangles every one of them with
 * no error on any dialect".
 *
 * # What was broken (measured on `main` at `f3b16fc2f`)
 *
 * The REMOTE face named only the `auto_number` columns insert-only to
 * `RemoteTransport.upsert`, through its own lookup. So its merge set still
 * carried `"id" = excluded."id"` and `"created_at" = excluded."created_at"`.
 * Rows `row-a` (`a@example.com`) and `row-b` (`b@example.com`), keyed on
 * `['email']`:
 *
 * ```
 * remote  upsert({ id: 'row-NEW', email: a, title: 'edited' })  -> stored id 'row-NEW'
 * remote  upsert({ email: b, title: 'edited too' })             -> stored id = a fresh nanoid
 * local   the same two calls                                    -> stored ids 'row-a', 'row-b'
 * ```
 *
 * And on BOTH faces the merge leg answered the PAYLOAD, not the stored row:
 * the read-back looked the row up by the payload's `id`, which a merge never
 * writes, found nothing, and fell back to the payload. The local face stored
 * `row-a` and answered `id: 'row-NEW'`, an id no stored row has.
 *
 * # The fix, and why it is one list
 *
 * The remote override now hands the transport `insertOnlyUpsertColumns`
 * itself, the list the local face builds its merge set from, so the two faces
 * cannot drift on which columns a merge may write. Both read-backs look the
 * row up by the conflict-key values, the identity the statement matched on.
 *
 * # What is pinned, and what each pin alone would miss
 *
 *  - **The card's table, on both faces**: each stored row keeps its id, the
 *    merge still writes `title`, and the answer names the stored id. Asserting
 *    only the stored id would pass a face that stopped merging at all; the
 *    `title` half is what rules that out.
 *  - **`created_at` on the remote face**: the second member of the shared
 *    list. A fix that added `id` alone to a remote-only list would pass the
 *    card's table and fail here.
 *  - **The controls**: an `id`-keyed upsert still merges in place, and a
 *    business-key upsert that INSERTS still writes the payload's id, or a
 *    minted one, and answers it. An insert-only column is written on the
 *    insert leg; it is never a column that is not written at all.
 *  - **The parity pin**: the two faces' answers compared to EACH OTHER, so a
 *    later edit to one face alone turns it red.
 *
 * `auto_number`, the list's third member, keeps its own pins in
 * `turso-remote-autonumber-generation.test.ts` (the merge leg keeps the number
 * already in the column).
 *
 * The local face reaches this package through the BUILT
 * `@objectstack/driver-sql` (no vitest alias to `src`), so a change to
 * `sql-driver.ts` is seen here only after that package is rebuilt.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

/** The card's object: one installation-wide unique business key beside an ordinary column. */
const CONTACT = {
  name: 'crm_contact',
  fields: {
    email: { type: 'string', unique: 'global' },
    title: { type: 'string' },
  },
} as const;

const A = 'a@example.com';
const B = 'b@example.com';

type Face = 'local' | 'remote';
const FACES: readonly Face[] = ['local', 'remote'];

interface StoredRow {
  id: unknown;
  email: unknown;
  title: unknown;
}

/** Every stored row, in a stable order, with the three columns the card is about. */
const storedRows = async (driver: TursoDriver): Promise<StoredRow[]> => {
  const rows = await driver.find(CONTACT.name, {});
  return rows
    .map((r) => ({ id: r.id, email: r.email, title: r.title }))
    .sort((x, y) => String(x.email).localeCompare(String(y.email)));
};

describe('an upsert keyed on a business column keeps the stored identity on BOTH TursoDriver faces', () => {
  let drivers: Record<Face, TursoDriver>;
  let stub: LibsqlSqliteStub;

  beforeEach(async () => {
    const local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');

    stub = makeLibsqlSqliteStub();
    const remote = new TursoDriver({ url: 'libsql://upsert-identity.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');

    drivers = { local, remote };
    for (const driver of Object.values(drivers)) {
      await driver.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]);
      await driver.create(CONTACT.name, { id: 'row-a', email: A, title: 'first' }, { bypassTenantAudit: true });
      await driver.create(CONTACT.name, { id: 'row-b', email: B, title: 'first' }, { bypassTenantAudit: true });
    }
  });

  afterEach(async () => {
    await drivers.local.disconnect();
    await drivers.remote.disconnect();
    stub.close();
  });

  for (const face of FACES) {
    describe(`the ${face} face`, () => {
      // ─────────────────────────────────────────────────────────────────
      // The card's table
      // ─────────────────────────────────────────────────────────────────

      it('a payload `id` does not replace the stored primary key, and the answer names the stored row', async () => {
        const driver = drivers[face];

        const answered = await driver.upsert(CONTACT.name, { id: 'row-NEW', email: A, title: 'edited' }, ['email']);

        expect(await storedRows(driver)).toEqual([
          { id: 'row-a', email: A, title: 'edited' },
          { id: 'row-b', email: B, title: 'first' },
        ]);
        expect(answered.id, 'the answer names an id no stored row has').toBe('row-a');
        expect(answered.title).toBe('edited');
      });

      it('a payload with no `id` is not re-keyed to the id minted for the insert that lost', async () => {
        const driver = drivers[face];

        const answered = await driver.upsert(CONTACT.name, { email: B, title: 'edited too' }, ['email']);

        expect(await storedRows(driver)).toEqual([
          { id: 'row-a', email: A, title: 'first' },
          { id: 'row-b', email: B, title: 'edited too' },
        ]);
        expect(answered.id, 'the answer names the minted id of the insert that lost').toBe('row-b');
        expect(answered.title).toBe('edited too');
      });

      it('the `_id` alias spelling is folded into `id` and kept off the merge leg the same way', async () => {
        const driver = drivers[face];

        const answered = await driver.upsert(CONTACT.name, { _id: 'row-ALIAS', email: A, title: 'third' }, ['email']);

        expect(await storedRows(driver)).toEqual([
          { id: 'row-a', email: A, title: 'third' },
          { id: 'row-b', email: B, title: 'first' },
        ]);
        expect(answered.id).toBe('row-a');
      });

      // ─────────────────────────────────────────────────────────────────
      // The second member of the shared list
      // ─────────────────────────────────────────────────────────────────

      it('a payload `created_at` does not overwrite the stored one on the merge leg', async () => {
        const driver = drivers[face];
        const before = await driver.findOne(CONTACT.name, { where: { id: 'row-a' } });
        expect(before?.created_at, 'the seeded row carries a birth timestamp to keep').toBeTruthy();

        await driver.upsert(
          CONTACT.name,
          { email: A, title: 'restamped?', created_at: '2001-01-01T00:00:00.000Z' },
          ['email'],
        );

        const after = await driver.findOne(CONTACT.name, { where: { id: 'row-a' } });
        expect(after?.title, 'the merge must still have happened').toBe('restamped?');
        expect(String(after?.created_at)).toBe(String(before?.created_at));
      });

      // ─────────────────────────────────────────────────────────────────
      // Controls
      // ─────────────────────────────────────────────────────────────────

      it('control: an `id`-keyed upsert still merges in place, by default and with `[id]` named', async () => {
        const driver = drivers[face];

        const byDefault = await driver.upsert(CONTACT.name, { id: 'row-a', email: A, title: 'by default' });
        expect(byDefault.id).toBe('row-a');
        expect(byDefault.title).toBe('by default');

        const named = await driver.upsert(CONTACT.name, { id: 'row-b', email: B, title: 'named' }, ['id']);
        expect(named.id).toBe('row-b');
        expect(named.title).toBe('named');

        expect(await storedRows(driver)).toEqual([
          { id: 'row-a', email: A, title: 'by default' },
          { id: 'row-b', email: B, title: 'named' },
        ]);
      });

      it('control: a business-key upsert that INSERTS writes the payload `id`, or a minted one, and answers it', async () => {
        const driver = drivers[face];

        const supplied = await driver.upsert(CONTACT.name, { id: 'row-c', email: 'c@example.com', title: 'new' }, ['email']);
        expect(supplied.id).toBe('row-c');

        const minted = await driver.upsert(CONTACT.name, { email: 'd@example.com', title: 'new too' }, ['email']);
        expect(typeof minted.id).toBe('string');
        expect(String(minted.id).length).toBeGreaterThan(0);

        expect(await storedRows(driver)).toEqual([
          { id: 'row-a', email: A, title: 'first' },
          { id: 'row-b', email: B, title: 'first' },
          { id: 'row-c', email: 'c@example.com', title: 'new' },
          { id: minted.id, email: 'd@example.com', title: 'new too' },
        ]);
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // The two faces held against EACH OTHER
  // ───────────────────────────────────────────────────────────────────────

  it('both faces give one answer to the card table, stored and returned', async () => {
    const run = async (driver: TursoDriver) => {
      const first = await driver.upsert(CONTACT.name, { id: 'row-NEW', email: A, title: 'edited' }, ['email']);
      const second = await driver.upsert(CONTACT.name, { email: B, title: 'edited too' }, ['email']);
      return {
        answered: [first, second].map((r) => ({ id: r.id, email: r.email, title: r.title })),
        stored: await storedRows(driver),
      };
    };

    const local = await run(drivers.local);
    const remote = await run(drivers.remote);

    expect(remote).toEqual(local);
    // …and the answer they agree on is the right one: two faces that both
    // re-keyed would agree perfectly.
    expect(local.stored.map((r) => r.id)).toEqual(['row-a', 'row-b']);
    expect(local.answered.map((r) => r.id)).toEqual(['row-a', 'row-b']);
  });
});
