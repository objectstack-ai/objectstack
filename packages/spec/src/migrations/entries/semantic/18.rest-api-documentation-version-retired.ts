// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20294 (family `rest-api-documentation`, rank 8 of the #18900 census) — the
// D3 entry of the family's RETIRE half, under ruling B on #20359: the eight
// identity members of `api.documentation` are enforced (they overlay the served
// OpenAPI `info` on both doors) and `documentation.version` is retired. One D3
// entry per retirement family (ruling B on #17152). Registered key:
// `api/RestApiConfig:documentation.version`. No D2 conversion: a
// `RestServerConfig` is plugin TS configuration, never a stack collection member
// or a stored row (the `rest-api-config-dead-keys-retired` precedent on this
// same block), so this entry is where the prescription reaches
// `os migrate meta`, the upgrade guide and `spec-changes.json`.
export const entry: SemanticMigration = {
  id: 'rest-api-documentation-version-retired',
  surface: 'restServer.api.documentation.version',
  replacement:
    '(removed — delete the key. The served OpenAPI document\'s `info.version` is the protocol version, '
    + 'i.e. the version of the `@objectstack/spec` package that generated the document, with no configured '
    + 'override. An app that wants to publish '
    + 'its own release number writes it into `api.documentation.description`, which the served '
    + '`info.description` now carries.)',
  reason:
    'The `rest_api` liveness census found `documentation.version` `dead`: `normalizeConfig` parsed it and '
    + 'copied it into the REST server\'s config, and no site read it back, so `version: \'2.3.0\'` never '
    + 'reached the served document. Enforce-or-remove (ADR-0049) split the `documentation` block by who '
    + 'owns each field. The title, description, terms of service, contact and license are the publisher\'s '
    + 'identity and are now enforced. `info.version` is a fact of the protocol: an earlier ruling made the '
    + 'served `info.version` equal the published artifact\'s, so an integrator can read which protocol '
    + 'version they are talking to, and it removed the serve-time override that had made the field mean the '
    + 'route identifier. A publisher-set version would give the field a third meaning, so the key is '
    + 'retired instead of enforced. `RestApiConfigSchema`\'s inline `documentation` block is a non-strict '
    + '`z.object()`, so the key is a `retiredKey()` tombstone and its ledger row stays `dead` with a REMOVED '
    + 'note. The consumer still owes the judgment because a host that WROTE `documentation.version` believed '
    + 'its integrators read that number from the document, and only that host knows whether any client was '
    + 'built on the belief and where the number should be published instead.',
  acceptanceCriteria:
    'No `RestServerConfig` value passed to the REST plugin carries `api.documentation.version` — a config '
    + 'that does now fails `RestServer` construction (and so the REST plugin\'s `start`) with the retirement '
    + 'prescription, naming the key and `RestApiConfigSchema`, instead of being accepted and ignored; `tsc` '
    + 'refuses the key at the authoring site (`never`). `GET {apiPath}/openapi.json` and its '
    + 'environment-scoped twin serve `info.version` equal to the one the bundled '
    + '`@objectstack/spec/openapi.json` carries, whatever the config says. A release number the host still '
    + 'wants published appears in the served `info.description` after it is written into '
    + '`api.documentation.description`.',
};
