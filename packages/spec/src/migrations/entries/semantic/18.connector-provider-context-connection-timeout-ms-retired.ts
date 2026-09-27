// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'connector-provider-context-connection-timeout-ms-retired',
  surface: 'ConnectorProviderContext.connectionTimeoutMs, the declared connect deadline handed '
    + 'to every ConnectorProviderFactory (integration/connector-provider.ts)',
  replacement: 'requestTimeoutMs for the deadline the platform keeps; for a connect-only bound, '
    + "the provider's own providerConfig, where the provider owns the vocabulary",
  reason:
    'ADR-0049 enforce-or-remove, maintainer ruling 2026-09-22 letter A: retire '
    + 'connector.connectionTimeoutMs. The spec key is tombstoned and its authored sources are '
    + 'rewritten by the D2 conversion connector-connection-timeout-ms-removed; this entry '
    + 'carries the half a conversion cannot reach. The key was placed on this context by the '
    + 'round that made the connector resilience policy live, explicitly as a CARRY — handed '
    + 'over so that a custom provider on a transport able to separate the phases could honour '
    + 'it. Measured before removal, none did, and the carry itself was the last thing keeping '
    + 'the key alive in argument: the built-in rest and openapi factories read '
    + 'ctx.connectionTimeoutMs only to deposit it back onto the def that GET /connectors '
    + 'echoes, and connectorFetchOptions — the one mapping from authored policy onto the '
    + "platform's outbound fetch — was never handed it. Being handed a value is not honouring "
    + 'it, so the carry is the same parsed-unmarked-unenforced state on one more surface, and '
    + 'it leaves with the key rather than outliving it as an orphan a factory could still '
    + 'read. Why a semantic entry and not a D2 conversion: a provider factory is CODE. There is '
    + 'no authored source and no sys_metadata row holding a read of ctx.connectionTimeoutMs, so '
    + 'the chain has no seam to rewrite — the removal reaches a factory author as a tsc error '
    + 'and as this entry, never as a mechanical edit. The declaration cannot be made honest by '
    + 'implementing it either: a WHATWG fetch exposes one AbortSignal over the whole operation '
    + 'and never the connect phase, so bounding time-to-response with this key would kill a '
    + 'slow-but-connected upstream the author meant to allow with a large requestTimeoutMs. '
    + 'ADR-0087, ADR-0097.',
  acceptanceCriteria:
    'No ConnectorProviderFactory reads ctx.connectionTimeoutMs; the member does not exist on '
    + 'ConnectorProviderContext and reading it fails to compile. A factory that genuinely needs '
    + 'a connect-phase bound declares it in its own providerConfig and applies it itself, on a '
    + 'transport that can observe the connect phase — it does not receive one from the host. '
    + 'Behaviour is unchanged for every shipped provider, because none applied the value: a '
    + 'connector that authored connectionTimeoutMs made exactly the same calls with exactly '
    + 'the same deadlines before and after. What does change is observable and intended: the '
    + 'def served by GET /connectors no longer echoes a connect deadline nobody keeps, and '
    + 'requestTimeoutMs — which resilientFetch applies as each attempt deadline — is the only '
    + 'timeout on the surface. The sibling members retryConfig and requestTimeoutMs '
    + 'deliberately do NOT move, and a sweep that removed either has over-applied this entry: '
    + 'both resolve to real reads at the fetch site.',
};
