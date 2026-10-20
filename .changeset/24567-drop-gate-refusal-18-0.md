---
'@objectstack/cli': patch
---

fix(cli): `os migrate apply --allow-destructive`'s organization-ownership refusal states the ceremony's record in its `--json` `detail`

Clause-②: no

- **`os migrate apply --allow-destructive --json` on a database the organization-ownership ceremony has not verified.** When the run would drop `organization_id` from a table the ceremony owns, the refusal's `detail` reads "No run of the organization-ownership ceremony is recorded on this database.", or names the last unverified run with its date and blocking count. The human message names the ceremony's plan and apply, which drop these columns themselves.

Nothing else changes. The refusal still holds back the whole run, and its message code (`refused_organization_ownership_unmigrated`), `tables`, `marker`, exit code `1` and every flag are as before.
