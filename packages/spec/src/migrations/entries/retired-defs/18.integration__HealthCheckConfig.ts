// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/HealthCheckConfig` (`enabled`, `intervalMs`, `timeoutMs`,
// `endpoint`, `method`, `expectedStatus`, `unhealthyThreshold`,
// `healthyThreshold`) leaves with `integration/ConnectorHealth`, whose
// `healthCheck` was its only carrier. No loop ever polled a connector endpoint:
// the only `healthCheck` code outside `packages/spec` is the kernel's PLUGIN
// health contract — a different shape on a different subject. Its four
// `.default()`s were only ever materialized INSIDE an authored block, so there
// is no residue window on the carrier. See
// `retired-keys/18.integration__Connector__health.ts` for the retirement record.
export const entry = 'integration/HealthCheckConfig';
