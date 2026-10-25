---
'@objectstack/spec': patch
---

fix(spec): the shipped liveness ledger cites the automation seam modules that now hold the moved engine bodies

Clause-②: no
Metadata-protocol: none

Seven rows in `liveness/connector.json`, `liveness/flow.json` and `liveness/translation.json` cited `AutomationEngine` methods in `service-automation/src/engine.ts` whose bodies now live in the service's seam modules, leaving one-hop wrappers behind. They now cite the body that holds the quoted code: `plugin-extension-api.ts#registerConnector`, `dag-traversal.ts#executeWithoutRetry`, `run-resume.ts#resumeInternal`, `plugin-extension-api.ts#deriveTriggerBinding` with the shared `flow-trigger-kind.ts#resolveFlowTriggerKind` (which is where `flow.type` is read now), and `node-text-rendering.ts#translatedFlowTemplate` / `#renderRefusalMessage`. The `translation` `flows.screens` row cites `i18n-resolver.ts#flowScreenCopyKey`, the file that spells its address, because the generic renderer it hands each slot to never names the key. That row is what turned `check:liveness` red.

What to do: nothing. No status, key or verdict changes; every row keeps its classification. Only the evidence pointers and the prose around them change.
