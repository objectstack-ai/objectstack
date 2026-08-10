---
"@objectstack/objectql": minor
---

fix(objectql): the engine's autonumber fallback reads the declared `{0000}` default instead of parsing the empty string (#7262)

Execution half 2/3 — the last one — of the maintainer's route-3 ruling on #6555.
`{0000}` became a declared contract default in `@objectstack/spec/data`
(`DEFAULT_AUTONUMBER_FORMAT` / `resolveAutonumberFormat`); `driver-sql` stopped
writing its own copy down, and the engine now stops too.

`applyAutonumbers` resolved the format by hand:

```ts
const fmt = (def as any).autonumberFormat ?? (def as any).format;
const tokens = parseAutonumberFormat(typeof fmt === 'string' ? fmt : '');
```

An undeclared format therefore parsed the EMPTY string, whose empty token list
`renderAutonumber` renders through its no-slot branch as a bare counter. It is
now `resolveAutonumberFormat(def)` — one resolver, shared with the SQL driver.

**⚠ Unlike the driver half, this one MOVES behaviour — two ways.**

1. **A format-less field on the engine's fallback path issues `0001` where it
   issued `1`.** The path is taken whenever the driver does not advertise
   `supports.autonumber` — `driver-memory`, `driver-mongodb`, any driver without
   the capability. Per the ruling: *choosing {0000} keeps stored driver-sql data
   undisturbed; engine-fallback deployments flip from bare 1 to 0001 for newly
   issued numbers. Counter continuity itself is unaffected (#6468 pinned it).*
   The counter is genuinely untouched: `{0000}` renders an empty prefix and an
   empty suffix, so the seeding scan stays on its unanchored legacy reading and
   goes on reading already-stored bare values (`1`, `2`, `10` → next is 11,
   rendered `0011`). Only the width of newly issued numbers changes, and only on
   this path.

2. **An EMPTY declared format is now "undeclared".** The engine read the key with
   `??`, which respects an empty string, so `autonumberFormat: ''` reached
   `parseAutonumberFormat` as `''` and rendered bare. `resolveAutonumberFormat`
   counts anything that is not a non-empty string as undeclared — the SQL
   driver's long-standing truthiness rule, which is what makes the two sides
   agree — so `autonumberFormat: ''` and `format: ''` now resolve to `{0000}`
   too. One further consequence of the same rule: an empty canonical key no
   longer masks a declared shorthand, so
   `{ autonumberFormat: '', format: 'D-{0000}' }` renders `D-0001` where it used
   to render a bare `1`.

**To keep a bare, unpadded counter**, declare a format with no `{0..0}` slot —
`autonumberFormat: 'PRE-'` renders `PRE-1`. `autonumberFormat: ''` is NOT that
spelling. **To keep the `0001` shape** that SQL deployments already store, and
that a format-less field now mints everywhere, change nothing.

With this, #6555 is closed: one metadata document mints one number shape,
whichever driver serves it.
