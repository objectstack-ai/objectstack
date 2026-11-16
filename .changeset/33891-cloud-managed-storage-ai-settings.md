---
'@objectstack/service-settings': patch
'@objectstack/platform-objects': patch
---

fix(settings)!: a cloud-managed environment does not offer its file storage or AI provider settings

Clause-②: no (narrowing) — narrowed, in a cloud-managed process (`OS_CLOUD_MANAGED=1`) only: `GET /api/settings` no longer lists `storage`, and serves `ai` without its provider, per-provider model and credential, generation-default (`temperature`, `max_tokens`, `request_timeout_ms`) and embedder keys; `GET` / `PUT /api/settings/storage` and `POST /api/settings/storage/:actionId` answer `409 RESOURCE_CONFLICT` with `details.managedBy: 'platform'`; `GET /api/settings/ai` serves the conversation-title and observability keys only; a `PUT /api/settings/ai` that names a hidden key answers the same 409 and writes nothing; `POST /api/settings/ai/test`, `ai/test_embedder` and `ai/reset` answer the same 409; the data API's reads of `sys_setting`, `sys_platform_setting` and their audit objects leave out every `storage` row and every row of a hidden `ai` key for a caller that is not the system; the Setup entry `nav_settings_storage` carries `visible: 'features.cloudManaged != true'`. A self-hosted deployment answers exactly as before.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the hosted settings doors or the storage / AI settings pages.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: the change is which settings a cloud-managed runtime's doors serve. Stored rows are untouched and the settings registry stays whole, so there is nothing for a migration to rewrite. -->

**BREAKING** for a caller of a cloud-managed environment: its file storage and its AI provider are provided and configured by the hosting platform, so the settings doors no longer show or change them. The registry stays whole: the storage and AI services, which read these settings in process, keep reading every value. The refusal is `409 RESOURCE_CONFLICT`, as at every other cloud-managed door, with `details.managedBy: 'platform'` so a console can tell it apart from `404 UNKNOWN_NAMESPACE`.

What to do: nothing on a self-hosted deployment. A client of a hosted environment that read or wrote `storage.*`, or the hidden `ai.*` keys, stops doing so: those values are the hosting platform's.
