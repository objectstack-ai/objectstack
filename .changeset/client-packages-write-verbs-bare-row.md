---
"@objectstack/client": minor
---

fix(client): `packages.install` / `enable` / `disable` declare the bare `InstalledPackage` row the only serving surface actually sends (#12034)

**Accept-set narrowing on a published SDK (clause-②), and a false declaration
deleted.** No runtime change: the value each method resolves to is
byte-identical before and after. What moved is the DECLARED type — and unlike
its #11925 siblings this one was not merely erased, it was **wrong**.

FROM → TO, all three methods:

| method | declared before | declares now |
|---|---|---|
| `client.packages.install(manifest, opts?)` | `{ package: any; message?: string }` | `InstalledPackage` |
| `client.packages.enable(id)` | `{ package: any; message?: string }` | `InstalledPackage` |
| `client.packages.disable(id)` | `{ package: any; message?: string }` | `InstalledPackage` |

No surface has ever emitted `{ package, message }` for these three. Each is
served by exactly one implementation — `runtime`'s `/packages` dispatcher domain
— and it answers `success(pkg)`, i.e. `{ success: true, data: <row> }`, which
`unwrapResponse` strips to the bare row. `@objectstack/rest`'s registrar mounts
no twin for any of them (it mounts only `POST /packages/publish`,
`GET /packages`, `GET /packages/:id`, `DELETE /packages/:id`), so there was
never a question of which surface to match.

**Migration — read the row, not `.package`.** Because the member was `any`,
the false read compiled and silently produced `undefined` at runtime:

```ts
// BEFORE — compiled, and `pkg` was `undefined` at runtime
const pkg = (await client.packages.enable(id)).package;
const note = (await client.packages.install(manifest)).message;

// AFTER — the response IS the row
const pkg = await client.packages.enable(id);
pkg.enabled;          // the state the verb just changed
pkg.manifest.version;
```

A consumer stops compiling where it reads `.package` or `.message` off these
three results, or assigns the result somewhere `InstalledPackage` does not fit.
That break is the point: those call sites are already broken at runtime today
and the `any` is what hid it. The compiler is the channel that reaches every
affected consumer, and it is strictly more precise than a release note.

**What deliberately did NOT change: `client.packages.get`.** It keeps
`{ package: any }`. That route is a real fork — the dispatcher answers the bare
row while the REST registrar answers `{ package: { ...row, source } }`, both
measured by driving each registrar — so no declaration is true on both surfaces.
Binding either member would harden a falsehood, which is the defect this change
removes for its neighbours. Making `get` bindable requires converging the two
PRODUCERS, a wire-behaviour change to two mounted surfaces; the measured
convergence cost is recorded on #12034 for that ruling.

No ADR-0087 ledger entry: nothing here is a metadata surface. No Zod schema, no
`packages/spec` declaration and no stored representation changed — the phantom
members existed only in a TypeScript return annotation — so `objectstack migrate
meta` has nothing to rewrite. This is the disposition #11925 and #8140 recorded
for the same class of SDK return-type narrowing.
