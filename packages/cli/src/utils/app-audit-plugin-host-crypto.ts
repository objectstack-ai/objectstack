// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AuditPlugin } from '@objectstack/plugin-audit';
import type { ICryptoProvider } from '@objectstack/spec/contracts';

/**
 * [ADR-0154 D2, D6; seat ruling 6884540128 item 3] Hand `os serve`'s one
 * crypto provider to an AuditPlugin the app put in its stack `plugins`.
 *
 * The app's entry supersedes the instance the CLI composes (the declared
 * last-one-wins registration), and an app composing its own instance for
 * `readAudit` rarely spells a crypto provider, so without this its sealer
 * seals nothing. The hand-over matches the capability resolver's
 * `requires: ['audit']` path: the same provider, and no sealer on a one-shot
 * boot (`armSealer: false`).
 *
 * Only an instance of the real class (`RealAuditPlugin`, as this host loads
 * it) is handed anything — never a plugin that merely carries its name — and
 * only one the app composed with no provider of its own (the class's
 * `adoptHostCryptoProvider` decides that). Nothing here throws or refuses the
 * boot: an instance left without a provider reports that once, at `error`,
 * from its sealer (ADR-0154 D3). Resolves whether the provider was handed.
 */
export function handHostCryptoToAppAuditPlugin(
  plugin: unknown,
  RealAuditPlugin: typeof AuditPlugin | undefined,
  provider: () => ICryptoProvider | undefined,
  armSealer: boolean,
): boolean {
  if (RealAuditPlugin === undefined || !(plugin instanceof RealAuditPlugin)) return false;
  return plugin.adoptHostCryptoProvider(provider, { armSealer });
}
