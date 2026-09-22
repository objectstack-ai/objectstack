---
"@objectstack/spec": patch
---

The install door's doc block no longer denies that the in-process protocol primitive reads `enableOnInstall` (#19339).

`PackageInstallRequestSchema.enableOnInstall` (`api/package-api.zod.ts`) carries the map to the other two declarations of this key, and its entry for the kernel copy read: "its own implementation does not read it, and this door does not forward it down that seam". That was true when it was written and stopped being true when `MetadataProtocol.installPackage` started honouring the key (`482d584121`). Nothing went red — no gate compares a sentence against an implementation — and the text ships: `src/**/*.zod.ts` is in this package's `files[]`, and the comment survives into `dist/api/index.js` and `dist/browser/api/index.mjs`.

Clause-②: no

**Only one half of the sentence was false.** It is a compound claim about two layers, and they were re-derived separately from the source rather than rewritten together:

- `MetadataProtocol.installPackage` (`packages/metadata-protocol/src/protocol.ts`, the `requestedEnabled` arms) now reads the key: `true` enables, `false` disables, an absent key makes no lifecycle call at all. That half is corrected, and scoped — the primitive moves the **registry row**, for the life of the process.
- "this door does not forward it down that seam" is **still true** on `main` and is kept: `handlePackages` (`packages/runtime/src/domains/packages.ts`) calls `installPackage({ manifest, settings })` and performs the enable/disable flip itself, then writes the durable record from the row it returned. Correcting that clause would have swapped one false sentence for another.

The scope words are load-bearing: the durable disabled-package record is keyed by environment (`setPackageDisabled(environmentId, …)`), which an `InstallPackageRequest` does not carry, so `POST /api/v1/packages` still owns the half that survives a restart.

**What does not move.** No key is added, removed, renamed or retyped, and no default changes: the accept set is byte-for-byte what it was, `check:api-surface` and `check:authorable-surface` are green with no diff, and no generated reference page changes — this text is a TSDoc block, not a `.describe()`, so `check:generated` reports all 15 artifacts up to date without a regeneration. The declaration is `no` on both limbs: nothing is widened and nothing is retired.
