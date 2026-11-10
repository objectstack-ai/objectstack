---
'@objectstack/service-datasource': patch
'@objectstack/rest': patch
---

fix(service-datasource, rest): every datasource refusal names its reason in `details.reason` and answers a one-line `message`, with the rationale moved to `details.hint`

Clause-②: yes (widening)
Metadata-protocol: none

Part of #32169. A refusal of the datasource admin doors (`/api/v1/datasources/**`) answered `400 DATASOURCE_ADMIN_ERROR` with the reason buried in a `message` of up to 1,300 characters: the rule, its history and the remedy in one string, which a toast cannot show and a client cannot branch on. The external-datasource (federation) refusals had the same shape under `EXTERNAL_DATASOURCE_ERROR`.

Now each refusal carries three parts:

- `message`: one line, at most 160 characters, naming what was refused (the datasource and the key).
- `details.reason`: a snake_case discriminator, one per condition (`invalid_name`, `reserved_name`, `already_exists`, `code_defined`, `driver_required`, `invalid_config`, `invalid_record`, `undeclared_key`, `empty_secret`, `credentials_ref_on_create`, `inline_ssl_key`, `pool_unsupported`, `external_binding_conflict`, `connector_not_lendable`, `objects_bound`; and for the federation doors `primary_not_federated`, `not_federation_source`, `schema_filter_unattributed`, `table_required`).
- `details.hint`: the rationale and the remedy the message used to carry, when there is more to say than the line does. Facts the reason is about ride beside it (`keys` for `undeclared_key`, `objects` for `external_binding_conflict`, `connector` for `connector_not_lendable`).

The error code and the HTTP status of every refusal are unchanged: a reason is a member of `details`, never a new code (ADR-0112). The connection test's `{ ok: false, error }` answer keeps the whole account (line, then hint) in its one string.

`@objectstack/rest`'s federation twins (`/api/v1/external-datasources/**`) now relay the `details` of a refusal that declared its own `400` under the door's code, the same three conditions the admin routes' relay already required; any other error keeps answering its bare sentence.

A client that matched on the old long `message` text should branch on `details.reason` instead, and show `details.hint` where it wants the rationale.
