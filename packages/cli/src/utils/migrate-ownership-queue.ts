// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { composeProviderForDeclarations } from './schema-migration-plugins.js';

/**
 * [ADR-0142 D1] The ownership-queue service on a one-shot `bootSchemaStack`
 * boot, which every `os migrate` subcommand that boots the stack takes.
 *
 * The engine refuses a stack that declares `queues` or `assignmentRules` when
 * no `ownership-queue` service is registered (`ObjectQLPlugin`, at
 * `kernel:ready`). `os serve` passes because `sharing` is on its always-on
 * slate, so `SharingServicePlugin` registers that service in its `init()`. A
 * data migration's plugin set (`buildDataMigrationPlugins`) and a host-only
 * composition carry no such provider, so on a queue-using app every one of
 * those subcommands refused to boot.
 *
 * The provider is the one `os serve` mounts — the `sharing` row of
 * `CAPABILITY_PROVIDERS`, the same rule `os migrate plan` / `apply` compose it
 * by — composed for its declarations only
 * ({@link composeProviderForDeclarations}): `init()` runs, which registers
 * the ownership-queue service and the sharing objects (`sys_queue`,
 * `sys_queue_member`, …) the service reads; `start()` and every lifecycle hook
 * do not. Nothing of the sharing runtime is armed: no read filter, no
 * sharing-rule or record-share write hooks, no queue guards, and none of the
 * boot backfills (rule grants, primary business unit) that write rows. A
 * migration process must not become a second server.
 *
 * What stays live is the engine's own assignment step, which reads the service
 * at use: an INSERT the migration makes into an object with assignment rules
 * is routed as `os serve` would route it. An update never evaluates a rule.
 *
 * `null` when the composition already holds the provider (judged by
 * `providesCapability`'s exact identity match, on the plugin list, before the
 * boot starts). The kernel keeps the LAST plugin of a name, so a second one
 * here would displace the instance `plan` / `apply` compose, or the one a host
 * config brings with its own options.
 */
export async function composeOwnershipQueueProvider(composed: readonly unknown[]): Promise<object | null> {
  const { CAPABILITY_PROVIDERS, providesCapability } = await import('@objectstack/core');
  const spec = CAPABILITY_PROVIDERS.sharing;
  if (!spec) {
    throw new Error(
      "No 'sharing' capability provider is declared in CAPABILITY_PROVIDERS (@objectstack/core), so this boot " +
        "cannot compose the 'ownership-queue' service a stack declaring queues or assignmentRules needs.",
    );
  }
  if (providesCapability(composed, spec.identities)) return null;
  const { SharingServicePlugin } = await import('@objectstack/plugin-sharing');
  return composeProviderForDeclarations(new SharingServicePlugin());
}
