---
'@objectstack/runtime': patch
'@objectstack/cli': patch
---

fix(cli,runtime): the ownership refusal `os start` prints names the auth secret the ceremony needs

Clause-②: yes (widening)
Metadata-protocol: none

On a database 17.x or an 18.0 pre-release created, `os start` refuses to boot and names the ownership ceremony. When the operator had set no auth secret, `os start` was serving with the one it generated and keeps in `<home>/auth-secret`, and that secret is not in the operator's shell. Run exactly as printed, the ceremony composed no security plugin: it wrote the plan and stopped the apply at its `authored-conversion` step, and nothing said which secret was missing. The refusal now names both commands with that secret exported from its file, by path:

```sh
OS_AUTH_SECRET="$(cat /srv/app/.objectstack/auth-secret)" os migrate organization-ownership --out PLAN
OS_AUTH_SECRET="$(cat /srv/app/.objectstack/auth-secret)" os migrate organization-ownership --apply --plan-file PLAN --backup-taken
```

A boot whose secret the operator gave (`OS_AUTH_SECRET` in the environment, or `--auth-secret`) names the bare commands, as before: run them with that secret in `OS_AUTH_SECRET`. `os dev` keeps its `--dev` spelling. `OrganizationOwnershipBootGuardOptions` gains the optional `authSecretFile`, the file a production boot read its secret from.

If an apply already stopped this way, it resumes from its checkpoint: re-run it with `OS_AUTH_SECRET="$(cat <home>/auth-secret)"`.
