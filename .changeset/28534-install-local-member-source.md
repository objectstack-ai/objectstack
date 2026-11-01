---
"@objectstack/cloud-connection": minor
---

fix(cloud-connection)!: every member of an installed bundle is recorded as installed, whatever its entry's `source` states

`POST /api/v1/marketplace/install-local` (and `os package install`) now registers every member of a `packages[]` bundle as `source: 'marketplace'`, at the install and at every restart's rehydrate. The `manifest` service stamps an entry's own `source` over the door's, so a member whose entry said `'code'` was recorded as the host's own code, and readers of a package's origin treated it so: the connector materializer let its package-relative file refs read the host's directory.

Clause-②: no (narrowing) — at the install-local door a `packages[]` entry's stated `source` no longer decides the member's recorded origin: a member stating `'code'` is recorded `'marketplace'`, as the door states. Nothing is widened.

Metadata-protocol: narrowed (an installed bundle member's `source: 'code'` is no longer honoured at the install door)

<!-- adr-0087: not-required (no-migration-prescription) No key is added, removed or renamed and no body is refused: the entry's `source` is still accepted, and still honoured where it means something, the boot of a merged artifact; at the install door the door's own statement wins, and it is the origin of every package this door registers. There is nothing for an author or a migration to rewrite. -->

**BREAKING** semantic narrowing at the install-local door (`@objectstack/cloud-connection`), shipped as `minor`.

- **Before.** A bundle installed through the door whose second member's entry stated `source: 'code'` recorded that member as `'code'`, and a ledger entry holding such a bundle did so again at every restart.
- **Now.** Both members are recorded `'marketplace'`, at the install and at the rehydrate, so a ledger entry written earlier is recorded the same way after the next restart.
- **Unchanged.** The `manifest` service's precedence for a boot that registers a merged artifact stating no source of its own: each entry's statement still stands there. An entry stating `'marketplace'` or nothing is handed through as received.
- **Who sees it.** A bundle installed through this door whose entry claimed `'code'`. Its members now read as installed everywhere a package's origin is read.

**The remedy.** None is owed. Drop the entry's `source` if it was written for this door: the door states the origin of what it installs.
