---
'@objectstack/skills': patch
---

docs(skills): `objectstack-ai` names the `os validate` rules for a `knowledge_source`

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai` § Knowledge Sources (RAG) now lists what `os validate` and publish report for a knowledge source, by rule id, with the fix for each. `knowledge-source-object-unknown`: `source.object` is no object of the stack or its packages; on the CLI it is a warning while the manifest declares a dependency that `packages[]` does not carry. `knowledge-source-field-unknown`: a `content` or `metadataFields` member is no field of the object (`id` and the injected system columns resolve). `knowledge-source-object-not-searchable`: the API does not serve the object for `search`. `knowledge-source-system-object-not-ai-readable`: a `sys_` object without `enable.aiReadable: true`. `knowledge-source-field-never-indexed` is a warning for a credential-class or `internal: true` member, which the index never carries. An error refuses the publish. The section's example passes `os validate` with no knowledge-source finding.
