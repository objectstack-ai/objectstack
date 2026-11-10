---
'@objectstack/service-automation': patch
---

fix(service-automation): a connector's failure text carries no credential part its metadata read withholds

Clause-②: no
Metadata-protocol: none

- **The rule.** A credential part the connector metadata read withholds never comes back in any other text the platform stores, serves or logs. A provider's failure text is rewritten by the connector redactor every metadata read runs (`getMetadataTypeRedactor('connector')`), the one judgement of what to withhold, where the text enters the platform.
- **Where it applies.** A provider factory's failure while an instance materializes (the instance's `degradedReason` in `GET /api/v1/automation/connectors` and the credential-reference listing, a `connector_action` refusal, a stored credential row's status reason, the degrade, hold and fail log records, a boot's failure), a handler's failure on a call (a flow run's step error, the pull door), and an upstream's refusal words on a call.
- **What a reader sees.** A stored URL appears as the metadata read serves it, its userinfo and credential query pairs removed; a URL a provider re-rendered is judged by the same read; a string the read withholds whole (a header or environment map value, an inline `auth` secret) reads `[credential withheld]`. A failure keeps its `code`, `status` and `name`.
- **Unchanged.** A text with no URL, and a URL with no credential part, read as the provider wrote them; a call's failure that holds nothing to withhold is the thrown value itself. The stored row is untouched, and the instance keeps using its stored URL.
