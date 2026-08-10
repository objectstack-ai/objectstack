---
"@objectstack/service-datasource": patch
---

fix(service-datasource): the open-core libSQL arm tells you how to install the driver it is missing (#7314)

`@objectstack/driver-turso` is an OPTIONAL install — it drags `@libsql/client`
and its native bindings — so both loaders that can build a libSQL datasource
have to answer "the package is not here". Until now they answered it very
differently.

The HOST loader (`@objectstack/runtime`'s `loadTursoDriverFactory`, the single
owner since #6268) raises `MissingDriverPackageError` carrying the install
command as data, plus a message naming the command, the consequence, and why the
boot refuses instead of quietly opening a SQLite file. The shared open-core
factory's `turso` arm — the one that serves **every other door**: a datasource
added in Setup, `testConnection`, a declared non-default datasource — said only:

```text
turso driver requested but @objectstack/driver-turso is not installed (…).
```

The fault and nothing else. Same missing package, and whether you were told how
to fix it depended on whether your datasource happened to be named `default`.

That arm now answers with the same quality of remedy:

```text
datasource 'warehouse': a libSQL/Turso datasource was requested, but the driver
package @objectstack/driver-turso is not installed. Install it next to the
server that opens this datasource:

    npm install @objectstack/driver-turso

(pnpm add … / yarn add ….) It is an OPTIONAL package, so a default install stays
free of @libsql/client and its native bindings. This refuses rather than falling
back to another engine: a silent fallback would open an empty local database
that accepts writes while your libSQL data stays untouched, and every write
would land in the wrong database. Import error: …
```

Two deliberate differences from the host loader's wording, because this arm
serves different doors. It **names the datasource** — here there may be several
and only one of them is libSQL. And it names **no** `OS_DATABASE_URL` /
`--database` / `OS_ALLOW_DRIVER_CONNECT_FAILURE`: those select or bypass the
HOST's `default` datasource and can do nothing for the datasource that actually
failed, and pointing a stuck reader at a knob that cannot affect their problem
is the failure `connect-failure-remedy.ts` was written to end (#5794). One fix,
stated once, no escape hatch named.

The original import error is still interpolated in full, which is load-bearing
rather than context: this re-throw drops the error's `code`, so the
unbuilt-workspace classifier can only recognise a half-built checkout from the
`Cannot find package` text the message carries.

`TURSO_DRIVER_PACKAGE`, `TURSO_DRIVER_INSTALL_COMMAND` and
`missingTursoDriverMessage` are exported, so a host that renders the remedy
itself reads one declaration instead of re-typing a sentence.

Behaviour is otherwise unchanged: the same failure at the same moment, still a
refusal and never a fallback to a different engine. Only the message differs.
