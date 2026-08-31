---
"@objectstack/plugin-security": minor
---

feat(plugin-security): walled bootstrap stops minting the platform-admin grant row; read-only `platformAdmin` audit service; legacy-grant deprecation pointer (#11974, #11663 L4)

Under **walled postures** (`group` / `isolated`), `bootstrapPlatformAdmin` no
longer writes the org-less `sys_user_permission_set` row pointing at
`admin_full_access`. Platform-admin standing on those deployments is
**config-derived** at the one derivation site (`resolve-authz-context.ts`
§6b-config, landed with #11663 L2): every account whose stored `sys_user` row
holds a declared `OS_PLATFORM_OWNER_EMAIL` address and reads VERIFIED resolves
`PLATFORM_ADMIN` at request time — nothing to mint, nothing to revoke, no
window in which a row grants standing that policy would refuse. The `single`
posture keeps first-user promotion and its grant row byte-for-byte (#11663
Choice 4A; 4B is the sequenced follow-up).

What the walled bootstrap still does:

- **Reports standing** — one info line per boot listing, per declared
  address: registered? verified? which account holds standing. The same
  implementation serves the new read-only **`platformAdmin` service**
  (`configuredEmails()` + `standing()`, registered by SecurityPlugin), so the
  log and the audit surface can never disagree. The service is frozen and has
  no writable member — there is deliberately no runtime path that changes who
  a platform administrator is (#11663 Choice 3A).
- **Points legacy grants at the config path** — a detected legacy org-less
  human grant logs exactly one deprecation line per process (shared latch
  with the derivation-site reporter) naming `OS_PLATFORM_OWNER_EMAIL`, the
  holder and the config line that re-anchors them. Nothing is revoked: the
  legacy row still confers during the loud, time-boxed migration window
  (#11663 P5).

The bootstrap-replay trigger (`shouldReplayBootstrapFor`) narrows with the
retired elevation: it now fires only for `sys_user` insert/create under
non-walled postures (the `single` first-user promotion). The #11343 update arm
(`email_verified` / `email`) existed solely to re-attempt the walled elevation
after the owner's verifying write; with standing derived at request time there
is nothing to re-attempt, and under walled postures no `sys_user` write can
change the bootstrap's answer at all.

Walled bootstrap outcomes: a declared usable config now answers
`reason: 'walled_config_derived'` (replacing `walled_owner_not_registered` /
`walled_owner_not_verified`, whose distinctions moved into the standing
report); `walled_owner_email_undeclared` stays for the unset/blank/refused
backstop (Choice 2B: one unparseable entry fails the whole variable closed).
