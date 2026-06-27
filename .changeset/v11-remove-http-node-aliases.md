---
"@objectstack/spec": major
"@objectstack/service-automation": major
---

Remove the deprecated `http_request` / `http_call` / `webhook` flow-node aliases — author `http` (ADR-0018 M3).

ADR-0018 M3 collapsed the divergent outbound-callout verbs onto the canonical
`http` node and kept the old names as deprecated aliases for back-compat. This
removes those aliases (the 11.0 cleanup):

- `http_request` is dropped from `FlowNodeAction` (and therefore
  `FLOW_BUILTIN_NODE_TYPES`); authoring it now fails fast at parse instead of
  resolving to `http`.
- `AutomationEngine` no longer registers the `http_request` / `http_call` /
  `webhook` node aliases; only `http` is registered.
- The flow-builder palette offers `http`.

**Breaking.** Flows / workflow rules / approval actions that still use the old
node type must switch to `type: 'http'` (behavior is identical — durable outbox
when `config.durable`, inline fetch otherwise). The trigger `eventType: 'webhook'`
and the `webhook` resume event are unaffected — only the HTTP *node* aliases are
removed. First-party examples (showcase, app-crm) are migrated.
