// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The "Action system and packaged-action activation" section
 * of `ObjectQL`: the bodies of `registerAction`, `listRegisteredActions` moved
 * out of `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link ActionsHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each method hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface ActionsHost {
  readonly actions: ObjectQL['actions'];
  readonly logger: ObjectQL['logger'];
}

/** The body of `ObjectQL#registerAction`; the method's docblock there is its contract. */
export function registerAction(this: Pick<ActionsHost, 'actions' | 'logger'>, objectName: string, actionName: string, handler: (ctx: any) => Promise<any> | any, packageName?: string): void {
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

/** The body of `ObjectQL#listRegisteredActions`; the method's docblock there is its contract. */
export function listRegisteredActions(this: Pick<ActionsHost, 'actions'>): Array<{ objectName: string; actionName: string; package?: string }> {
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
