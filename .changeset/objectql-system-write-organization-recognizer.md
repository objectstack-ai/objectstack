---
"@objectstack/objectql": minor
---

`@objectstack/objectql` now publishes a recognizer for the org-less system-write refusal, so a consumer no longer has to choose between an unsound check and a re-spelled string.

`SystemWriteOrganizationRequiredError` has always documented that it is identified by `code` rather than `instanceof`, "so the check survives crossing a package boundary where two copies of this module can exist". The convention was correct; the affordance for following it was missing. This package declares **both** realms in its own `exports` — `import` to `dist/index.mjs`, `require` to `dist/index.js` — so a consumer that loads it through the other realm than the engine did holds a second copy of the module. Measured across that split from a real consumer package: same class identity (`A === B`) **false**, `instA instanceof A` within one realm **true**, `instA instanceof B` across the two **false**, and a `code` compare **true**. So `instanceof` against this class was unsound for every consumer, and it failed silently — a `catch` that simply never fires.

That left a consumer with one sound option: re-spelling `'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED'` as a literal. That spelling is what `check:error-code-provenance` counts as a stamp site, so recognising one engine refusal cost the consumer's package a provenance decision of its own, and left the string spelled in two places with the typo failure mode standing — a typo in a `catch` produces a branch that never fires rather than an error.

Two new exports close it, both from the package root:

- **`SYSTEM_WRITE_ORGANIZATION_REQUIRED_CODE`** — the code as a value. Same shape as this package's five existing published codes (`DUPLICATE_RECORD_CODE`, `HOOK_TARGET_REBIND_ERROR_CODE`, `HOOK_UNSCOPED_DATA_ACCESS_CODE`, `MULTI_UPDATE_HOOK_KEY_DIVERGENCE_CODE`, `EMPTY_CREDENTIAL_REFUSAL_CODE`) rather than a new abstraction. The class field now reads from it, so exactly one spelling of the string remains in the package and a typo at an import site is a compile error instead of a dead branch.
- **`isSystemWriteOrganizationRequiredError(err): boolean`** — the code compare itself, so a consumer performs the sound check without authoring the string at all.

The predicate deliberately returns `boolean` and does **not** narrow to `err is SystemWriteOrganizationRequiredError`. A `code` compare is satisfied by any value carrying that code, including an envelope a transport rebuilt from the wire — #5437 withholds the prose and keeps the machine-readable code — so a type guard would promise `object`, `posture` and `reason` members such a value need not have, moving the unsoundness one layer down instead of removing it.

⛔ Nothing about the refusal itself changes: not its `code`, not its 500 status, not when it fires, and not the #8844 `derive-or-refuse` ruling behind it. `SystemWriteOrganizationRequiredError['code']` stays the literal type it was, which is what the existing cross-package consumer types its own constant from. This is purely an addition to what the package publishes.
