---
'@objectstack/core': patch
'@objectstack/driver-memory': patch
'@objectstack/driver-mongodb': patch
'@objectstack/formula': patch
'@objectstack/metadata': patch
'@objectstack/metadata-core': patch
'@objectstack/objectql': patch
'@objectstack/platform-objects': patch
---

Refusals, log lines and field help in core, the in-memory and MongoDB drivers, formula, metadata, metadata-core, objectql and platform-objects no longer cite tracker numbers; each states the reason in words

Clause-②: no

Many messages these packages show to authors, administrators and operators ended with an issue-tracker
number where the reason belonged. The number goes, and where the sentence did not already say what was
decided, it now does. Where an ADR stood beside the number, the ADR stays.

- Refusals and prescriptions: the retired health-check keys, the `IMetadataService.register` refusals
  (the contract refuses loudly and names the mismatch, never coerces a value into storability), the
  kernel's plugin-ordering errors (registration order is not a contract), the in-memory and MongoDB
  filter and aggregation refusals, formula's empty field constraint, the retired `artifact-api`
  source, and the by-id update and delete refusals. The MongoDB retired-aggregate refusal now says the
  function left `AggregationFunction` because no SQL backend compiled it; its undeclared-aggregate
  refusal says the builder used to sum an unrecognised name before this refusal existed.
- The `findOne` no-predicate refusal loses its citation in `objectql` and in `metadata-core`'s
  `engineFindOnePredicateRefusalMessage` together, so the two still read byte for byte the same.
- The in-memory and MongoDB drivers' multi-tenancy refusals (`MEMORY_MULTI_TENANT_UNSUPPORTED`,
  `MONGODB_MULTI_TENANT_UNSUPPORTED`) no longer end with a `Tracking:` line linking a tracker card;
  the sentence above it already says the driver refuses rather than run or answer unisolated.
- Field help and protection text: the `sys_account` token help (and its es-ES, ja-JP and zh-CN
  translations), the `sys_email` headers help and the SCIM credential store's protection reason.
- Log lines: the superseded-registration warning, the authz cache posture line, the endpoint matcher's
  excluded-item error, the metadata history and loader-read failure errors, and the fresh-datastore
  attestation info lines.

Text only: no error code, field name, status or behaviour changes.
