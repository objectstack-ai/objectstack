// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one rule both `Field.json` storage backfills share: which TEXT cell is
 * rewritten into the form the write path stores, and what it is rewritten to.
 *
 * Two faces hold a json value that reached disk WITHOUT its JSON encoding:
 *
 * - local SQLite (this package's `SqlDriver.backfillCanonicalJsonEncoding`): a
 *   string an older `formatInput` stored raw, before the SQLite write path
 *   JSON-encoded every json value. The issue number that change cites no
 *   longer resolves; its live record is that method's doc block and
 *   `sql-driver-12380-json-roundtrip.test.ts`;
 * - Turso remote (`remote-codec-residue-backfill.ts` in
 *   `@objectstack/driver-turso`, #19868): a scalar the pre-#19844 remote batch
 *   door stored raw.
 *
 * Both import this function, so the two cannot come to disagree about a cell.
 *
 * ## The read codec decides; the write codec supplies the new text
 *
 * The driver reads a json TEXT cell with `JSON.parse` and, when that throws,
 * answers the text itself (`formatOutput`'s SQLite arm, and the remote read
 * path through the same `formatOutput`). So a cell splits cleanly in two:
 *
 * - **`JSON.parse` rejects it** ⇒ it reads back as that exact string. The write
 *   path stores a string as `JSON.stringify(string)`, so that is the new text.
 *   The bytes change and the read does not: `JSON.stringify(s)` parses back to
 *   `s`.
 * - **`JSON.parse` accepts it** ⇒ it reads back as what it parses to, and it is
 *   never rewritten. Either it already is the stored form of that value, or it
 *   is one of the collisions the ruling on that storage format accepts as
 *   unrecoverable (the string `'{"a":1}'` and the object `{a:1}` were the same
 *   bytes; recorded in the same doc block and test).
 *
 * ⛔ SQL may PRE-FILTER candidates (`json_valid(col) = 0`) but never decides.
 * SQLite's JSON parser and the driver's disagree, and the disagreement runs the
 * dangerous way: `json_valid()` answers 0 for JSON nested past SQLite's depth
 * limit (a build-time constant, 1000 in every SQLite this repository bundles,
 * 2000 before SQLite 3.42.0), while `JSON.parse` reads it. Quoting such a cell
 * turned a correctly stored array into a string on the next schema sync
 * (#19912).
 *
 * @param stored the cell's TEXT exactly as the engine read it back
 * @returns the text the write path stores for the value this cell already
 *   reads as, or `null` when the cell must be left as stored
 */
export function recoverUnencodedJsonText(stored: string): string | null {
  try {
    JSON.parse(stored);
    return null;
  } catch {
    return JSON.stringify(stored);
  }
}
