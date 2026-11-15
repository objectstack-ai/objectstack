---
"@object-ui/app-shell": patch
"@object-ui/i18n": patch
---

Clause-②: no
Metadata-protocol: none

The flow run note has a plain-words line for the engine's new unbound cause `retried_callout_in_subflow`: the flow runs after a record is saved and a subflow it calls retries a call to an outside service, so it does not start until that subflow sends the request in the background or drops the retry (English and Chinese).
