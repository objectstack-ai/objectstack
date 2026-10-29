---
'@objectstack/connector-openapi': minor
---

feat(connector-openapi): a declarative `openapi` instance takes `providerConfig.include`, an operation allowlist

Clause-②: yes (widening)
Metadata-protocol: added

A `provider: 'openapi'` connector instance can now list the operations it exposes: `providerConfig.include: string[]`. Only the listed operations become actions, so a large API (hundreds or thousands of operations) comes up as the handful of actions its flows call, without trimming the document by hand. The key has the same allowlist meaning as the `mcp` provider's `include`.

- **An entry is an action key.** Write an operation's `operationId`, or, for an operation the document gives no `operationId`, its generated `method_path` key (`delete /customers/{id}` is `delete_customers_id`). An operation that has an `operationId` is named only by it. These are the same keys the actions are exposed under, so the `actionId` in a flow and the entry in `include` are spelled the same way.
- **An unknown entry fails the boot.** An entry the document does not carry (a typo, or an operation the upstream renamed or removed) is a configuration fault at materialization: boot fails, or the entry is skipped on reload, with an error naming the entry and listing the document's keys. It is never ignored.
- **The shape is checked before the document loads.** An `include` that is not an array of non-empty strings is refused the same way, so a malformed allowlist never exposes the whole document.
- An instance without `include` is unchanged: every operation is an action.
