// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8413] ONE `TursoDriver`, ONE answer on `unique` — the two faces held
 * against each other on a declared-unique column, and the `conflictKeys`
 * upsert that rests on it.
 *
 * # What was broken
 *
 * `RemoteTransport.buildCreateTableSQL` had no notion of `unique` at all
 * (`grep -ciE 'unique'` over the whole 2986-line file returned **zero**), so a
 * column declared `{ type: 'string', unique: true }` reached a remote Turso
 * endpoint as a bare `"email" TEXT`. Two consequences, one cause:
 *
 *  1. **Declared uniqueness was not enforced on this face.** The same object
 *     definition, the same duplicate write: LOCAL rejected it, REMOTE accepted
 *     it and the duplicate landed. A remote deployment that believed its
 *     `unique` declarations was accumulating duplicates silently, and no read
 *     reported it — Prime Directive #10's shape (declared ≠ enforced) on the
 *     load-bearing kind.
 *  2. **`conflictKeys` upserts could not work on remote at all.** SQLite
 *     requires an `ON CONFLICT` target to be backed by a PRIMARY KEY or UNIQUE
 *     index; with the index never created, every business-key upsert raised a
 *     raw `SqliteError` (`code: 'SQLITE_ERROR'`, `status: undefined`) — not an
 *     ADR-0112 envelope, so a caller could not branch on it either.
 *
 * # Why this file, and not a case in the remote suite
 *
 * #6203's lesson, which this driver has already paid for twice (#5903 `$not`
 * NULL-safety, #5769 `$`-operator keys): a fix that lands on one face is two
 * answers. A per-transport suite cannot fail on the DIFFERENCE — a divergence
 * shows up as one file red and the other green, in whichever order someone
 * reads them. The divergence itself is the defect, so the divergence is what is
 * pinned: same declaration, same write, both faces, one assertion.
 *
 * # The four pins, and what each one alone would miss
 *
 *  - **The DDL pin** asserts the UNIQUE index the remote face emits for a
 *    `unique: true` column, by name and by key. Without it a future rewrite of
 *    the builder drops the key again and only the behavioural pins notice —
 *    from two layers away.
 *  - **The divergence pin** asserts both faces reject the duplicate AND that
 *    exactly one row survives. Asserting only "it throws" would be satisfied by
 *    a transport that threw for an unrelated reason; the row count is the
 *    contract, and it is the number that was actually wrong.
 *  - **The refusal pin** asserts `code` AND `status` (the ADR-0112 envelope) on
 *    an upsert whose conflict target has no backing unique index — the
 *    already-created-table case that (1) cannot retroactively cover. A bare
 *    `toThrow()` here is blind in both directions: it stays green on the raw
 *    `SqliteError` this card exists to remove.
 *
 *  - **The parity pin** [#8568] asserts the two faces' refusals against EACH
 *    OTHER — message, `code` and `status` — on one condition raised twice.
 *    Every pin above it, and #8445's local-face suite, is single-face and pins
 *    its own wording as a LITERAL: a reword of one package with its own literal
 *    updated alongside it drifts the pair while every suite stays green. That
 *    is the state this file was written to make impossible, reached from the
 *    one direction it had left open.
 *
 * The refusal pin carries a **positive control** beside it: with the unique
 * index present, the same `conflictKeys` upsert MERGES. Without that half, a
 * transport that refused every `conflictKeys` upsert unconditionally would pass
 * the refusal pin — and would have broken the capability instead of fixing it.
 * The parity pin carries the same control for the same reason, doubled: two
 * faces that refused everything would agree perfectly.
 *
 * # Reverse verification, direction predicted BEFORE it was run
 *
 * Predicted: reverting `buildCreateTableSQL`'s unique-index emission turns the
 * DDL pin and the remote half of the divergence pin red, and — the direction
 * worth predicting — turns the refusal pin's POSITIVE CONTROL red too, because
 * the merge it asserts is precisely what the missing index made impossible.
 * The refusal pin's negative half stays GREEN across the revert: its table
 * never had a unique index to lose, which is what makes it the pin for the
 * already-created-table case rather than a second copy of the DDL pin.
 *
 * The parity pin [#8568] has TWO legs to predict, because two-way redness is
 * the entire property being bought: rewording ONLY `driver-sql`'s helper must
 * turn it red, and rewording ONLY `driver-turso`'s must turn it red as well. A
 * pin that reddens on one leg only is the one-way pin this card replaced. Both
 * legs were measured (`1 failed | 9 passed` each, the failure being the message
 * comparison in both). The REMOTE leg is the one worth reading: under it every
 * pre-existing pin in this file stayed GREEN, the refusal pin included — its
 * assertions are token regexes (`/crm_contact_plain/`, `/email/`, `/unique/i`)
 * that a reword preserving those words walks straight past, which is exactly
 * how the drift could have landed unnoticed.
 *
 * ⚠️ One measured trap for whoever runs that verification again: the LOCAL face
 * arrives here through the BUILT `@objectstack/driver-sql` (this package
 * resolves the workspace dependency to its `dist`, and there is no vitest alias
 * to `src`). A reworded `sql-driver.ts` therefore changes nothing until that
 * package is rebuilt — leg 1 ran GREEN against a stale `dist` before the
 * rebuild, which reads exactly like a pin that does not work.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StandardErrorCode } from '@objectstack/spec/api';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

/**
 * The card's own object, verbatim: one declared-unique business key beside an
 * ordinary column, and no tenant column — so `uniqueIndexesFromFields` resolves
 * to the single-column `(email)` form and the fixture reads as the card wrote it.
 */
const CONTACT = {
  name: 'crm_contact',
  fields: {
    email: { type: 'string', unique: true },
    title: { type: 'string' },
  },
} as const;

/** The same object with the declaration REMOVED — the un-backed conflict target. */
const CONTACT_NO_UNIQUE = {
  name: 'crm_contact_plain',
  fields: {
    email: { type: 'string' },
    title: { type: 'string' },
  },
} as const;

/** The error a refusal produced — never a bare `toThrow()` (ADR-0112). */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const captureError = async (fn: () => Promise<unknown>): Promise<WireBearingError | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as WireBearingError;
  }
};

