---
"@objectstack/cli": patch
---

`os generate migration` now emits the character column `driver-sql` actually creates, in both the TypeScript and the SQL format.

A `text` field took `VARCHAR(255)` from both generators while the platform creates an unbounded `text` column for it, so a 300-character value the platform stores was refused by every generated table with `value too long for type character varying(255)`. Enumerating the whole character-column family found the same disagreement in eight more places: `url` and `phone` and `color` carried widths the generators invented (2048, 50 and 7 against the platform's 255), and neither generator read a field's declared `maxLength` at all, so a `maxLength: 400` email was `varchar(400)` on the platform and `varchar(255)` in the migration generated for it.

All of them now follow the platform's own three answers: the text family is unbounded (its declared bound is enforced at the write seam, not by the column), the string family takes its declared `maxLength` — verbatim in both directions, and TEXT rather than a clamp when it exceeds what a `varchar` can express — and the remaining string-valued types keep the default width and ignore a declaration, because their stored value is an option code or another row's id rather than the declared string.

This scopes to PostgreSQL, which is the only dialect `os generate migration --format sql` claims.
