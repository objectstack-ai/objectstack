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
 * `ObjectQL` members they read, private ones included. Each stub hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class,
 * and a field a body assigns goes with a SETTER that assigns it on the engine.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { ActionActivationRow, ActionActivationStore, ActionActivationWriteOptions } from './action-activation.js';
import type { ObjectQL } from './engine.js';

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
  readonly logger: ObjectQL['logger'];
}

/** The bodies of the "Action system and packaged-action activation" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class ActionsFacet {
  /** The body of `ObjectQL#registerAction`; the method's docblock there is its contract. */
  static registerAction(this: Pick<ActionsHost, 'actions' | 'logger'>, objectName: string, actionName: string, handler: (ctx: any) => Promise<any> | any, packageName?: string): void {
    const key = `${objectName}:${actionName}`;
    const replaced = this.actions.get(key);
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

  /** The body of `ObjectQL#executeAction`; the method's docblock there is its contract. */
  static async executeAction(this: Pick<ActionsHost, 'actions'>, objectName: string, actionName: string, ctx: any): Promise<any> {
    const entry = this.actions.get(`${objectName}:${actionName}`);
    if (!entry) {
      throw new Error(`Action '${actionName}' on object '${objectName}' not found`);
    }
    return entry.handler(ctx);
  }

  /** The body of `ObjectQL#listRegisteredActions`; the method's docblock there is its contract. */
  static listRegisteredActions(this: Pick<ActionsHost, 'actions'>): Array<{ objectName: string; actionName: string; package?: string }> {
    const out: Array<{ objectName: string; actionName: string; package?: string }> = [];
    for (const [key, entry] of this.actions.entries()) {
      const sep = key.indexOf(':');
      if (sep < 0) continue;
      out.push({
        objectName: key.slice(0, sep),
        actionName: key.slice(sep + 1),
        ...(entry.package ? { package: entry.package } : {}),
      });
    }
    return out;
  }

  /** The body of `ObjectQL#removeActionsByPackage`; the method's docblock there is its contract. */
  static removeActionsByPackage(this: Pick<ActionsHost, 'actions'>, packageName: string): void {
    for (const [key, entry] of this.actions.entries()) {
      if (entry.package === packageName) {
        this.actions.delete(key);
      }
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
