---
'@objectstack/spec': patch
---

fix(spec): the driver-config registry refuses an off-vocabulary id instead of answering with a truthy non-schema

`DRIVER_CONFIG_JSON_SCHEMAS`, `DRIVER_ID_ALIASES` and `DATABASE_DRIVER_ALIASES`
are plain object literals, so all three inherit `Object.prototype`, and every
lookup into them was a bare index. Measured against the built artifact
(`dist/data/index.mjs`) on the repo's Node 22 baseline (v22.22.2), an id that
names an inherited member resolved that member and was handed onward as if it
were a driver:

| call | before | after |
|:--|:--|:--|
| `getDriverConfigJsonSchemaById('memory')` | the JSON Schema | the JSON Schema — unmoved |
| `getDriverConfigJsonSchemaById('constructor')` | `{}` — an EMPTY JSON Schema that accepts every config | `TypeError` naming the id and the legal vocabulary |
| `getDriverConfigJsonSchemaById('toString')` | `'[object Object]'` — a **string**, where the signature promises an object | `TypeError` |
| `getDriverConfigJsonSchemaById('valueOf')` | the registry object itself | `TypeError` |
| `getDriverConfigJsonSchemaById('__proto__')` | `TypeError: … is not a function` | `TypeError`, now naming the id |
| `getDriverConfigJsonSchemaById('nope')` | `TypeError: … is not a function` | `TypeError`, now naming the id |
| `resolveDriverId('constructor')` | the `Object` **function** — truthy, not a driver id | `undefined` |
| `resolveDriverId('__proto__')` | `Object.prototype` — a truthy object | `undefined` |
| `resolveDatabaseDriverId('constructor')` | the `Object` **function** | `undefined` |
| `driverHasLocalDefault('constructor')` | `undefined`, out of a function declared `boolean` | `true`, as its doc promises for an unknown id |
| `resolveDriverId('pg')` / `resolveDriverId(' PostgreSQL ')` | `'postgres'` | `'postgres'` — unmoved |

`getDriverConfigJsonSchemaById` handing back `{}` is the worst of these: an
empty JSON Schema validates anything, so a Studio connection form or a
`DriverDefinitionSchema.configSchema` consumer that asked "what shape must this
config have" was told "any shape at all" and reported success.

The resolvers' half is reachable without a plain-JS consumer. The CLI refuses an
unclaimed operator selection with `if (driverType && !kind)` after calling
`resolveDatabaseDriverId`, so `OS_DATABASE_DRIVER=constructor` produced a truthy
`kind` that is not a driver id and walked past the refusal.

All three lookups now go through an `Object.prototype.hasOwnProperty.call` check.
This narrows and widens nothing: every legal spelling is an own key of its table,
so no value accepted before is refused now, and only answers that were never
inside the declared return types move. The declared signatures are unchanged —
`getDriverConfigJsonSchemaById` stays `(id: BuiltinDriverId) => Record<string, unknown>`
and both resolvers stay `(driver: unknown) => BuiltinDriverId | undefined`.

A null-prototype table was the other available shape and was measured rather than
assumed: a `__proto__: null` object literal does not type-check against the
`Readonly<Record<…>>` annotation at all (TS2353), and the
`Object.assign(Object.create(null), …)` spelling that does compile silently costs
that annotation — a table missing a driver stopped failing to compile (TS2741).
