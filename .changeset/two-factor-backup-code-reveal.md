---
"@objectstack/platform-objects": patch
---

Show 2FA backup codes on the surface a user can actually reach — the reachable
regeneration path was a lockout (#10681).

`sys_user.generate_backup_codes` is mounted at Setup → People & Organization →
Users (Security tab, via `record:quick_actions { location: 'record_section' }`
in `pages/sys-user.page.ts`). It declared no `resultDialog`: it toasted "New
backup codes generated — save them somewhere safe", issued the request, and
dropped the response. The previous code set is invalidated wholesale the moment
that request succeeds, so the reachable path was *old codes destroyed, new codes
discarded* — with no way to get them back:

- better-auth's `twoFactor()` defaults to `storeBackupCodes: 'encrypted'` and
  `auth-manager.ts` passes no `backupCodeOptions`, so `sys_two_factor.backup_codes`
  holds `symmetricEncrypt(JSON.stringify(codes))` — one opaque ciphertext.
- `auth-route-ledger.ts` publishes `generate-backup-codes` and **no** route that
  reads codes back. There is no re-reveal endpoint, by design.

So the API response is the user's one and only sight of those codes.
`generate_backup_codes` now declares the one-shot reveal
(`{ path: 'backupCodes', format: 'code-list' }`) and `enable_two_factor` the QR
equivalent (`totpURI` as `qrcode` + `backupCodes`), which suppresses the toast
and opens an acknowledge-only dialog instead. Both copy the shapes
`sys_two_factor.enable_two_factor` / `regenerate_backup_codes` already carried —
deliberately not a third and fourth spelling of the same declaration.

**Why the correct declarations existed and still did not help.** `sys_two_factor`
carries them and is mounted in **no** app — it appears in no navigation
contribution — so the only 2FA surface a user can reach was the one missing them.
That is why the new pin
(`packages/platform-objects/src/identity/two-factor-one-shot-reveal.test.ts`)
walks the Setup-navigation → page → quick-actions → action chain rather than
asserting a key is present, and holds coverage over a **derived** set: every
identity action targeting a route known to return an unrecoverable secret must
reveal it. A fifth 2FA surface added later is held to the same rule with no edit
to the test. It also fails a `successMessage` declared alongside a
`resultDialog` — the toast is suppressed, so such a message is dead text, and in
this case it was the very string that made the defect look handled.

The declaration-to-response join is measured over a booted stack in
`packages/qa/dogfood/test/two-factor-backup-code-reveal.dogfood.test.ts`: the
declared paths are resolved against the live route's real response, because a
path that stops matching better-auth's response shape opens an **empty** dialog
and loses the codes just as thoroughly, while every declaration-shape assertion
stays green.

**Also corrected, same area:** `sys_two_factor.backup_codes` was described as
"JSON-serialized backup recovery codes". It is JSON *before* encryption; what the
column stores is the ciphertext above. The description now says so, since the
whole reason the reveal must happen at generation time is that this column
cannot be read back.

**Not addressed here:** mounting `sys_two_factor` into navigation is a larger
product-surface decision and is only raised, not taken; `#10700` (re-enrolment
rotating the TOTP secret while keeping `verified=1`) is a separate defect and
remains open.
