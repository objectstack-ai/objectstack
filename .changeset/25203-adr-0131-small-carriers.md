---
'@objectstack/plugin-sharing': patch
'@objectstack/plugin-security': patch
'@objectstack/cli': patch
'@objectstack/spec': patch
---

fix(plugin-sharing): the declared-rule organization walk ends on the rows read, and a row with no readable id answers unknown; texts that still described the retired NULL-organization reading are corrected

Clause-②: no
Metadata-protocol: none

- **`@objectstack/plugin-sharing`.** The boot's organization walk for declared sharing-rule scopes (`resolveDeclaredRuleScopes`) judged "short page, stop" on the ids it kept, so a full page of `sys_organization` holding one row with no readable `id` ended the walk early and served a partial list, and the boot sweep then revoked the declared-rule grants of every organization past it. The walk now ends on the number of rows READ, and such a row makes the answer unknown: declared rules are served in no organization until the next boot and no declared rule's grant is revoked, with a warning that names the cause. Under the shipped schema every organization row has a text id, so no install is expected to see the new warning.
- **`@objectstack/plugin-security`.** The Organization help on `sys_user_position` and `sys_user_permission_set` no longer says an empty value means "global" or "applies in every org context". A grant or assignment applies only in its own organization, and one with no organization applies nowhere. The four locale bundles carry the new text.
- **`@objectstack/cli`.** `os migrate organization-ownership`'s warning about rows whose owner cannot be derived reads "…while one stays NULL, except on a table whose column is not the tenancy anchor." where it read "(but on a table …)".
- **`@objectstack/spec`.** Wording only, no schema moves: the upgrade guide's `driver-read-scope-follows-tenant-wall` entry names update and delete "by id or by predicate"; the `sharing-rule-declared-mirror-retired` entry no longer paraphrases ADR-0131 D13 as asking an entry of every retirement; `IEmailService`'s `organizationId` TSDoc no longer says an absent value leaves the row unstamped (the engine stamps the derivable organization or refuses the insert); a TSDoc citation in `schedule-organization.zod.ts` names the run store instead of a deleted file.
