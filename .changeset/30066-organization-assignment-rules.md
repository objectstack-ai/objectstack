---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/plugin-sharing': minor
'@objectstack/cli': minor
---

feat(objectql,plugin-sharing): an organization authors its own assignment rules in Setup, as `sys_assignment_rule` records

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — content/docs/automation/queues-and-assignment-rules.mdx, skills/objectstack-automation/SKILL.md

Until now only a package could declare an assignment rule, so routing new records differently meant a package release. An organization can now write its own rules in Setup (Access Control → Assignment Rules), on the same two-source model sharing rules and queues already follow: the rules packages declare keep working, and the organization's own rules sit beside them.

- **`@objectstack/plugin-sharing`**: a new object, `sys_assignment_rule`. One row is one rule: when a new record of the chosen object matches the condition (a CEL expression over `record`, empty for every record), it goes to a queue or to one person, and a queue target may pick a member by `round_robin` or `least_loaded` (which needs its open-work expression, `load`). Each row belongs to one organization (`organization_id` is required). The table's save guard refuses, naming each field at fault: a name that is not snake_case or that a package rule already holds (one name means one rule); an object that does not exist or whose records have no owner; an entry shape the stack schema refuses for a declared rule; a condition or open-work expression the engine cannot compile; a person who is not an active member of the organization; a rule that would land in no organization. A boot report logs, at `error`, an organization's rule whose name a later-installed package now declares. Setup gains an "Assignment Rules" entry beside Queues.
- **`@objectstack/objectql`**: the engine evaluates an object's organization rules first, ascending by `sort_order` and then by name, and the rules packages declare as the fallback; the first match decides. A user target, from either source, now owns the record only while the user is an active member of the record's organization and is not banned. One that no longer resolves leaves the record ownerless, the way a queue that no longer resolves does, and is logged once; the insert is never refused. When an organization's rules cannot be read, its new records are written as they stood rather than routed by the package rules its own would have overtaken. New exports for the save guard: `ASSIGNMENT_RULE_OBJECT`, `assignmentExpressionRefusals`, `organizationMemberStanding`.
- **`@objectstack/spec`**: `PLATFORM_PROVIDED_OBJECT_NAMES` lists `sys_assignment_rule` under `plugin-sharing`, and the `AssignmentRuleSchema` documentation says how the two sources combine. No key, shape or validation changes.
- **`@objectstack/cli`**: the organization-ownership inventory lists `sys_assignment_rule`, so `os migrate organization-ownership` plans it instead of refusing it as an uninventoried platform table.

Upgrading: a package rule whose entry names a user id (the `assignment-rule-user-target` lint warning) stops assigning in an organization where that user is not a member; the engine logs the lapse once per rule, user and organization. Route such a rule to a queue whose members are positions.
