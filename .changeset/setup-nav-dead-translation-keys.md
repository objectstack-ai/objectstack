---
"@objectstack/platform-objects": patch
---

chore(platform-objects): drop four dead `apps.setup.navigation` translation keys (#6660)

Four ids kept a Setup nav label in the hand-written locale bundles long after
the nav item that declared them was removed. No composition renders them, so
nothing was broken — but a translated key with no declaring nav item is the
shape `app-nav-translation-parity.test.ts` already refuses for Studio: it reads
as coverage. `nav_workflows` outlived its Studio menu entry in all four locales
the same way, and nothing said so until that reverse assertion was written.

Removed, with the reason each one is gone:

| id | why it has no nav item |
| --- | --- |
| `nav_approval_processes` | the approval process engine was retired in favour of the approval flow node (#1408, ADR-0019 P4/P5) |
| `nav_verifications` | `sys_verification` omits `list` from `apiMethods` |
| `nav_device_codes` | `sys_device_code` likewise — both hold sensitive, ephemeral secrets, so a browse entry could only ever render "failed to load" (#2266) |
| `nav_metadata` | moved to Studio as `nav_metadata_directory` when the Studio app was split out |

14 key/label pairs in total, not 16: `zh-CN` never carried `nav_verifications`
or `nav_device_codes`.

Each id was checked **individually** against a repo-wide grep for a declaring
`id: '<key>'` — zero hits each, against a control probe (`nav_webhooks`) that
returns five. That is deliberately not the same claim as a runtime diff: from a
single booted composition a dead key and a conditionally-contributed one are
indistinguishable (`plugin-auth` contributes `nav_sso_providers` only when an
external IdP is wired), which is why `pnpm check:app-nav-i18n` still refuses the
reverse direction and why this change removes exactly four named ids rather than
"everything the merged app did not declare".

A tombstone test pins the four so they cannot drift back in without their nav
item. Re-adding `nav_verifications` / `nav_device_codes` remains a security
decision — it means enabling `list` on the object first.
