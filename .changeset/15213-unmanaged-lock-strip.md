---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/cloud-connection': minor
'@objectstack/cli': minor
---

An unmanaged install no longer copies a package's protection lock: every copied item is editable, and the install's answer names each lock it dropped with the package's reason (ADR-0131 D6, ADR-0010 §3.3)

Clause-②: yes (widening: the new response field `strippedLocks` on `ImportUnmanagedPackageResponseSchema`, relayed on the install-local answer for `installMode: 'unmanaged'`)

An unmanaged install copies a package into this environment as the environment's own metadata. Until now an item the package shipped with an ADR-0010 lock (`_lock`, with its `_lockReason` and `_lockSource`) was copied with that lock, so the next save of the copy answered `403 ITEM_LOCKED`. The package permitted the unmanaged install through its `installModes`, so it chose to let environments take editable copies; a lock whose source is the package does not survive the copy.

**This entry supersedes two sentences of the entry `15213-install-modes`, in this same release.** That entry says "One exception is carried: an item the package ships with an authored protection lock (`_lock`) keeps that lock on the copy as written today, and a follow-up on #15213 strips it per #22971's ruling A", and later "except an item shipped with an authored `_lock`, which keeps that lock". What holds now: the copy carries no lock, its next save edits it, and the install's answer lists each lock dropped. Where the two entries disagree, this one is current.

- **The copy** (`@objectstack/metadata-protocol`). `importUnmanagedPackage` writes every item without `_lock`, `_lockReason` and `_lockSource`. Its answer gains `strippedLocks`: one entry per lock that bound (`no-overlay`, `no-delete` or `full`), in the order the items were written — `{ type, name, lock, reason? }`, with `reason` the package's `_lockReason` verbatim and absent when the package gave none. A package that locks nothing answers `strippedLocks: []`. A lock the spec's declarations refuse (an unknown `_lock` value, a reason that is not a string) is not stripped: the save door refuses that item as before, `422 INVALID_METADATA`, and the install is rolled back. A managed install is unchanged: the package stays the authority, and its locks bind.
- **The declaration** (`@objectstack/spec`). `ImportUnmanagedPackageResponseSchema` declares `strippedLocks`; `lock` takes the three binding values of `MetadataLockSchema`.
- **The install door** (`@objectstack/cloud-connection`, `POST /api/v1/marketplace/install-local` with `installMode: 'unmanaged'`). The answer carries the import's `strippedLocks` as the import states it.
- **`os package install --install-mode unmanaged`** (`@objectstack/cli`). Each dropped lock prints as one line under `Locks removed`, spelled `<type>.<name>: <lock> — <reason>`, so the installer reads why the vendor locked an item before editing it. An answer from a runtime that states no list prints no lock line.

Nothing is removed or narrowed: the answer gains a field, and every refusal of the unmanaged install is unchanged.
