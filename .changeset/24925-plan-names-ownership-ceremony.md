---
'@objectstack/cli': patch
---

fix(cli): `os migrate plan` names the organization-ownership ceremony, not `--allow-destructive`, for the `organization_id` drops `os migrate apply` refuses (#24925)

Clause-②: no

On a database the organization-ownership ceremony has not verified, such as a 17.x one before the ceremony, `os migrate apply --allow-destructive` refuses every run that would drop an `organization_id` column, and drops nothing. No flag stands that refusal down. `os migrate plan` still listed each of those columns as `"os migrate apply --allow-destructive" to drop it.`, closed with `(add --allow-destructive for drops / tightenings)`, and did not mention the ceremony.

- **Now.** Each such drop is still listed and counted as destructive drift. Its line names the ceremony as its remedy: `… (orphaned) — a drop the organization-ownership ceremony owns, and it has not verified on this database: the ceremony drops it itself (see below).`
- **The footer.** It offers `--allow-destructive` for nothing while such a drop is listed, because `apply` refuses the whole run. It still offers `os migrate apply` when there is other work that command performs without the flag. Then it names the ceremony's two commands: `os migrate organization-ownership --out PLAN`, then `os migrate organization-ownership --apply --plan-file PLAN --backup-taken`. It also counts the other destructive changes that wait for the ceremony.
- **Unchanged.** On a database whose ceremony has verified, or one with no `organization_id` drop, the plan reads as before, byte for byte, and on the second it reads no marker. The `--json` document, the exit code and `os migrate apply` are unchanged.

**What to do.** Nothing. On a 17.x database, follow the plan's footer: run the ceremony, then re-run `os migrate plan`.
