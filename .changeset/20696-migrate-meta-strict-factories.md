---
'@objectstack/cli': patch
---

fix(cli): `os migrate meta` converts an object built with `ObjectSchema.create(…)` instead of stopping at load when the object carries a retired key

Clause-②: no

`os migrate meta` reads a config the current schema refuses, so it can rewrite the
retired keys in it. It did that for artifacts built with a `define*` helper and for
plain object literals. It did not do it for artifacts built with a factory such as
`ObjectSchema.create(…)`, which validates when it is called. An object like this:

```ts
ObjectSchema.create({
  name: 'ticket',
  fields: { title: { type: 'text' } },
  tenancy: { enabled: true, organizationField: 'organization_id' },
})
```

stopped `os migrate meta --from 17` at load with exit 1 and a raw JSON array of
validation issues. The message in that array told the author to run
`os migrate meta --from 17`.

The command now loads it, applies the conversion (here
`object-tenancy-organization-field-removed`), and reports `schemaValid` for the
migrated stack, exactly as it does for the same object written as a plain literal.
This covers the five factories in `@objectstack/spec` that validate when called:
`ObjectSchema.create` (`@objectstack/spec/data`) and `App.create`,
`Dashboard.create`, `Report.create` and `Action.create` (`@objectstack/spec/ui`).
The other `create` factories spec exports return their argument unchanged and
never refused anything, so nothing changes for them.

A schema problem the migration cannot fix is still reported: it is listed among
the refusals under the verdict, and `schemaValid` is `false`. A check that only
the factory makes when it is called, such as `ObjectSchema.create` refusing a
`managedBy: 'system-data'` object that grants no create, edit or delete, is not
part of the stack schema. It is reported on the stderr line described below and
does not change `schemaValid`, the same as `defineStack`'s own call-time checks.
`os validate` still refuses it.

While the config loads, `os migrate meta` prints one stderr line for each
artifact the current schema refused. A raw validation error on that line is now
printed as a block, for example `ObjectSchema.create validation failed (1 issue):`
followed by one `✗ path: message` line per issue, instead of a raw JSON array.
This also applies to `define*` helpers that throw a raw validation error, such
as `defineAgent`.

Nothing else changes. `os validate`, `os build` and every other command still
refuse the retired key at load, with the same message. `ObjectSchema.create` and
the other factories stay strict everywhere outside `os migrate meta`. The keys
of the `--json` payload are unchanged, and a run whose migrated stack does not
parse still exits 0.
