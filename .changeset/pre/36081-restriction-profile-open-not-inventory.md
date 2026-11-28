---
'@objectstack/spec': patch
---

docs(spec): the open self-hosted restriction profile lists the whole node vocabulary and does not state which plugins the runtime runs

Clause-②: no
Metadata-protocol: none

`RestrictionProfileSchema.allowedFlowNodeTypes` said an environment that runs the approvals plugin lists `approval` / `approval_revise` and one that does not leaves them out. The open profile a self-hosted runtime serves (`GET /api/v1/discovery/restriction-profile`) is a constant: it lists the whole vocabulary, the approval pair included, on every kernel, whether or not the approvals plugin is installed. The reader rule and the schema docs now say so: a profile that states plugin composition lists the pair only when the environment runs the plugin; the open self-hosted profile states no plugin composition, so `os validate --target <self-hosted url>` does not check that an approval flow has an executor there. The field's description in the published JSON Schema and the reference page carries the same sentence. No key, accepted value or served answer changes. Nothing to migrate.
