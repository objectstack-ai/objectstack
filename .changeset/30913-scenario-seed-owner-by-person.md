---
'@objectstack/scenarios': patch
---

fix(scenarios): the scenario runner's seed owns a row only by a person the row names, and loads each persona's person row with its user

Clause-②: yes (widening) — `./runner` gains two exports, `personaRecords` (the record binding: each persona's `record` row, `object/id` → persona) and `rowOwner` (the persona a seed row is owned by). `personaHandles` keeps its signature and is now the handle map only: it holds a value from a direct scope rule on a declared user-handle field (`account.owner` = `u_sam`), no longer a row id or option value from any other direct scope rule (`e06`, `public`); on the three control cards its answer is unchanged. `seedApp` sets `owner_id` by the new rule and writes the persona's user id into its record row's `user` field.
Metadata-protocol: none

The seed used to set a row's owner (`owner_id`) from any direct scope value that matched a persona's: an option (`ticket_comment.visibility = public` gave all 237 public comments on `service_desk` to the portal customer, 197 of them on other customers' tickets) or a lookup to a row that is no person (`ticket.group`, `employee.department`), and the last key read won a row two personas matched.

- **Owner rule.** A row is owned by a persona's user only when it IS that persona's `record`, when a declared direct lookup on it (`expect.lookups`) holds that record's id (`ticket.assignee = a02`), or when a declared user-handle field on it holds the persona's handle (the control cards' route, unchanged). The first persona in `run.personas` order the row names owns it. Every other row keeps the inserter, the admin.
- **Person binding.** Each persona's `record` row is loaded with that persona's user id in its `user` field (`PERSON_USER_FIELD`). Without persona accounts (the gallery's screenshot boot) no `user` field and no record-bound owner is set.
- **Build prompt.** The Row ownership section names the person rows, asks for an optional `user`-type field named `user` on each person object, lists the lookups that name a person, states the persona order for a row naming two, and adds a platform-boundary line: the open-source server has no hierarchy resolver, so a person who must see rows another person owns gets them through what the build models.

On `service_desk` the portal customer now owns no comment (was 237), the 5 tickets that name both the support agent and the portal customer go to the support agent, the team lead owns no ticket through `group` (was 78), and `cus_03`, `a02`, `a04` are their personas' rows.
