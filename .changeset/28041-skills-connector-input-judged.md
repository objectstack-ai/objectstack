---
'@objectstack/skills': patch
---

docs(skills): the automation guide says a `connector_action` input is judged against the action's `inputSchema` before dispatch

Clause-②: no
Metadata-protocol: none

This text shipped in PR #28170 (#28041 / #28162), which missed its `@objectstack/skills` changeset; this entry carries it.

- **`objectstack-automation/SKILL.md`**: once evaluated, a `connector_action`'s `connectorConfig.input` is judged against the action's `inputSchema` (`required`, `type`, `properties`, `items`) before dispatch, and a breach fails the step `VALIDATION_ERROR` (`fault`-routable) with nothing sent. `registerFlow` and `os validate` refuse a `{…}` template token at `connectorConfig.input.<key>`.
- **`objectstack-automation/references/integration-recipes.md`**: a record value reaches the payload through a CEL envelope (`{ dialect: 'cel', source: 'record.<field>' }`), and the recipes say that envelope is judged against the `inputSchema`.
