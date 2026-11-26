---
'@objectstack/spec': patch
'@objectstack/service-record-context': patch
---

Clause-②: no
Metadata-protocol: none

Documentation text only. The `aiContexts` description on the stack, the `@objectstack/service-record-context` README and the `RecordContextServicePlugin` docblock now name both ways a host mounts the record-context service that serves `get_record_context`: the stack declares `requires: ['record-context']`, which the CLI expands to the plugin, or a host that composes its own kernel lists `RecordContextServicePlugin` in `plugins`. Before, the stack description read the token as the only serving condition, and the README and docblock taught only the `plugins` mount. No schema, key or runtime behaviour changes.
