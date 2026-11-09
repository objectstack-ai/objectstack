// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Action system and packaged-action activation" section
 * of `ObjectQL`: the bodies of `registerAction`, `executeAction`,
 * `listRegisteredActions`, `removeActionsByPackage`,
 * `setActionActivationStore`, `hydrateActionActivations`, `isActionEnabled`,
 * `listDisabledActions`, `getDisabledActions`, `describeDisabledAction`,
 * `setActionActive` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link ActionsFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link ActionsHost}: exactly the
 * `ObjectQL` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `actionsHost` in `engine-facet-hosts.ts`,
 * built once per engine by the class's static block. Methods go as closures
 * that call them on the engine at call time, so a subclass override or an
 * instance spy is still the one reached; fields and accessors go as GETTERS,
 * read when the body reads them, as they were on the class, and a field a body
 * assigns goes with a SETTER that assigns it on the engine.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { ActionActivationRow, ActionActivationStore, ActionActivationWriteOptions } from './action-activation.js';
import type { ObjectQL } from './engine.js';
import { standaloneActionOwnerKey } from './action-governance.js';
import { actionHandlerCoordinate, ENVIRONMENT_ACTION_COORDINATE, isSharedHandlerCoordinate } from './action-handler-coordinate.js';

/**
 * One registered action handler. [#30065] `override` marks a declared action
 * override's handler ({@link ActionsFacet.registerActionOverride}); `beneath`
 * is the handler it was bound over, or the declared base's registered for the
 * key after it, kept so removing the override restores it. [#30542] `base` is
 * the package the override declares (`overrides.package`): only a handler of
 * the action that package ships slots beneath it.
 */
export interface ActionHandlerEntry {
  handler: (ctx: any) => Promise<any> | any;
  package?: string;
  override?: true;
  base?: string;
  beneath?: ActionHandlerEntry;
}

/**
 * [ADR-0150 D2/D5, #31673] A call naming package P reached no handler of P's
 * own under the key, and two or more shared handlers (host code, plugins) hold it: the refusal
 * names every owner and picks none. `RESOURCE_CONFLICT` / 409, the standard
 * catalog's member for an ambiguity the environment's state causes (the
 * declaration door's own answer); no code minted. ⛔ Unexported, like the
 * registry's refusals: a consumer compares `code`, never `instanceof`.
 */
class ActionHandlerAmbiguityError extends Error {
  readonly code = 'RESOURCE_CONFLICT';
  readonly status = 409;
  readonly httpStatus = 409;
  /** Every owner holding a shared handler under the key, in slot order. */
  readonly owners: readonly string[];

  constructor(key: string, packageId: string, owners: readonly string[]) {
    super(
      `Action handler '${key}' is ambiguous for package '${packageId}': it registers none of its own, and `
      + `${owners.length} shared handlers are registered (${owners.map((o) => `'${o}'`).join(', ')}). Refusing rather than `
      + 'running one of them. Register the handler from the package that declares the action, or from one owner.',
    );
    this.name = 'ActionHandlerAmbiguityError';
    this.owners = owners;
  }
}

/**
 * [ADR-0150 D4, #31673] What a call of `ObjectQL#executeAction` says about
 * who is calling.
 */
export interface ExecuteActionOptions {
  /**
   * The package coordinate whose handler the call means — the holder of the
   * declaration the caller resolved (`resolveActionByPackage`), `''` for the
   * environment's own. Omitted: a call that names no package.
   */
  packageId?: string;
}

