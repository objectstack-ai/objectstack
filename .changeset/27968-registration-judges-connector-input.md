---
'@objectstack/service-automation': minor
---

fix(service-automation)!: `registerFlow` refuses a malformed envelope and a `{…}` token in a `connector_action` node's `connectorConfig.input`

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered connector-action-input-value-slot-judged -->

**BREAKING** accept-set narrowing at `AutomationEngine.registerFlow`.

- **Before.** The executor evaluates `connectorConfig.input` as a value-slot map, but registration judged value slots through a ledger that could address `config` only. A malformed CEL envelope (`{ dialect: 'cel', source: 'rec.' }`), a template envelope (`{ dialect: 'template', … }`) and a `{…}` token string (`'{rec.id}'`) all registered there, while the same three under a `subflow`'s `config.input` were refused. The malformed envelope failed the step at run time; the token string was handed to the action as its literal text.
- **Now.** The value-envelope and value-slot template checks read the ledger's `connectorConfig` entry, so all three are refused at registration, each located at `connectorConfig.input.<key>` with the same refusal a `subflow` input value draws. A flow row in `sys_metadata` carrying one is skipped at boot with a `warn` naming it, its trigger not armed.
- **Unchanged.** Literals and valid CEL envelopes register and dispatch as before; an envelope nested inside a literal is data; `input` stays optional.

**The remedy.** Write a computed value as `{ dialect: 'cel', source: '…' }` and a constant as a literal; follow the CEL spelling each refusal names.
