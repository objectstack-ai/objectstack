---
'@objectstack/metadata-protocol': patch
---

Clause-②: yes — widening: the draft verdict gains an advisory for a draft flow whose `connector_action` names a connector or action the runtime cannot dispatch; advisory only, never a refusal (the probe "never fails the publish"), so no save or publish accepted today is refused. Seat runs a contract read before ready.
Metadata-protocol: none

fix(metadata-protocol): a flow draft's verdict says when a connector step cannot dispatch

The publish's build probe `flow_connector_action_unresolved` warns, after a flow is published, that a `connector_action` step names a connector or action this environment cannot dispatch, so every run that reaches the step fails. The draft verdict (`draftPublishJudgement`, read by Studio's draft review and by the MCP draft tools' `verdict.advisories`) now says the same thing before Publish is pressed: one advisory per such step, rule `flow_connector_action_unresolved`, `severity: 'warning'`, located at the step (`flows[0].nodes[N].connectorConfig`, which the draft read serves as `nodes.N.connectorConfig`), with the probe's own `message`, its `fix` as the `hint`, and its user sentence in the read's language.

It is never a refusal: a draft with such a step still saves, reads valid, and publishes, as before. The publish gate's own answer is unchanged, and the build probe reports exactly what it reported before; both doors now ask one shared lookup (`unresolvedConnectorSteps`). A host without an automation service, or one without the connector lookups, judges nothing, as the probe does.
