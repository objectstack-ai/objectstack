---
"@objectstack/client": minor
---

fix(client): `packages.get` binds the bare `InstalledPackage` row on both the global and the environment-scoped client, replacing a `{ package }` envelope no surface emits (#12034)

`client.packages.get(id)` and `ScopedEnvironmentClient.packages.get(id)` now resolve to **`InstalledPackage`** — the row itself — instead of an object wrapping it.

**Migration — read the row directly, not `.package`:**

```ts
// before
const { package: pkg } = await client.packages.get('com.acme.crm');
const pkg2 = (await scoped.packages.get('com.acme.crm')).package;

// after
const pkg = await client.packages.get('com.acme.crm');
const pkg2 = await scoped.packages.get('com.acme.crm');
```

FROM `{ package: any }` (global) and `{ package: InstalledPackage }` (scoped) TO `InstalledPackage` on both.

This is a **narrowing**: a `.package` read compiles today and stops compiling after this change. That is the point of the change rather than a side effect of it — the wrapper was never what the wire sent, so every one of those reads was already `undefined` at runtime, and on the global method the `any` member is what kept the falsehood invisible. Nothing about the request or the wire changes; only the declaration moves to match what the server has been sending.

Why it can be bound now, when #11925 deliberately left it erased: this route used to be served by two implementations that disagreed — the runtime dispatcher sent the bare row, the `@objectstack/rest` registrar sent `{ package }` — so no declaration was true on both. The registrar's read routes were removed in #16628, leaving the dispatcher's `/packages` domain as the single implementation. It builds the detail body with the same expression it maps over every `list` row, which is why this type now agrees with the `InstalledPackage[]` that `packages.list` has already declared, and with `GetInstalledPackageResponseSchema` in `@objectstack/spec`, which has declared `data: InstalledPackageSchema` all along.

The environment-scoped method is the sharper half of the change: its member was a real `InstalledPackage`, not `any`, so `.package` reads there looked type-safe while returning `undefined` against every surface that has served that path since #16628.
