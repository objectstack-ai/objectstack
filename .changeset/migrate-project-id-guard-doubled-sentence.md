---
"@objectstack/metadata": patch
---

fix(metadata): `migrateProjectIdToEnvironmentId`'s raw-driver guard stated its instruction sentence twice (#13219)

An operator who called `migrateProjectIdToEnvironmentId` with a driver that has
no `raw()` was refused correctly, but read the same remedy twice in one message:

```
migrateProjectIdToEnvironmentId: driver must expose a .raw(sql, bindings?) method. migrateProjectIdToEnvironmentId: driver must expose a .raw(sql, bindings?) method. SqlDriver (better-sqlite3/knex) supports this; cloud-side TursoDriver also conforms.
```

The sentence was concatenated twice, a copy-paste artifact — the sibling
`migrateEnvIdToProjectId` carries the correct single-sentence form of the
identical guard. Cosmetic and operator-facing only: the guard fires on exactly
the same condition, the remedy it names is unchanged, and nothing parses the
message. The duplicate line is deleted; the surviving sentence keeps the
trailing space that separates it from the one naming the conforming drivers.

The refusal case in the package's tests now pins the properties — the
instruction appears exactly once, no sentence runs into the next, and the
supporting sentence is still present — rather than substring-matching the
message, which could not see a second copy and so passed either way.
