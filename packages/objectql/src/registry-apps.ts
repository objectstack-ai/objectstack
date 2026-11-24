// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33949 codemod] The "Apps, navigation contributions and their diagnostics"
 * section of `SchemaRegistry`: the bodies of `getApp`, `getAllApps`,
 * `registerAppNavContribution`, `setPackageNavContributions`,
 * `getAppNavContributions`, `applyNavContributions`, `findNavGroup`,
 * `recordNavGroupMiss`, `getAppNavDiagnostics` moved out of `registry.ts` whole
 * by the #33949 split codemod (PR #34285, kept in its branch history, not committed).
 *
 * A MOVE, not a redesign. {@link AppsFacet} is a stateless facet of `SchemaRegistry`
 * (ruling 6624345766): each static method of it is the body of the `SchemaRegistry`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `SchemaRegistry`.
 *
 * The bodies reach the class through {@link AppsHost}: exactly the
 * `SchemaRegistry` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `appsHost` in
 * `registry-facet-hosts.ts`, built once per registry by the class's static
 * block. Methods go as closures that call them on the registry at call time, so
 * a subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * registry.
 *
 * The module imports `registry.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { formatNavContributionGroupDiagnostic, navContributionGroupDiagnostic, findNavGroup as resolveNavGroup } from './nav-contribution-diagnostics.js';
import type { NavContributionGroupDiagnostic } from './nav-contribution-diagnostics.js';
import type { SchemaRegistry } from './registry.js';

/**
 * The `SchemaRegistry` members the bodies of {@link AppsFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface AppsHost {
  readonly appNavContributions: SchemaRegistry['appNavContributions'];
  applyNavContributions: SchemaRegistry['applyNavContributions'];
  findNavGroup: SchemaRegistry['findNavGroup'];
  isPackageDisabled: SchemaRegistry['isPackageDisabled'];
  listItems: SchemaRegistry['listItems'];
  log: SchemaRegistry['log'];
  readonly navGroupDiagnostics: SchemaRegistry['navGroupDiagnostics'];
  noteAppNavContributions: SchemaRegistry['noteAppNavContributions'];
  recordNavGroupMiss: SchemaRegistry['recordNavGroupMiss'];
  resolveItem: SchemaRegistry['resolveItem'];
  warn: SchemaRegistry['warn'];
}

/** The bodies of the "Apps, navigation contributions and their diagnostics" section of `SchemaRegistry`: a stateless facet, called by the class's stubs. */
export class AppsFacet {
  /** The body of `SchemaRegistry#getApp`; the method's docblock there is its contract. */
  static getApp(this: Pick<AppsHost, 'applyNavContributions' | 'resolveItem'>, name: string, currentPackageId?: string): any {
    const app = this.resolveItem<any>('app', name, currentPackageId);
    if (!app) return app;
    return this.applyNavContributions(app);
  }

  /** The body of `SchemaRegistry#getAllApps`; the method's docblock there is its contract. */
  static getAllApps(this: Pick<AppsHost, 'applyNavContributions' | 'listItems'>): any[] {
    return this.listItems('app').map((app: any) => this.applyNavContributions(app));
  }

  /** The body of `SchemaRegistry#registerAppNavContribution`; the method's docblock there is its contract. */
  static registerAppNavContribution(this: Pick<AppsHost, 'appNavContributions' | 'log' | 'noteAppNavContributions'>, contribution: { app: string; group?: string; priority?: number; items?: any[] }, packageId?: string): void {
    if (!contribution || !contribution.app) return;
    this.noteAppNavContributions(contribution.app);
    const list = this.appNavContributions.get(contribution.app) ?? [];
    list.push({
      packageId,
      group: contribution.group,
      priority: contribution.priority ?? 200,
      items: Array.isArray(contribution.items) ? contribution.items : [],
    });
    this.appNavContributions.set(contribution.app, list);
    this.log(
      `[Registry] Navigation contribution: ${packageId ?? '(unknown)'} -> ${contribution.app}` +
        (contribution.group ? `/${contribution.group}` : '') +
        ` (${list[list.length - 1].items.length} items)`,
    );
  }

  /** The body of `SchemaRegistry#setPackageNavContributions`; the method's docblock there is its contract. */
  static setPackageNavContributions(this: Pick<AppsHost, 'appNavContributions' | 'log' | 'noteAppNavContributions'>, packageId: string, contributions: ReadonlyArray<{ app: string; group?: string; priority?: number; items?: any[] }>): void {
    const incoming = new Map<string, Array<{ packageId?: string; group?: string; priority: number; items: any[] }>>();
    for (const contribution of contributions) {
      if (!contribution || !contribution.app) continue;
      const list = incoming.get(contribution.app) ?? [];
      list.push({
        packageId,
        group: contribution.group,
        priority: contribution.priority ?? 200,
        items: Array.isArray(contribution.items) ? contribution.items : [],
      });
      incoming.set(contribution.app, list);
    }
    for (const [app, list] of this.appNavContributions) {
      if (list.some((c) => c.packageId === packageId)) this.noteAppNavContributions(app);
    }
    for (const app of incoming.keys()) this.noteAppNavContributions(app);
    for (const [app, list] of [...this.appNavContributions]) {
      const at = list.findIndex((c) => c.packageId === packageId);
      if (at === -1) continue;
      const kept = list.filter((c) => c.packageId !== packageId);
      kept.splice(at, 0, ...(incoming.get(app) ?? []));
      incoming.delete(app);
      if (kept.length > 0) this.appNavContributions.set(app, kept);
      else this.appNavContributions.delete(app);
    }
    for (const [app, list] of incoming) {
      this.appNavContributions.set(app, [...(this.appNavContributions.get(app) ?? []), ...list]);
    }
    for (const c of contributions) {
      if (!c || !c.app) continue;
      this.log(
        `[Registry] Navigation contribution: ${packageId} -> ${c.app}` +
          (c.group ? `/${c.group}` : '') +
          ` (${Array.isArray(c.items) ? c.items.length : 0} items)`,
      );
    }
  }

  /** The body of `SchemaRegistry#getAppNavContributions`; the method's docblock there is its contract. */
  static getAppNavContributions(this: Pick<AppsHost, 'appNavContributions'>, appName: string): Array<{ packageId?: string; group?: string; priority: number; items: any[] }> {
    return this.appNavContributions.get(appName) ?? [];
  }

  /** The body of `SchemaRegistry#applyNavContributions`; the method's docblock there is its contract. */
  static applyNavContributions(this: Pick<AppsHost, 'appNavContributions' | 'findNavGroup' | 'isPackageDisabled' | 'recordNavGroupMiss'>, app: any): any {
    const contributions = this.appNavContributions.get(app?.name);
    if (!contributions || contributions.length === 0) return app;

    const cloned = structuredClone(app);
    const nav: any[] = Array.isArray(cloned.navigation) ? cloned.navigation : (cloned.navigation = []);

    // Lower priority applied first — mirrors object extender ordering.
    const sorted = [...contributions].sort((a, b) => a.priority - b.priority);
    for (const c of sorted) {
      if (!c.items.length) continue;
      // [#28117] A disabled package's contributions leave the app, as its
      // objects leave the data plane: "disabled" has one meaning (hidden +
      // refused + data kept). Asked per read, never cached, so an enable
      // restores them with nothing to invalidate; skipped BEFORE the group
      // lookup, so a disabled contribution is not relocated or diagnosed either.
      if (this.isPackageDisabled(c.packageId)) continue;
      if (c.group) {
        const group = this.findNavGroup(nav, c.group);
        if (group) {
          if (!Array.isArray(group.children)) group.children = [];
          group.children.push(...c.items);
        } else {
          // [#14553] The relocation itself is UNCHANGED — the fold stays
          // order-independent and contributions into optional groups keep
          // working (option A, a refusal plus a registration-order rule, was
          // weighed and not taken). What changed is that it is no longer
          // silent: this used to be one `this.log(...)` gated at `info`, so a
          // deployment at `OS_REGISTRY_LOG=warn` watched its information
          // architecture change with nothing in the log at all.
          this.recordNavGroupMiss(String(app.name), c);
          nav.push(...c.items);
        }
      } else {
        nav.push(...c.items);
      }
    }
    return cloned;
  }

  /**
   * Depth-first search for a `type: 'group'` nav item by id.
   *
   * [#14553] Delegates rather than implements: `os build` asks the identical
   * question at compile time over a composed artifact, and two copies of this
   * walk is exactly the drift that would let the build call an authoring error
   * fine while this fold relocates it.
   */
  static findNavGroup(items: any[], groupId: string): any | undefined {
    return resolveNavGroup(items, groupId);
  }

  /**
   * Record — and, the first time, announce — one relocated contribution.
   *
   * The entry is kept so a caller that is not reading the log
   * ({@link getAppNavDiagnostics}: `os doctor`, a boot report, a test) can ask
   * the app what happened to it.
   */
  static recordNavGroupMiss(this: Pick<AppsHost, 'navGroupDiagnostics' | 'warn'>, appName: string, c: { packageId?: string; group?: string; items: any[] }): void {
    const diagnostic = navContributionGroupDiagnostic({
      app: appName,
      group: String(c.group),
      ...(c.packageId === undefined ? {} : { packageId: c.packageId }),
      items: c.items,
    });
    const perApp = this.navGroupDiagnostics.get(appName) ?? new Map<string, NavContributionGroupDiagnostic>();
    const key = `${c.packageId ?? ''}|${c.group}`;
    if (perApp.has(key)) return;
    perApp.set(key, diagnostic);
    this.navGroupDiagnostics.set(appName, perApp);
    this.warn(formatNavContributionGroupDiagnostic(diagnostic));
  }

  /** The body of `SchemaRegistry#getAppNavDiagnostics`; the method's docblock there is its contract. */
  static getAppNavDiagnostics(this: Pick<AppsHost, 'navGroupDiagnostics'>, appName: string): NavContributionGroupDiagnostic[] {
    return [...(this.navGroupDiagnostics.get(appName)?.values() ?? [])];
  }
}
