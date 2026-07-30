---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
---

feat(spec,automation): graduate the seven flow-node config key aliases into the conversion layer — the `readAliasedConfig` shim retires with them (#3796)

`FlowNodeSchema.config` is an unconstrained record, so the executors were the
only statement of which config key is canonical — and seven deprecated aliases
lived there as tolerance the spec never declared: one behind the
`readAliasedConfig` deprecation shim (warned, ledgered), six as open-coded
`??` fallbacks (no warning, no ledger, no retirement path). All seven now
graduate into the ADR-0087 D2 conversion layer as protocol-17 **live-window**
entries: a stored flow authored with an alias is rewritten to the canonical
key at load — `defineStack` / `validate` / `lint` and the
`AutomationEngine.registerFlow` rehydration seam alike — with a structured
`ConversionNotice` per rewrite, and the executors read the canonical keys
only. The shim (`service-automation/src/builtin/config-aliases.ts`) is empty
and deleted.

FROM → TO (per node type; conversion entry in parentheses):

- `get_record`/`create_record`/`update_record`/`delete_record`:
  `config.object` → `config.objectName` (`flow-node-crud-object-alias`)
- `notify`: `config.to` → `config.recipients`, `config.subject` →
  `config.title`, `config.body` → `config.message`, `config.url` →
  `config.actionUrl` (`flow-node-notify-config-aliases`)
- `script`: `config.functionName` → `config.function`, `config.input` →
  `config.inputs` (`flow-node-script-config-aliases`)

One-line fix: rename the key in your flow source — values are unchanged; `os
migrate meta --from 16` rewrites all seven mechanically. Until then nothing
breaks: the protocol-17 loader accepts and converts the old shape (window
retires in 18).

`actionUrl` (not `url`) is the deliberate canonical of its pair, resolving a
contradiction where the notify descriptor documented `url` as canonical while
the executor, tests, and examples preferred `actionUrl`: the whole downstream
chain already uses that name (`sys_notification.action_url`, the
channel-dispatch contract, the REST notification read model), and `url`
elsewhere in the platform means "HTTP endpoint to call" (`http` node,
webhooks) — a different concept from this in-app click-through target. The
executor precedence already put `actionUrl` first, so the choice is
behaviour-preserving; the `notify` descriptor's `configSchema` now documents
`actionUrl`.

Callers that hand a node config **directly** to an executor (bypassing
`registerFlow`) no longer get alias resolution — build the config with the
canonical keys.
