---
'@objectstack/cli': patch
---

fix(cli): `os migrate organization-ownership --apply` names the uncomposed security plugin, and no longer prescribes removing the grants or bindings of the platform's own sets and positions, when it runs without an auth secret

Clause-②: no

**What was wrong.** The ceremony's boot composes the security plugin only where `os serve` would: behind the auth gate, which needs `OS_AUTH_SECRET` or a development boot. That plugin declares the platform's shipped permission sets (`admin_full_access`, `organization_admin_no_bypass`, `member_default` and the rest) and the built-in positions (`everyone`, `org_admin` and the rest). Run without the secret, the catalog resolves none of them, and the ceremony blocked with a remedy aimed at the rows instead of the cause:

- `rewrite`, a grant that names a shipped set. FROM: "… which the security catalog does not resolve (…). Declare or author the set, or remove the grants, then re-run." Removing those grants strips the seeded administrator's standing.
- `rewrite`, a legacy grant whose set row is a shipped set (a 17.x database). FROM: "… still name no permission set (…). The rewrite could not derive their name (see its notes); name or remove each, then re-run."
- `authored-conversion`, the seeded `everyone` binding. FROM: "… the catalog holds no position of that name to carry them. Declare the position (or remove the bindings), then re-run."
- The rewrite gate under a wall, the same binding. FROM: "… deleting them would lose a grant. The authored-conversion step carries them; resolve its blocker, then re-run." Under a wall that step only reports, so it has no blocker to resolve.

**What changed.** When the boot did not compose the security plugin and the name is one the plugin declares, each blocker keeps its first sentence and its remedy becomes, TO: the composition's own sentence, the one `os migrate security-catalog-overlays` prints ("Did not compose the security plugin: `os serve` composes none here (REASON), so its shipped permission sets are not package-held names on this deployment's boot."), then "NAME is one of the permission sets it ships: keep the grants, and re-run where the security plugin is composed." For a position it reads "NAME is one of the built-in positions it declares: keep the bindings, and re-run where the security plugin is composed." A legacy grant's blocker names its set row: "N grant(s) still name no permission set (…): their set row is NAME, which the security catalog does not resolve."

**Unchanged.**

- Every step still refuses. Nothing is resolved, skipped or guessed, and nothing is deleted.
- A name the plugin does not declare keeps its remedy. So does every name when the boot composed the plugin. Whether it was composed is the boot's own answer, never inferred from a missing name.
- A legacy grant left unnamed for any other reason (no id, a missing set row, another organization's row) keeps the general blocker.
