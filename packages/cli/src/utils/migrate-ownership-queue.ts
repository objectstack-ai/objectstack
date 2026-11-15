// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D1] The ownership-queue service on a one-shot `bootSchemaStack`
 * boot, which every `os migrate` subcommand that boots the stack takes.
 *
 * The engine refuses, at `kernel:ready`, a stack that declares `queues` or
 * `assignmentRules` when no `ownership-queue` service is registered
 * (`ObjectQLPlugin`). `os serve` passes because `sharing` is on its always-on
 * slate and `SharingServicePlugin.init()` registers that service. A data
 * migration's plugin set (`buildDataMigrationPlugins`), the plain data stack
 * and a host-only composition carry no such provider, so on a queue-using app
 * every one of those subcommands refused to boot.
 *
 * ## The service, not the provider plugin
 *
 * This registers the same service `SharingServicePlugin.init()` registers —
 * an `OwnershipQueueService` (`@objectstack/plugin-sharing`), under
 * `OWNERSHIP_QUEUE_SERVICE`, reaching the engine at use — and nothing else.
 * Composing the whole provider, even for its declarations only, also
 * registers the sharing objects (`sys_record_share`, `sys_queue`, …): every
 * one-shot boot would then examine more tables than the data stack it pins,
 * and an `--apply` boot would create any that are missing — DDL the operator
 * never saw in the preview. Nothing of the sharing runtime is armed: no read
 * filter, no rule or share write hook, no queue guard, no boot backfill.
 *
 * What the service answers here: a DECLARED queue resolves as it does under
 * `os serve`. The authored rows it also reads (`sys_queue`,
 * `sys_queue_member`) are not registered objects on this boot, so those reads
 * fail and the service says so once (`[queue] … read failed`) and answers
 * from the declarations alone. Only the engine's assignment step reaches it,
 * on an INSERT into an object with assignment rules; an update never
 * evaluates a rule, so a backfill that rewrites existing rows
 * (`summary-nulls`) routes nothing.
 *
 * `null` when the composition already holds the provider (judged by
 * `providesCapability`'s exact identity match on the `sharing` row of
 * `CAPABILITY_PROVIDERS`, on the plugin list, before the boot starts): `plan`
 * / `apply`'s served-platform composition and a host config that brings its
 * own register the service themselves, and the kernel refuses a second
 * registration under the same name.
 */
export async function composeOwnershipQueueProvider(composed: readonly unknown[]): Promise<object | null> {
  const { CAPABILITY_PROVIDERS, providesCapability } = await import('@objectstack/core');
  const spec = CAPABILITY_PROVIDERS.sharing;
  if (!spec) {
    throw new Error(
      "No 'sharing' capability provider is declared in CAPABILITY_PROVIDERS (@objectstack/core), so this boot " +
        "cannot tell whether it composes the 'ownership-queue' service a stack declaring queues or assignmentRules needs.",
    );
  }
  if (providesCapability(composed, spec.identities)) return null;
  const { OwnershipQueueService, OWNERSHIP_QUEUE_SERVICE } = await import('@objectstack/plugin-sharing');
  return {
    name: 'com.objectstack.cli.migration-ownership-queue',
    version: '1.0.0',
    type: 'standard',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: {
      getService<T>(name: string): T;
      registerService(name: string, service: unknown): void;
      logger?: unknown;
    }): Promise<void> {
      // The construction `SharingServicePlugin.init()` performs: the engine is
      // resolved at use, never here.
      ctx.registerService(OWNERSHIP_QUEUE_SERVICE, new OwnershipQueueService({
        engine: () => {
          try { return ctx.getService('objectql'); } catch { return null; }
        },
        logger: ctx.logger as any,
      }));
    },
  };
}