describe('[#8413] `unique` is enforced on BOTH TursoDriver faces', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeEach(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://unique-parity.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
  });

  afterEach(async () => {
    await local.disconnect();
    await remote.disconnect();
    stub.close();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Pin 1 — the DDL the remote face actually emits
  // ─────────────────────────────────────────────────────────────────────

  describe('the remote DDL carries the declared uniqueness', () => {
    it('emits a UNIQUE index over a `unique: true` column on CREATE', async () => {
      await remote.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]);

      const indexes = stub.raw
        .prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='crm_contact'`)
        .all() as Array<{ name: string; sql: string | null }>;

      // Named by the SHARED `buildIndexName` (driver-sql's `schema-drift`), so
      // the two faces converge on one identifier rather than two spellings.
      const unique = indexes.filter((i) => typeof i.sql === 'string' && /CREATE UNIQUE INDEX/i.test(i.sql!));
      expect(unique.map((i) => i.name)).toContain('uniq_crm_contact_email');
      expect(unique.find((i) => i.name === 'uniq_crm_contact_email')!.sql).toMatch(/\("email"\)/);

      // …and NOT over the column that never declared it.
      expect(unique.some((i) => /"title"/.test(i.sql ?? ''))).toBe(false);
    });

    it('emits it on the single-object `syncSchema` path too, not just the batch path', async () => {
      // Both paths build DDL; `syncSchema` is the one a lifecycle re-registration
      // and the archive path reach. A fix that landed only in `syncSchemasBatch`
      // would leave this face half-covered and look green on the suite above.
      await remote.syncSchema(CONTACT.name, { ...CONTACT, fields: { ...CONTACT.fields } });

      const names = (
        stub.raw
          .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='crm_contact'`)
          .all() as Array<{ name: string }>
      ).map((i) => i.name);
      expect(names).toContain('uniq_crm_contact_email');
    });

    it('is idempotent — re-syncing an already-synced object does not fail', async () => {
      await remote.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]);
      await expect(
        remote.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]),
      ).resolves.not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Pin 2 — the divergence itself: same declaration, same write, both faces
  // ─────────────────────────────────────────────────────────────────────

  describe('a duplicate on a declared-unique column is refused on BOTH faces', () => {
    it('rejects the duplicate and keeps exactly one row, local and remote alike', async () => {
      await local.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]);
      await remote.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]);

      await local.create(CONTACT.name, { email: 'a@b.com', title: 'first' }, { bypassTenantAudit: true });
      await remote.create(CONTACT.name, { email: 'a@b.com', title: 'first' });

      const localErr = await captureError(() =>
        local.create(CONTACT.name, { email: 'a@b.com', title: 'second' }, { bypassTenantAudit: true }),
      );
      const remoteErr = await captureError(() => remote.create(CONTACT.name, { email: 'a@b.com', title: 'second' }));

      // The divergence in one assertion: neither face may accept it.
      expect({ local: localErr !== null, remote: remoteErr !== null }).toEqual({ local: true, remote: true });

      // Both refusals are the UNIQUE constraint, not some unrelated failure that
      // would satisfy "it threw" while the real defect walked past.
      expect(String(localErr?.message)).toMatch(/UNIQUE constraint failed/i);
      expect(String(remoteErr?.message)).toMatch(/UNIQUE constraint failed/i);

      // …and the number that was actually wrong: the duplicate did not land.
      expect(await local.count(CONTACT.name, {})).toBe(1);
      expect(await remote.count(CONTACT.name, {})).toBe(1);
    });

    it('still accepts distinct values on both faces — the constraint is not a blanket refusal', async () => {
      await local.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]);
      await remote.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]);

      for (const email of ['a@b.com', 'c@d.com', 'e@f.com']) {
        await local.create(CONTACT.name, { email }, { bypassTenantAudit: true });
        await remote.create(CONTACT.name, { email });
      }
      expect(await local.count(CONTACT.name, {})).toBe(3);
      expect(await remote.count(CONTACT.name, {})).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Pin 3 — the enveloped refusal, and the capability it guards
  // ─────────────────────────────────────────────────────────────────────

  describe('a `conflictKeys` upsert with no backing unique index refuses in the ADR-0112 envelope', () => {
    it('answers a real `code` and `status` — never a raw SqliteError', async () => {
      await remote.initObjects([{ ...CONTACT_NO_UNIQUE, fields: { ...CONTACT_NO_UNIQUE.fields } }]);

      const err = await captureError(() =>
        remote.upsert(CONTACT_NO_UNIQUE.name, { email: 'a@b.com', title: 'x' }, ['email']),
      );

      expect(err).not.toBeNull();
      // The measured defect: `code: 'SQLITE_ERROR'`, `status: undefined`.
      // Both halves of the envelope, never a bare `toThrow()` (ADR-0112).
      expect(err!.code).toBe(StandardErrorCode.enum.VALIDATION_ERROR);
      expect(err!.status).toBe(400);
      expect(err!.code).not.toBe('SQLITE_ERROR');

      // The SQLite text an operator debugging the table needs is preserved
      // rather than replaced — the refusal adds a classification, it does not
      // destroy the ground truth.
      expect(String((err as unknown as { cause?: Error }).cause?.message)).toMatch(
        /ON CONFLICT clause does not match/i,
      );

      // The message names the problem an operator has to act on: which object,
      // which keys, and that the remedy is the index — not a retry.
      expect(err!.message).toMatch(/crm_contact_plain/);
      expect(err!.message).toMatch(/email/);
      expect(err!.message).toMatch(/unique/i);
    });

    /**
     * The positive control. Without it, a transport that refused EVERY
     * `conflictKeys` upsert would pass the assertion above — having broken the
     * capability rather than restored it. This is the half that proves the
     * refusal is a diagnosis and not a blanket.
     */
    it('MERGES when the declared unique index does back the conflict target', async () => {
      await remote.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]);

      await remote.upsert(CONTACT.name, { email: 'a@b.com', title: 'first' }, ['email']);
      await remote.upsert(CONTACT.name, { email: 'a@b.com', title: 'second' }, ['email']);

      const rows = await remote.find(CONTACT.name, {});
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('second');
    });

    it('leaves the default `id` merge key working — no conflictKeys, no refusal', async () => {
      await remote.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]);

      const created = await remote.upsert(CONTACT.name, { id: 'fixed_id', email: 'a@b.com', title: 'first' });
      expect(created.id).toBe('fixed_id');
      await remote.upsert(CONTACT.name, { id: 'fixed_id', email: 'a@b.com', title: 'second' });

      const rows = await remote.find(CONTACT.name, {});
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('second');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Pin 4 — the two refusals held against EACH OTHER
  // ─────────────────────────────────────────────────────────────────────

  describe('[#8568] the unbacked-conflict-target refusal is ONE answer across both faces', () => {
    /**
     * Pin 3 above asserts the refusal on the REMOTE face; #8445's
     * `sql-driver-upsert-conflict-target-envelope.test.ts` asserts it on the
     * LOCAL one. Both are single-face by construction, and each pins its own
     * wording as a LITERAL — so a reword of one package, with its own literal
     * updated in the same commit, drifts the pair while every suite stays
     * green. `TursoDriver` picks its face from `url`, so that drift makes the
     * answer to one condition a property of the connection string (#5240: one
     * condition, one wording; the defect class of #6203 / #5769).
     *
     * ⚠️ The assertion below is therefore two RUNTIME answers compared to EACH
     * OTHER — never each against a literal. The literal form is what this pin
     * exists to replace: it passes forever while the faces diverge. A parity
     * test measures agreement, so the change that must turn it red is the
     * SINGLE-face one, and reverse verification has to be run on each face
     * separately to prove it (both legs measured — see the header's reverse
     * verification section, including the stale-`dist` trap on the local leg).
     */
    it('answers the same message, `code` and `status` on the local and the remote face', async () => {
      await local.initObjects([{ ...CONTACT_NO_UNIQUE, fields: { ...CONTACT_NO_UNIQUE.fields } }]);
      await remote.initObjects([{ ...CONTACT_NO_UNIQUE, fields: { ...CONTACT_NO_UNIQUE.fields } }]);

      // One condition, raised twice: the same object with no `unique`
      // declaration, the same `conflictKeys` upsert, once per face.
      const localErr = await captureError(() =>
        local.upsert(CONTACT_NO_UNIQUE.name, { email: 'a@b.com', title: 'x' }, ['email'], { bypassTenantAudit: true }),
      );
      const remoteErr = await captureError(() =>
        remote.upsert(CONTACT_NO_UNIQUE.name, { email: 'a@b.com', title: 'x' }, ['email']),
      );

      // Neither face may ACCEPT it — without this guard a face that stopped
      // refusing would reach the comparison below holding `null`, and the
      // message equality would report a `TypeError` rather than the divergence.
      expect({ local: localErr !== null, remote: remoteErr !== null }).toEqual({ local: true, remote: true });

      // The comparison this pin is for. `toBe` between two runtime values:
      // rewording either compiler alone turns it red, whichever one it is.
      expect(localErr!.message).toBe(remoteErr!.message);
      expect(localErr!.code).toBe(remoteErr!.code);
      expect(localErr!.status).toBe(remoteErr!.status);

      // …and the agreement is ANCHORED, because agreement alone is satisfied by
      // both faces regressing together: two raw SqliteErrors agree on
      // `code: 'SQLITE_ERROR'` and on `status: undefined` just as well. What is
      // worth pinning is agreement ON THE ADR-0112 ENVELOPE. This is a value
      // assertion, not a wording literal — an identical reword of BOTH faces
      // keeps #5240 satisfied and is meant to stay green here.
      expect(localErr!.code).toBe(StandardErrorCode.enum.VALIDATION_ERROR);
      expect(localErr!.status).toBe(400);

      // Both faces also keep the SQLite ground truth as `cause` rather than
      // replacing it — the same shape on both, so an operator debugging either
      // deployment reads the same two layers.
      for (const err of [localErr!, remoteErr!]) {
        expect(String((err as unknown as { cause?: Error }).cause?.message)).toMatch(
          /ON CONFLICT clause does not match/i,
        );
      }
    });

    /**
     * The positive control for the parity pin, mirroring Pin 3's: a pair of
     * faces that refused EVERY `conflictKeys` upsert would agree perfectly and
     * satisfy the assertion above. Agreement is only worth pinning while the
     * capability still works on both — so the backed target must MERGE on both.
     */
    it('and both faces still MERGE when a declared unique index does back the target', async () => {
      await local.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]);
      await remote.initObjects([{ ...CONTACT, fields: { ...CONTACT.fields } }]);

      for (const title of ['first', 'second']) {
        await local.upsert(CONTACT.name, { email: 'a@b.com', title }, ['email'], { bypassTenantAudit: true });
        await remote.upsert(CONTACT.name, { email: 'a@b.com', title }, ['email']);
      }

      expect(await local.count(CONTACT.name, {})).toBe(1);
      expect(await remote.count(CONTACT.name, {})).toBe(1);
      expect((await local.find(CONTACT.name, {}))[0].title).toBe('second');
      expect((await remote.find(CONTACT.name, {}))[0].title).toBe('second');
    });
  });
});
