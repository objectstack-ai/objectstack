---
'@objectstack/rest': patch
---

fix(rest): a `/data` create or update refused by a NOT NULL column names the field by its label, in the caller's language

Clause-②: no (message text only: the refusal's `status`, `code` and `fields[]` keys and codes do not move, and no accept set changes)

- **Before.** A field declared `storage: { notNull: true }` without `required` is refused by the database, not by the record validator. `PATCH /api/v1/data/OBJECT/ID` with `{ "unit_price": null }`, on a field labelled "Sales Price", answered `400 VALIDATION_FAILED` with `error` and `fields[0].message` both `"unit_price is required"`. The user saw the column key. The same field declared `required` was refused by the validator, by its label.
- **Now.** `POST /data/:object` and `PATCH /data/:object/:id` name the field the way the record validator names its own `required` refusal: the catalog's `required` sentence, in the caller's locale, with the field's translated label, then its declared label. A `zh-CN` caller reads `销售价格不能为空`. For a field that declares `storage.notNull`, the `hint` says to send a value, or to omit the field when a default or a hook populates it. It no longer prescribes `required` or `os migrate`.
- **Unchanged.** `status`, `code`, `fields[0].field` (the column key), `fields[0].code` (`required`), `object` and the key set. Drift keeps the drift hint: a field declared with neither `required` nor `storage.notNull` over a column that is still NOT NULL. A column the object does not declare keeps today's sentence. So does a refusal the driver attributes to another table, and any answer when the object or the i18n service cannot be read. The door makes the extra object read only for a NOT NULL refusal, and it is the by-name read the exposure gate already makes on every `/data` request.
