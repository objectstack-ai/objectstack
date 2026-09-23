---
'@objectstack/spec': patch
---

docs(data): `ResolveApiOptions.userExportAllowed` no longer documents itself as "always `true` this phase" — the user-level export bit is wired, and it is a real opt-in grant that can be `false` (#18991)

`Clause-②: no`

⛔ **No behaviour change.** `isLegacyDerivable`, `computeOperations` and `resolveEffectiveApiMethods` are byte-identical; the omitted-option default is still `true` (`opts?.userExportAllowed !== false`), and not one assertion in `api-derivation.test.ts` moved. What changes is two docblocks in `packages/spec/src/data/api-derivation.ts` that made a **false present-tense claim**.

Both carriers said the same untrue thing, and they said it in a direction that invites reintroducing a defect:

- `ResolveApiOptions.userExportAllowed` — "Always `true` this phase (there is no user-level export permission bit yet); wiring a real bit in is a zero-contract change".
- the `API_METHOD_DERIVATION` table docblock — "`export` is `list`, additionally gated by the user-level export slot (…, always `true` this phase — the real permission bit is a follow-up, wiring it changes no contract here)".

The bit exists. `PermissionSetSchema.allowExport` (`src/security/permission.zod.ts`) declares the user-level export axis as an **opt-in grant** — `true` grants export, UNSET or `false` means no export — and the two statements cannot both be true. It is not an aspiration either: `plugin-security`'s `permission-evaluator` resolves `export` as `list ∧ userExportAllowed` and returns `false` from that branch, `plugin-hono-server`'s `/me/permissions` computes the bit and hands it to `resolveEffectiveApiMethods`, and this package's own suite has pinned the `false` arm all along (`export gated off when userExportAllowed=false`).

An author who trusted the old text would read the parameter as inert and could legitimately simplify it away as dead weight — which is the same defect one level upstream of where it was last found, with no consumer left to notice. Both docblocks now state the axis as it is, name `PermissionSetSchema`'s `allowExport` as the authority on its semantics, and keep the one thing that *is* still true distinct from the one that is not: omitting the option resolves to `true` because a resolve carrying no permission context must not narrow the object's own exposure — that is what lets `apiExposureDenialReason` remain a pure function of `enable` — while a caller holding permission context passes the resolved bit explicitly.

**Why this publishes rather than taking `skip-changeset`.** One entry of this package's `files[]` moves. `dist/` ships, and the emitted declaration reproduces both corrected docblocks: the packed `dist/data/index.d.ts` carries the `ResolveApiOptions.userExportAllowed` member text and the `API_METHOD_DERIVATION` table text verbatim. A consumer reading it reads different bytes after this change, so the corrected sentence is what reaches them.
