// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 10] The `everyone` anchor's declarations of `SecurityPlugin`,
 * moved out of `security-plugin.ts`:
 *
 * - `declareEveryone`, the anchor's definition as a started kernel derives
 *   it: the deployment's baseline plus every package default a
 *   `manage_metadata` holder accepted, each withheld acceptance reported with
 *   its reason, and the grants caches retired on the metadata epoch.
 * - `declareBuiltinPositions`, the six built-in positions declared to the
 *   engine registry from `init()`, with `everyone` naming the fail-closed
 *   baseline.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same reads in the same order, the same
 * registry writes, the same warnings and errors.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 to 9 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps both private methods — the
 * published `dist/*.d.ts` lists each one's name, docblock and position — and
 * each body is one literal of exactly the {@link EveryoneAnchorHost} members
 * that method reads, plus a `.call`. A method is handed over as a closure that
 * calls it on the plugin at call time, so a test double or spy set on the
 * plugin is still the one the body reaches: both declarations still ask the
 * plugin's baseline, and the derivation its deployment acceptance, and
 * every caller still reaches both methods through the plugin.
 * `declareEveryone` was async and its function still is, and the method now
 * returns its function's promise; `declareBuiltinPositions` was synchronous
 * and so are its method and function.
 *
 * Each field was classified on its own declaration, by the rule cut 1 set.
 * `epoch`, `metadata` and `ql` are not declared `readonly` (`start()` assigns
 * all three after construction), so they go as GETTERS, and each read
 * happens when the body makes it.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * `everyoneBaseline`, the one pure derivation both declarations share, stays
 * in the class whole, because its body is no longer than its stub would be;
 * the bodies reach it through the host. The baseline registration and the
 * position registration are imported from `builtin-positions.js`, the
 * declared-capability context from `declared-capability-context.js`, the
 * accepted package defaults from `suggested-audience-bindings.js`, and the
 * plugin's package id from `manifest.js`, as `security-plugin.ts` imported
 * them; no body that stays there reads the first four, so that file no longer
 * imports them.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */
import type { PluginContext } from '@objectstack/core';
import type { SecurityPlugin } from './security-plugin.js';
import { declareEveryoneBaseline, registerBuiltinPositions } from './builtin-positions.js';
import { readDeclaredCapabilityContext } from './declared-capability-context.js';
import { SECURITY_PLUGIN_ID } from './manifest.js';
import { readAcceptedEveryoneSets } from './suggested-audience-bindings.js';

/**
 * The `SecurityPlugin` members the functions below read — every one of them,
 * and no other; each function's `this` is the `Pick` of the members IT reads.
 * Each is typed AS the class member (an indexed access on the class), so a
 * change to a member's signature on the class is a change here too, and naming
 * a member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface EveryoneAnchorHost {
  readonly epoch: SecurityPlugin['epoch'];
  readonly metadata: SecurityPlugin['metadata'];
  readonly ql: SecurityPlugin['ql'];
  deploymentAcceptance: SecurityPlugin['deploymentAcceptance'];
  everyoneBaseline: SecurityPlugin['everyoneBaseline'];
}

/** The body of `SecurityPlugin#declareEveryone`; the method's docblock there is its contract. */
export async function declareEveryone(
  this: Pick<EveryoneAnchorHost, 'deploymentAcceptance' | 'epoch' | 'everyoneBaseline' | 'metadata' | 'ql'>,
  logger: PluginContext['logger'],
): Promise<void> {
  const ql = this.ql;
  try {
    const anchorContext = await readDeclaredCapabilityContext(ql, this.metadata);
    const sets = this.everyoneBaseline(anchorContext, (set, offending) => {
      logger.warn('[security] the everyone anchor does not name a baseline set — high-privilege bits', { set, offending });
    });
    try {
      const derived = await readAcceptedEveryoneSets(ql, this.metadata, this.deploymentAcceptance());
      for (const name of derived.accepted) if (!sets.includes(name)) sets.push(name);
      for (const w of derived.withheld) {
        const line = w.source === 'host-configuration'
          ? `[security] the everyone anchor does not carry the set '${w.set}' the security plugin's ` +
            `\`acceptedDefaultPermissionSets\` option declares: ${w.reason}. It grants nothing while that holds; ` +
            'remove the name from the option, or serve the set again as an isDefault set some package declares.'
          : `[security] the everyone anchor does not carry the accepted set '${w.set}' (package '${w.packageId}'): ` +
            `${w.reason}. Its acceptance stays recorded and grants nothing until the set is served again as ` +
            'accepted; a manage_metadata holder can revoke it in Setup.';
        if (w.forbidden) logger.error(line, undefined, { set: w.set, package: w.packageId });
        else logger.warn(line, { set: w.set, package: w.packageId });
      }
    } catch (e) {
      logger.error(
        '[security] the accepted package defaults for the everyone anchor could NOT be read — every signed-in ' +
          'member holds the baseline alone until the next derivation (boot, accept, revoke, uninstall or package ' +
          'publish) reads them. Remedy: restore read access to sys_audience_binding_suggestion and restart.',
        e as Error,
      );
    }
    if (sets.length > 0) declareEveryoneBaseline((ql as { registry?: unknown })?.registry, SECURITY_PLUGIN_ID, sets);
    this.epoch.bump('metadata');
  } catch (e) {
    logger.warn('[security] everyone-anchor declaration failed (non-fatal)', { error: (e as Error).message });
  }
}

/** The body of `SecurityPlugin#declareBuiltinPositions`; the method's docblock there is its contract. */
export function declareBuiltinPositions(
  this: Pick<EveryoneAnchorHost, 'everyoneBaseline'>,
  ctx: PluginContext,
): void {
  let ql: { registry?: unknown } | undefined;
  try {
    ql = ctx.getService<{ registry?: unknown }>('objectql');
  } catch {
    return; // No engine: `start()` reports it, and nothing can be declared.
  }
  if (!ql) return;
  if (registerBuiltinPositions(ql.registry, SECURITY_PLUGIN_ID) === 0) {
    ctx.logger.warn(
      '[security] the built-in positions (platform_admin, org_owner, org_admin, org_member, everyone, guest) '
        + 'were NOT declared as position metadata: the ObjectQL engine exposes no registry that can register '
        + 'them. The security catalog read and GET /api/v1/meta/position will not list them, and the '
        + '`everyone` baseline sets are granted through no position.',
    );
    return;
  }
  const baseline = this.everyoneBaseline(undefined);
  if (baseline.length > 0) declareEveryoneBaseline(ql.registry, SECURITY_PLUGIN_ID, baseline);
}
