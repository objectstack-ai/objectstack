---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/cloud-connection': minor
'@objectstack/cli': minor
---

An unmanaged install no longer copies a package's protection lock, in either spelling: every copied item is editable, and the install's answer names each lock it dropped with the package's reason (ADR-0131 D6, ADR-0010)

Clause-②: yes (widening: the new response field `strippedLocks` on `ImportUnmanagedPackageResponseSchema`, relayed on the install-local answer for `installMode: 'unmanaged'`)

An unmanaged install copies a package into this environment as the environment's own metadata. A package can lock an item in two spellings: the `_lock` envelope (`_lock`, with `_lockReason`, `_lockSource` and `_lockDocsUrl`), or the author-facing `protection: { lock, reason, docsUrl }` block that a managed install translates into it. Until now an item locked with `_lock` was copied with that lock, so the next save of the copy answered `403 ITEM_LOCKED`; an item locked with `protection` was copied with an inert block that bound nothing, so the vendor's lock vanished without a word. The package permitted the unmanaged install through its `installModes`, so it chose to let environments take editable copies; a lock whose source is the package does not survive the copy.

**This entry supersedes two sentences of the entry `15213-install-modes`, in this same release.** That entry says "One exception is carried: an item the package ships with an authored protection lock (`_lock`) keeps that lock on the copy as written today, and a follow-up on #15213 strips it per #22971's ruling A", and later "except an item shipped with an authored `_lock`, which keeps that lock". What holds now: the copy carries no lock in either spelling, its next save edits it, and the install's answer lists each lock dropped. Where the two entries disagree, this one is current.

- **The copy** (`@objectstack/metadata-protocol`). `importUnmanagedPackage` writes every item without `_lock`, `_lockReason`, `_lockSource` and `_lockDocsUrl`, and, on a type whose schema declares one, without its `protection` block. Its answer gains `strippedLocks`: one entry per lock that bound (`no-overlay`, `no-delete` or `full`), in the order the items were written — `{ type, name, lock, reason? }`, with `reason` the package's reason verbatim and absent when it gave none. Each entry is the lock a managed install of the same item would have bound: an item carrying both spellings is reported once, with the `protection` block's lock and reason, because that is the one a managed install binds. A package that locks nothing answers `strippedLocks: []`.
- **Refusals are unchanged.** A lock the spec's declarations refuse (an unknown `_lock` value, a reason that is not a string, a malformed `protection` block) is not stripped: the save door refuses that item as before, `422 INVALID_METADATA`, and the install is rolled back. So is a `protection` block on a type whose schema does not declare one (`action`, `hook`, `page`). A managed install is unchanged: the package stays the authority, and its locks bind.
- **The declaration** (`@objectstack/spec`). `ImportUnmanagedPackageResponseSchema` declares `strippedLocks`; `lock` takes the three binding values of `MetadataLockSchema`.
- **The install door** (`@objectstack/cloud-connection`, `POST /api/v1/marketplace/install-local` with `installMode: 'unmanaged'`). The answer carries the import's `strippedLocks` as the import states it.
- **`os package install --install-mode unmanaged`** (`@objectstack/cli`). Each dropped lock prints as one line under `Locks removed`, spelled `<type>.<name>: <lock> — <reason>`, so the installer reads why the vendor locked an item before editing it. An answer from a runtime that states no list prints no lock line.

Nothing is removed or narrowed: the answer gains a field, and every refusal of the unmanaged install is unchanged.
