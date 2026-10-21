---
'@objectstack/spec': patch
'@objectstack/plugin-sharing': patch
---

fix(spec,plugin-sharing): the `DataEvent.organizationId` description and the sharing-rule Organization help stop describing organization-less rows that 18.x no longer writes

Clause-②: no (description and help text only: no response, status, outcome, boot verdict or export moves)
Metadata-protocol: none (a schema description and a field's help text; nothing a metadata author writes changes)

- **`DataEvent.organizationId` (`@objectstack/spec/api`).** The description said every event on a `single`-posture deployment carries no organization, because nothing stamps the column there. Since 18.x the engine stamps every tenant row on a single-organization deployment with its Default Organization, so those events carry it. The key is now described as absent in two cases: a row of an object outside the wall, and every row of a composition that registers no organization object. The schema itself is unchanged (`z.string().min(1).optional()`).
- **`sys_sharing_rule.organization_id` (`@objectstack/plugin-sharing`).** The Setup help said "null = global". A stored rule always carries its organization; a rule that applies to every organization is a declared rule. The help now reads "The organization this rule belongs to.", with the translated locales updated to match.
