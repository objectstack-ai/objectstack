---
'@objectstack/service-automation': minor
'@objectstack/spec': minor
---

fix(service-automation): a `runAs: 'user'` flow now carries its user's email, so a row policy on `current_user.email` admits the run on the rows it admits for the same user's own request

Clause-②: yes (widening)

A `runAs: 'user'` flow's data nodes ran without the acting user's email, which the request path resolves for every user. The row-level security compiler reads `current_user.email` from the execution context's `email` and nothing else, so every owner policy keyed on it (such as `assignee == current_user.email`) dropped out inside the run. A record-change flow triggered by a member whose only access to a row is such a policy was refused on the row the member had just written, and could read and update with their own request.

Run setup now seeds the email through the resolver the request path uses (`resolveUserAuthzGrants` from `@objectstack/core`, the user's stored `sys_user` email), and every data node passes it on:

- It is seeded for every trigger shape that names a user and carries no email: the record-change shape (`userId` and `tenantId` only) and the REST and action doors' shape (positions and permission sets already resolved). Only the missing facts are taken from the resolver; forwarded positions and permission sets stay exactly as they were.
- A context that already carries an email keeps it verbatim, as a request's session email wins over the stored one. A `subflow` or `map` child and a suspended run keep the email their run was seeded with.
- After an approval decision, the nodes that run as the decider carry the decider's own email, resolved for them. The submitter's email is removed with the rest of the submitter's grants, on both `runAs` postures.
- A user with no stored email, or a resolver failure, leaves the run without one: policies that read it drop out, and the run sees less, never more. The `[runAs]` warning on a resolver failure now names the email beside the peer list.
- A run suspended before this release resumes without the email until it ends.

A `runAs: 'system'` flow is unchanged. The flow CEL scope's `current_user` is unchanged too: it still binds no email.

Published types: `AutomationContext` (`@objectstack/spec/contracts`) gains an optional `email` member, and `RunIdentityContext` / `RunDataContext` and `FlowUserGrants` (`@objectstack/service-automation`) each gain an optional `email` member.