/**
 * The `ObjectQL` members the bodies of {@link ActionsFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface ActionsHost {
  readonly actionActivation: ObjectQL['actionActivation'];
  readonly actions: ObjectQL['actions'];
  readonly packageActions: ObjectQL['packageActions'];
  readonly logger: ObjectQL['logger'];
  readonly registry: ObjectQL['registry'];
}

/** The bodies of the "Action system and packaged-action activation" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class ActionsFacet {
  /** The body of `ObjectQL#registerAction`; the method's docblock there is its contract. */
  static registerAction(this: Pick<ActionsHost, 'actions' | 'packageActions' | 'logger' | 'registry'>, objectName: string, actionName: string, handler: (ctx: any) => Promise<any> | any, packageName?: string): void {
    const key = `${objectName}:${actionName}`;
    // [ADR-0150 D4, #31673] The package's own slot first: a registration
    // replaces only its own package's handler under the key there, so two
    // packages' handlers for one object and name coexist, and a call that
    // names its package reaches its own (`executeAction`'s `packageId`).
    ActionsFacet.placeHandler.call(this, ActionsFacet.packageSlot.call(this, actionHandlerCoordinate(packageName)), key, objectName, actionName, handler, packageName);
    const replaced = this.actions.get(key);
    // [#30065, ADR-0146 D9 `action`] The declared base's handler arriving
    // under a key the override holds — a marketplace base's, bound by its
    // `kernel:ready` rehydrate after the authored-action resync bound the
    // override, or a bundle's handlers re-bound — slots beneath the override,
    // which stays the one that runs, and is the one a removal of the override
    // binds again. [#30542] Only the declared base's: any other registration
    // replaces it and is warned below, like every other collision.
    if (replaced?.override === true && replaced.package !== packageName
        && ActionsFacet.arrivesAsDeclaredBase.call(this, replaced, objectName, actionName, packageName)) {
      this.actions.set(key, { ...replaced, beneath: { handler, package: packageName } });
      this.logger.debug('Registered action beneath an override', { objectName, actionName, package: packageName, override: replaced.package });
      return;
    }
    // [#31673, interim until #31697] The UNQUALIFIED slot — what a call that
    // names no package runs — keeps today's answer exactly: the last
    // registration under `OBJECT:NAME` runs, and a replacement of another
    // owner's handler is warned naming both (#24472; ruling 6262054499,
    // "report first"). Refusing that call when two packages hold one object
    // and name is the action backstop's decision (#31697), not this one.
    if (replaced !== undefined && replaced.package !== packageName) {
      const by = (name: string | undefined) => (name ? `by package '${name}'` : 'with no package');
      this.logger.warn(
        `Action handler '${key}' registered ${by(packageName)} replaces the one registered ${by(replaced.package)}: `
        + `the action door now runs the handler registered ${by(packageName)}, whichever declaration object `
        + `'${objectName}' lists${packageName ? `, and withdrawing package '${packageName}' leaves the action with no handler` : ''}. `
        + `Two owners share one handler key only when both declare action '${actionName}' on object `
        + `'${objectName}' — rename one of them.`,
        { objectName, actionName, package: packageName, replacedPackage: replaced.package },
      );
    }
    this.actions.set(key, { handler, package: packageName });
    this.logger.debug('Registered action', { objectName, actionName, package: packageName });
  }

  /**
   * [ADR-0150 D4, #31673] The handlers of one package coordinate
   * ({@link actionHandlerCoordinate}), keyed `OBJECT:NAME` — created on first use.
   */
  static packageSlot(this: Pick<ActionsHost, 'packageActions'>, coordinate: string): Map<string, ActionHandlerEntry> {
    let slot = this.packageActions.get(coordinate);
    if (slot === undefined) this.packageActions.set(coordinate, (slot = new Map<string, ActionHandlerEntry>()));
    return slot;
  }

  /**
   * [ADR-0150 D4, #31673] Place a registration in one package coordinate's
   * slot, by the rule the unqualified slot applies inside one key: a
   * registration replaces the handler there, except the declared base's
   * handler arriving under an override, which slots beneath it (#30065,
   * #30542). Silent: the coordinate is one package, so a replacement there is
   * that package re-binding, and the unqualified slot warns the cross-owner
   * case.
   */
  static placeHandler(this: Pick<ActionsHost, 'registry'>, slot: Map<string, ActionHandlerEntry>, key: string, objectName: string, actionName: string, handler: (ctx: any) => Promise<any> | any, packageName?: string): void {
    const replaced = slot.get(key);
    if (replaced?.override === true && replaced.package !== packageName
        && ActionsFacet.arrivesAsDeclaredBase.call(this, replaced, objectName, actionName, packageName)) {
      slot.set(key, { ...replaced, beneath: { handler, package: packageName } });
      return;
    }
    slot.set(key, { handler, package: packageName });
  }

  /**
   * [#30542] Whether a registration under a key a declared override holds is
   * the declared base's own handler: the registry's code artifact of the
   * action (`getArtifactItem`, which a package's items are registered in
   * before its handlers are bound) belongs to the package the override
   * declares, on this object — the judgement the authored-action resync
   * binds the override by once that artifact is registered. A registration
   * with no package is no package's. An override bound with no declared base
   * keeps taking any package's handler beneath it.
   */
  static arrivesAsDeclaredBase(this: Pick<ActionsHost, 'registry'>, override: ActionHandlerEntry, objectName: string, actionName: string, packageName: string | undefined): boolean {
    if (packageName === undefined) return false;
    if (override.base === undefined) return true;
    const artifact: any = this.registry?.getArtifactItem?.('action', actionName);
    return artifact?._packageId === override.base && standaloneActionOwnerKey(artifact) === objectName;
  }

  /** The body of `ObjectQL#registerActionOverride`; the method's docblock there is its contract. */
  static registerActionOverride(this: Pick<ActionsHost, 'actions' | 'packageActions' | 'logger'>, objectName: string, actionName: string, handler: (ctx: any) => Promise<any> | any, packageName: string, base?: string): void {
    const key = `${objectName}:${actionName}`;
    const bind = (slot: Map<string, ActionHandlerEntry>): ActionHandlerEntry | undefined => {
      const current = slot.get(key);
      // Re-binding the same package's override replaces it in place, over the
      // same handler beneath.
      const beneath = current?.package === packageName ? current.beneath : current;
      slot.set(key, {
        handler, package: packageName, override: true,
        ...(base !== undefined ? { base } : {}),
        ...(beneath !== undefined ? { beneath } : {}),
      });
      return beneath;
    };
    // [ADR-0150 D4, #31673] A declared override customizes its base's item
    // (ADR-0146 D9), so in the package-keyed slots it binds at the BASE's
    // coordinate, over the base's handler; one that declares no base binds
    // over the coordinate whose handler the unqualified slot runs now, else
    // the environment's.
    const coordinate = base ?? ActionsFacet.coordinateOfUnqualified.call(this, key);
    bind(ActionsFacet.packageSlot.call(this, coordinate));
    const beneath = bind(this.actions);
    this.logger.debug('Registered action override', { objectName, actionName, package: packageName, beneath: beneath?.package });
  }

  /**
   * The package coordinate of the handler the unqualified slot holds under
   * `key` — the package slot holding that very entry — else the
   * environment's.
   */
  static coordinateOfUnqualified(this: Pick<ActionsHost, 'actions' | 'packageActions'>, key: string): string {
    const entry = this.actions.get(key);
    if (entry !== undefined) {
      for (const [coordinate, slot] of this.packageActions) {
        if (slot.get(key) === entry) return coordinate;
      }
      return actionHandlerCoordinate(entry.package);
    }
    return ENVIRONMENT_ACTION_COORDINATE;
  }

  /** The body of `ObjectQL#executeAction`; the method's docblock there is its contract. */
  static async executeAction(this: Pick<ActionsHost, 'actions' | 'packageActions'>, objectName: string, actionName: string, ctx: any, options?: ExecuteActionOptions): Promise<any> {
    const key = `${objectName}:${actionName}`;
    // [#31673, interim until #31697] A call that names no package runs the
    // unqualified slot's handler — today's answer, unchanged.
    const entry = options?.packageId === undefined
      ? this.actions.get(key)
      : ActionsFacet.packageScopedHandler.call(this, key, options.packageId);
    if (!entry) {
      throw new Error(`Action '${actionName}' on object '${objectName}' not found`);
    }
    return entry.handler(ctx);
  }

  /**
   * [ADR-0150 D4, #31673] The handler a call naming package `packageId` runs
   * under `key`: that package's own; else, when exactly ONE shared handler is
   * held under the key, that one. Shared means host code (registered with no
   * owner, the documented way a package's target-bound actions are bound) or
   * a plugin ({@link isSharedHandlerCoordinate}); never a package's
   * (`app:<id>`) and never the environment's slot (the authored-action
   * resync's `metadata-service`), whose handlers belong to another holder's
   * declarations (review 6729714225 item 2, 6729902179 F1). Two or more shared
   * handlers are refused naming every owner ({@link ActionHandlerAmbiguityError},
   * 409 `RESOURCE_CONFLICT`), never reported as absence (review item 1); none
   * is `undefined` (the caller's "not found"). ⛔ Never another holder's
   * handler, and never a pick between candidates.
   */
  static packageScopedHandler(this: Pick<ActionsHost, 'packageActions'>, key: string, packageId: string): ActionHandlerEntry | undefined {
    return ActionsFacet.packageScopedReach.call(this, key, packageId)?.entry;
  }

  /** {@link packageScopedHandler}, with the coordinate whose slot holds the entry. */
  static packageScopedReach(this: Pick<ActionsHost, 'packageActions'>, key: string, packageId: string): { entry: ActionHandlerEntry; coordinate: string } | undefined {
    const own = this.packageActions.get(packageId)?.get(key);
    if (own !== undefined) return { entry: own, coordinate: packageId };
    const shared: Array<{ entry: ActionHandlerEntry; coordinate: string }> = [];
    for (const [coordinate, slot] of this.packageActions) {
      const entry = slot.get(key);
      if (entry !== undefined && isSharedHandlerCoordinate(coordinate, entry.package)) shared.push({ entry, coordinate });
    }
    if (shared.length > 1) {
      throw new ActionHandlerAmbiguityError(key, packageId, shared.map(({ entry }) => entry.package ?? '(host code, no owner)'));
    }
    return shared[0];
  }

  /** The body of `ObjectQL#listRegisteredActions`; the method's docblock there is its contract. */
  static listRegisteredActions(this: Pick<ActionsHost, 'actions' | 'packageActions'>, options?: ExecuteActionOptions): Array<{ objectName: string; actionName: string; package?: string; coordinate?: string }> {
    const out: Array<{ objectName: string; actionName: string; package?: string; coordinate?: string }> = [];
    const entries: Iterable<[string, ActionHandlerEntry, string?]> = options?.packageId === undefined
      ? this.actions.entries()
      : ActionsFacet.packageScopedEntries.call(this, options.packageId);
    for (const [key, entry, coordinate] of entries) {
      const sep = key.indexOf(':');
      if (sep < 0) continue;
      out.push({
        objectName: key.slice(0, sep),
        actionName: key.slice(sep + 1),
        ...(entry.package ? { package: entry.package } : {}),
        ...(coordinate !== undefined ? { coordinate } : {}),
      });
    }
    return out;
  }

  /**
   * [#31673, review 6729902179 F2] Every key a call naming `packageId`
   * dispatches, with the entry {@link packageScopedHandler} runs for it. A key
   * whose dispatch is refused as ambiguous is left out: no handler runs there.
   */
  static packageScopedEntries(this: Pick<ActionsHost, 'packageActions'>, packageId: string): Array<[string, ActionHandlerEntry, string]> {
    const keys = new Set<string>();
    for (const slot of this.packageActions.values()) for (const key of slot.keys()) keys.add(key);
    const out: Array<[string, ActionHandlerEntry, string]> = [];
    for (const key of keys) {
      let reach: { entry: ActionHandlerEntry; coordinate: string } | undefined;
      try {
        reach = ActionsFacet.packageScopedReach.call(this, key, packageId);
      } catch {
        continue;
      }
      if (reach !== undefined) out.push([key, reach.entry, reach.coordinate]);
    }
    return out;
  }

  /** The body of `ObjectQL#removeActionsByPackage`; the method's docblock there is its contract. */
  static removeActionsByPackage(this: Pick<ActionsHost, 'actions' | 'packageActions'>, packageName: string): void {
    // [#30065] Drop the package's entries from each key's stack: an override's
    // removal leaves the handler beneath it bound.
    const without = (entry: ActionHandlerEntry | undefined): ActionHandlerEntry | undefined => {
      if (entry === undefined) return undefined;
      if (entry.package === packageName) return without(entry.beneath);
      const beneath = without(entry.beneath);
      if (beneath === entry.beneath) return entry;
      const { beneath: _dropped, ...rest } = entry;
      return beneath === undefined ? rest : { ...rest, beneath };
    };
    const prune = (slot: Map<string, ActionHandlerEntry>): void => {
      for (const [key, entry] of Array.from(slot.entries())) {
        const kept = without(entry);
        if (kept === undefined) slot.delete(key);
        else if (kept !== entry) slot.set(key, kept);
      }
    };
    prune(this.actions);
    // [ADR-0150 D4, #31673] …and from every package coordinate's slot.
    for (const [coordinate, slot] of Array.from(this.packageActions.entries())) {
      prune(slot);
      if (slot.size === 0) this.packageActions.delete(coordinate);
    }
  }

  /** The body of `ObjectQL#setActionActivationStore`; the method's docblock there is its contract. */
  static setActionActivationStore(this: Pick<ActionsHost, 'actionActivation'>, store: ActionActivationStore): void {
    this.actionActivation.attach(store);
  }

  /** The body of `ObjectQL#hydrateActionActivations`; the method's docblock there is its contract. */
  static async hydrateActionActivations(this: Pick<ActionsHost, 'actionActivation'>): Promise<string[]> {
    return this.actionActivation.hydrate();
  }

  /** The body of `ObjectQL#isActionEnabled`; the method's docblock there is its contract. */
  static isActionEnabled(this: Pick<ActionsHost, 'actionActivation'>, actionName: string): boolean {
    return this.actionActivation.isEnabled(actionName);
  }

  /** The body of `ObjectQL#listDisabledActions`; the method's docblock there is its contract. */
  static listDisabledActions(this: Pick<ActionsHost, 'actionActivation'>): string[] {
    return this.actionActivation.disabledNames();
  }

  /** The body of `ObjectQL#getDisabledActions`; the method's docblock there is its contract. */
  static getDisabledActions(this: Pick<ActionsHost, 'actionActivation'>): string[] | undefined {
    return this.actionActivation.durable ? this.actionActivation.disabledNames() : undefined;
  }

  /** The body of `ObjectQL#describeDisabledAction`; the method's docblock there is its contract. */
  static describeDisabledAction(this: Pick<ActionsHost, 'actionActivation' | 'logger'>, actionName: string): string {
    this.logger.info(
      `ACTION_DISABLED: packaged action '${actionName}' refused — it is switched off in the activation ledger ` +
        '(sys_metadata_activation, ADR-0126 §8 item 2).',
      { action: actionName, refusal: 'ACTION_DISABLED' },
    );
    return this.actionActivation.describeDisabled(actionName);
  }

  /** The body of `ObjectQL#setActionActive`; the method's docblock there is its contract. */
  static async setActionActive(this: Pick<ActionsHost, 'actionActivation'>, row: ActionActivationRow, options?: ActionActivationWriteOptions): Promise<void> {
    await this.actionActivation.setActive(row, options);
  }
}
