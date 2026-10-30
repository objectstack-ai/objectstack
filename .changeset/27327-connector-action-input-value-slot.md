---
'@objectstack/service-automation': minor
---

fix(service-automation): a `connector_action` node evaluates a CEL envelope in `connectorConfig.input`, so a flow can send a per-record value to a connector's action

Clause-②: no
Metadata-protocol: semantic

`connectorConfig.input` is now a value-slot map, resolved by the same per-key resolver as a `subflow` or `map` `input`, a `script`'s `inputs`, a `screen`'s `defaults` and a `notify` node's `templateData`:

- **An envelope is evaluated.** A top-level value written as `{ dialect: 'cel', source: '…' }` is evaluated in the run's scope, and the action's handler receives the value it computes, its type kept (a string, a number, a list, a record). Before, the handler received the envelope object itself, so a declarative connector that put the value into a request path sent `[object Object]` and the run reported success.
- **A constant payload is unchanged.** Every other value, an envelope-shaped object nested inside a literal included, reaches the handler as written. The handler now receives a copy, so a handler that writes into its input no longer writes into the stored flow.
- **A fault fails the step.** An envelope that faults on the live variables (an absent key, a type error) fails the node with the slot (`input.<key>`) and its source, and the handler is not called, so nothing is sent upstream.

To keep a value an author meant as a literal envelope-shaped object, nest it inside another literal; only a top-level value of the map is evaluated.
