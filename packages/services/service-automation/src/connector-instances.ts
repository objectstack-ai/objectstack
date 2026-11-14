// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, #31699] The automation engine's registered connector
 * instances, held by `(package, name)`.
 *
 * A connector instance is identified by its package and its name: a package's
 * declared instance by that package, an instance the environment authored or a
 * plugin registers in code by no package (`null`). Two packages' instances of
 * one name are two instances. A caller that knows only the name is answered
 * by the one instance of that name, never by one of two (ADR-0150 red line 2).
 *
 * Today the declared-connector reconcile still keeps one instance per name
 * (the one-holder backstop and its duplicate-name refusal), and registers a
 * declarative instance with `soleOfName`, which drops any other declarative
 * instance of the name. The PR that narrows the backstop lifts that.
 */

import type { RegisteredConnector } from './engine.js';

/** One registered instance and the package it is the instance of (`null`: none). */
export interface ConnectorInstanceEntry {
    readonly packageId: string | null;
    readonly registered: RegisteredConnector;
}

export class ConnectorInstances {
    private readonly byName = new Map<string, Map<string | null, RegisteredConnector>>();

    /** The instance of `name` of exactly `packageId`, or `undefined`. */
    get(name: string, packageId: string | null): RegisteredConnector | undefined {
        return this.byName.get(name)?.get(packageId);
    }

    /** Every instance registered under `name`, in registration order. */
    ofName(name: string): ConnectorInstanceEntry[] {
        return [...(this.byName.get(name) ?? new Map<string | null, RegisteredConnector>())]
            .map(([packageId, registered]) => ({ packageId, registered }));
    }

    /** The one instance of `name`, or `undefined` when there is none or more than one. */
    sole(name: string): ConnectorInstanceEntry | undefined {
        const all = this.ofName(name);
        return all.length === 1 ? all[0] : undefined;
    }

    /** Register (or replace) the instance of `name` of `packageId`. */
    set(name: string, packageId: string | null, registered: RegisteredConnector): void {
        let instances = this.byName.get(name);
        if (!instances) {
            instances = new Map();
            this.byName.set(name, instances);
        }
        instances.set(packageId, registered);
    }

    /**
     * Remove the instance of `name` of `packageId`, or, with `packageId`
     * `undefined`, every instance of `name`. `true` when one was removed.
     */
    delete(name: string, packageId?: string | null): boolean {
        const instances = this.byName.get(name);
        if (!instances) return false;
        if (packageId === undefined) {
            this.byName.delete(name);
            return instances.size > 0;
        }
        const removed = instances.delete(packageId);
        if (instances.size === 0) this.byName.delete(name);
        return removed;
    }

    /** Every registered name, once each. */
    names(): string[] {
        return [...this.byName.keys()];
    }

    /** Every registered instance. */
    entries(): ConnectorInstanceEntry[] {
        return this.names().flatMap((name) => this.ofName(name));
    }

    /** Every registered instance's registration. */
    values(): RegisteredConnector[] {
        return this.entries().map((e) => e.registered);
    }
}
