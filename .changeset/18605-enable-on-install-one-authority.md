---
"@objectstack/spec": minor
---

`enableOnInstall` is declared in three published schemas; each one now says which of the three governs it, and the two that are not the authority say what they are (#18605).

The install door already honours the key — `POST /api/v1/packages` moves the registry row through the same verbs `PATCH /packages/:id/enable` and `PATCH /packages/:id/disable` use: `true` enables, `false` disables, and an ABSENT key makes no lifecycle call at all, so the row the registry returned stands (#18058). What was left was three declarations that looked identical (`z.boolean().default(true)`, same description) with nothing saying which one an author should read.

Clause-②: yes

**The authority**

`PackageInstallRequestSchema` (`api/package-api.zod.ts`) is the one authority, because it is the request contract of the door that honours the key. Its published description now says so, naming the door that honours the key and the three states it honours. Its doc block carries the map to the other two, so a reader never has to guess which of three identical-looking declarations governs.

**`kernel/InstallPackageRequest.enableOnInstall` — a COPY of the request key**

Same type, same optionality, same meaning, restated on the in-process protocol primitive `ObjectStackProtocol.installPackage`. Its published description now records what this layer does with it: the implementation honours the key on the registry row (`true` enables, `false` disables, an ABSENT key makes no lifecycle call at all, tested `=== true` / `=== false` so absence is never collapsed into either), and the HTTP door does not forward the key down that seam — it calls `installPackage({ manifest, settings })` and performs the enable/disable flip itself, because the durable half must follow the row that door returned rather than the request's intent.

The copy is held to the authority by a **parity pin** rather than by a structural reference. The structural spelling is not available in this direction: the authority is built from `ManifestSchema` and `InstalledPackageSchema`, both declared in `kernel/package-registry.zod.ts`, so `PackageInstallRequestSchema.shape.enableOnInstall` spelled there is an import cycle, and under `OS_EAGER_SCHEMAS=1` — the mode `gen:schema` and `check:authorable-surface` run in — it dies with `ReferenceError: Cannot access 'InstalledPackageSchema' before initialization`. `api/package-install-one-authority.test.ts` parses both declarations over one matrix (absent, `false`, `true`, a string, `null`) and reds on any cell where they disagree.

**`marketplace/MarketplaceInstallRequest.enableOnInstall` — not this key at all**

It stays, and its published description says what it is: the marketplace channel's own install option. That request's subject is a listing (`listingId`, `version`, `licenseKey`, `tenantId`), not a manifest; its door is the control plane's `POST /api/v1/marketplace/install`, of which a runtime mounts only a read-only proxy; and the channel resolves the artefact and validates the licence before mapping what it holds into a platform install. It is one translation upstream of the door key, owned by a different party on a different release cadence, so folding it would let a narrowing at the platform door silently narrow a control-plane contract.

**What does not move**

No key is added, removed, renamed or retyped, and no default changes: the accept set of all three schemas is byte-for-byte what it was, and `api-surface`, `authorable-surface` and `authorable-defaults` are all unchanged. What moves is the published description text of three keys and the reference pages generated from it. The `Clause-②` declaration is `yes` as the conservative arm, because three published declarations' stated meaning moves.
