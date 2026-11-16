---
'@object-ui/plugin-form': patch
---

fix(plugin-form): a `record:line_items` or master-detail column that names only a `formula` field formats the value the way the formula declares it, so a `returnType: 'currency'` formula prints money instead of the bare number

Clause-②: no
Metadata-protocol: none

A line-items column written as `{ name: 'total_price' }` takes its type from the child field. For a `formula` field it used to map `type: 'formula'` itself, which falls through to a plain text column, so a formula declaring `returnType: 'currency'` printed `157780` on screen and on a printed quote, where its record page and a column authored with `type: 'currency'` print `157,780`.

The column now takes the type the formula's VALUE is declared as, read the way the formula's own table cell reads it: `returnType: 'currency'` gives a currency column, `number` a number column, `date` a date column, `boolean` a Yes / No select, `text` a text column. A `summary` field that declares its currency is a currency column. A formula with no `returnType`, and a summary that declares no currency, hydrate as before (text). The column stays computed and read-only, and a column that declares its own `type` keeps it. A currency column resolves its currency the way every currency column in the grid does.

Nothing to migrate: a column that worked around this with `type: 'currency'` keeps working, and the key can now be dropped.
