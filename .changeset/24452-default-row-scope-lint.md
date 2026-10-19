---
"@objectstack/lint": patch
---

fix(lint): the RLS predicate and org-axis rules judge an object's `defaultRowScope`

Clause-②: no

- **What changed.** `validateRlsPredicateEnforceability` now judges `objects[].defaultRowScope.using` and `.check` with the same passes it runs on a permission set's `rowLevelSecurity[]` policy, with the declaring object as the target. A default whose predicate does not lower, does not parse, overruns a parse bound, names a column the object does not declare, reads a `current_user` key nothing resolves, or (for a `select` / `all` read scope) is refused by the engine's filter admission is reported under the same id, at the same `error` severity, at `objects[N].defaultRowScope.<clause>`. `validateOrgAxisRedLines` rule ① (`org-axis-permission-inheritance`) also judges a default that reads `parent_organization_id`.
- **A new authoring-time finding on a shape that was silent.** Until now these rules walked `permissions[].rowLevelSecurity[]` only, so `os validate`, `os build` and `os lint` passed such a default. The security plugin's row-policy collection hands an object's default to the same compiler an authored policy reaches, so a predicate that does not lower is dropped at request time and the object reads as zero rows for every caller the default applies to. A stack that declares such a default now fails these commands; the fix is the same rewrite the finding prescribes for a permission-set policy. A default that lowers, and an object with no default, report nothing new.
- **How the finding reads.** `where` names the default and its object (`default row scope "NAME" of object "OBJECT"`), never a permission set. `os explain` for the RLS predicate ids now says what a dropped `using` does for both sources: a permission set's policy denies the holders of that set, and a default, applied only when the caller's sets carry no row policy for the object and operation, denies every caller it applies to.
