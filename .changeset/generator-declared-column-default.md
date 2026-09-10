---
"@objectstack/cli": patch
---

fix(cli): a generated migration carries the column DEFAULT `driver-sql` puts on the same field (#16294)

## What was wrong

Neither `os generate migration` format read a field's `defaultValue`, so a table
created from a generated migration had no column DEFAULT where the platform's
own table has one. A row inserted out of band — by a database client, a seed
script, anything that does not go through the engine — got NULL where the
declared value belonged.

Driven on live PostgreSQL 16.13: one object, three schemas, one producer each
(`driver-sql` through `initObjects`, `--format sql` through `db.raw`,
`--format ts` by importing the emitted module and calling `up(db)`), with
`information_schema.columns` read back per schema.

```
field                driver                          sqlgen               verdict
f_default            null=YES default='hello'::text  null=YES default=-   DIVERGED
f_default_required   null=YES default='hello'::text  null=YES default=-   DIVERGED
```

After: `diverged: 0 of 6` on the card's probe, and 22 of 23 on a wider one
covering every `defaultValue` shape.

## What changed

Both formats now render one shared verdict, taken from
`SqlDriver.applyDeclaredColumnDefault` — the single place a `defaultValue`
becomes DDL on the platform side:

- a **literal** is emitted, quoted the way knex binds it (`DEFAULT '42'`, not
  `DEFAULT 42` — PostgreSQL keeps those two textually apart forever in
  `column_default`, and the driver's column carries the quoted form);
- **`'NOW()'`** becomes the driver's own translation, which is type-branched:
  `CURRENT_TIMESTAMP` on a timestamp column, and a UTC-pinned expression on
  `date` / `time`, because a bare `CURRENT_TIMESTAMP` resolves those in the
  server's timezone;
- **any other runtime token** (`current_user`), an **Expression envelope** and
  an **option-level `default: true`** emit nothing, each because the driver
  emits nothing — the engine owns those, and a column DEFAULT would override a
  decision it makes deliberately;
- a **`multiple: true`** field gets neither, because `createColumn` returns
  before both questions.

No authorable key, export or accepted-input set changes: `defaultValue` was
already declared, already parsed and already honoured by the driver. The
generators simply now read it.
