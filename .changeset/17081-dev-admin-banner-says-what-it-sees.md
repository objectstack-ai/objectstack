---
'@objectstack/cli': patch
---

fix(cli): the boot banner's `🔑 Dev admin` says what that account will and will not see (#17081)

`--seed-admin` (on by default in `os dev`) prints one credential, and it is the
**only** one a first-run operator is given. It is also, by construction, the
account with every *platform* capability and no *app-declared* one: its standing
is `admin_full_access`, whose `systemPermissions` are `setup.access`,
`studio.access`, `manage_users`, `manage_metadata`, `manage_platform_settings`
and `manage_sharing` — all platform built-ins — plus the `'*'`
view-all/modify-all record bits.

So in any app that gates its apps, tabs or nav entries on
`requiredPermissions` — the filter `/me/apps` and `/meta/app` apply, and a
first-class platform feature the docs teach — the credential the terminal hands
over is the account that resolves to an **empty navigation**. A downstream
maintainer ran `pnpm dev`, signed in with it, and read the empty shell as a
broken product. The app was correct. The banner had asserted a login and said
nothing about its audience, and it outranks whatever the app's own README says,
because it sits directly under the command that was just run.

FROM → TO, on a boot that seeds:

```
  🔑  Dev admin: admin@objectos.ai / admin123
      seeded on empty DB · dev only — do not use in production
+     platform admin — Setup, Studio and every record, but NO app-declared capability, so
+     an app that gates navigation on requiredPermissions may show it an empty menu; grant
+     it a permission set under Setup → Users, or sign in as an account your app seeds
```

**Nothing about the seed changes.** What the first run creates — the account,
its address, its password, its promotion to platform admin — is a product-shape
decision and is untouched; only the banner's words move. The three lines print
only inside the branch that already prints the credential, so a boot that seeds
nothing is byte-identical to before.

Dim continuation lines rather than a warning, deliberately: ADR-0115's
`OS_ALLOW_DEV_PLUGIN` amendment excluded the dev-admin seed from that hazard set
because "a warning about a non-event spends the attention the real ones need".
That exclusion is kept — this qualifies an event that just happened, on the line
that already announces it, and adds no new line where there was none.

The route the sentence names is asserted against the declarations that make it
reachable, not re-spelled: `SETUP_APP.requiredPermissions` is a subset of what
this account holds, the `Users` entry is ungated, and the `sys_user` detail page
carries the "Grant permission set" related list. A rename on any of those reds
the pin instead of leaving the banner pointing at nothing.
