---
'@objectstack/types': patch
---

fix(types): a NOT NULL refusal's hint no longer tells the author to declare the field `required`, and the caller that holds the field map can name the field by its label

Clause-②: no (message text only: the refusal's `status`, `code` and `fields[]` keys and codes do not move, and no accept set changes)

- **The hint holds for both ways in.** `mapDataError` classifies a driver's NOT NULL refusal from the driver's text, which names the column and nothing else. Its hint used to lead with "provide it, or declare the field `required` in the object metadata". For a field declared `storage: { notNull: true }` without `required` (ADR-0113's engine-populated column, filled by a hook or a default), declaring `required` is the move ADR-0113 D1 / D2 rule out: it puts the demand back on the form. The hint now leads with "requires a value: provide one", and names drift (`os migrate`) only as the case where the object declares neither `required` nor `storage.notNull`.
- **`notNullRefusalSite(answer)` and `relabelNotNullRefusal(answer, { message, declaresNotNull })`.** The first answers the column, and the table where the dialect names one (SQLite, Postgres), when `answer` is the NOT NULL refusal `mapDataError` built. It answers `undefined` for every other answer, including a record validator's own `required` refusal with the same `code`. The second replaces `error` and `fields[0].message` with the caller's sentence. For a field that declares `storage.notNull`, it also replaces the hint with one that names neither `required` nor `os migrate`. Every other key and value is unchanged. The classification itself still reads no field map.
