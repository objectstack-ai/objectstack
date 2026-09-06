---
"@objectstack/cli": minor
---

`os generate migration` now emits the character column `driver-sql` actually creates, in both the TypeScript and the SQL format.

A `text` field took `VARCHAR(255)` from both generators while the platform creates an unbounded `text` column for it, so a 300-character value the platform stores was refused by every generated table with `value too long for type character varying(255)`. Enumerating the whole character-column family found the same disagreement in eight more places: `url` and `phone` and `color` carried widths the generators invented (2048, 50 and 7 against the platform's 255), and neither generator read a field's declared `maxLength` at all, so a `maxLength: 400` email was `varchar(400)` on the platform and `varchar(255)` in the migration generated for it.

All of them now follow the platform's own three answers: the text family is unbounded unless the object KEYS the column — a field declared `unique`, or one an object-level `indexes[]` entry lists, takes `varchar(maxLength)` up to the 768-character key-part ceiling, exactly as the platform builds it, and stays unbounded above that ceiling or with no declared bound, where the declared bound is enforced at the write seam instead — the string family takes its declared `maxLength` verbatim in both directions, and TEXT rather than a clamp when it exceeds what a `varchar` can express, and the remaining string-valued types keep the default width and ignore a declaration, because their stored value is an option code or another row's id rather than the declared string.

The keyed half was measured after the rest: `{ type: 'text', unique: true, maxLength: 100 }` built `varchar(100)` on the platform and `text` in both generated tables, so a 300-character value the platform REFUSES was accepted by every generated table — the same disagreement as the headline row, pointing the other way.

This scopes to PostgreSQL, which is the only dialect `os generate migration --format sql` claims.
