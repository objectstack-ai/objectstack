---
'@objectstack/service-analytics': patch
---

feat(service-analytics): `AnalyticsServicePluginOptions.narrowObjectReadAdmission` — a public way for a host to narrow the analytics gate's object-level read admission

Clause-②: yes (widening)
Metadata-protocol: none

- **New option.** `narrowObjectReadAdmission(objectName, context)` is composed over the provider the plugin wires: the host's own `admitObjectRead` when supplied, otherwise the `security` service bridge. It is asked only for an object that provider admits, and the read is admitted only when it answers exactly `true`. So a host can refuse, per actor scope, a read the security service admits, and can never admit a read the security service refuses.
- **Refusals are the gate's existing ones.** `false`, or any answer that is not `true`, refuses with `PERMISSION_DENIED` / 403. A throw refuses, fail-closed, with `SERVICE_UNAVAILABLE` / 503. Both are refused before anything is read.
- **Unchanged.** Without the option the plugin wires its provider exactly as before. A host that today wraps the service's private read-admission provider by name can move to this option and drop the wrapper.
