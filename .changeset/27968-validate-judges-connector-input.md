---
'@objectstack/lint': minor
---

fix(lint)!: `objectstack validate` judges a `connector_action` node's `connectorConfig.input` as a value slot

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered connector-action-input-value-slot-judged -->

**BREAKING** accept-set narrowing at `validateStackExpressions` (`objectstack validate`), and so at the runtime authoring gate that runs the same pass on a flow write.

- **Before.** A malformed CEL envelope, a template envelope and a `{…}` token string in `connectorConfig.input` passed clean; the same three under a `subflow`'s `config.input` were `error`s.
- **Now.** Each is an `error` at `node 'ID' (connector_action) connector_action input value at connectorConfig.input.KEY`, with the message a `subflow` input value draws. A valid envelope is also held to the value slots' other checks, the unbound-root judgment included, as every value slot is.
- **Unchanged.** Literals and valid CEL envelopes pass.

**The remedy.** Write a computed value as `{ dialect: 'cel', source: '…' }` and a constant as a literal; follow the CEL spelling each refusal names.
