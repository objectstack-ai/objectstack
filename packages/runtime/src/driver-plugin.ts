// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';

/**
 * Driver Plugin
 * 
 * Generic plugin wrapper for ObjectQL drivers.
 * Registers a driver with the ObjectQL engine.
 * 
 * Dependencies: None (Registers service for ObjectQL to discover)
 * Services: driver.{name}
 * 
 * @example
 * const memoryDriver = new InMemoryDriver();
 * const driverPlugin = new DriverPlugin(memoryDriver, 'memory');
 * kernel.use(driverPlugin);
 */
export class DriverPlugin implements Plugin {
    name: string;
    type = 'driver';
    version = '1.0.0';

    private driver: any;

    // A `DriverPluginOptions` bag (`datasourceName` / `registerAsDefault`)
    // used to be accepted here. Both options configured start()'s datasource
    // registration, which probed `metadata.addDatasource` — a method no
    // metadata service implements — so they were inert on every boot since
    // inception; retired via #4320 (found by #4251). Routing to a named
    // auxiliary driver needs only the DRIVER name: init() registers
    // `driver.<name>`, ObjectQL's discovery loop adopts it, and the engine's
    // lifecycle/datasource resolution keys off that name (see serve.ts's
    // telemetry provision for the pattern).
    constructor(driver: any, driverName?: string) {
        this.driver = driver;
        this.name = `com.objectstack.driver.${driverName || driver.name || 'unknown'}`;
    }

    init = async (ctx: PluginContext) => {
        const serviceName = `driver.${this.driver.name || 'unknown'}`;
        ctx.registerService(serviceName, this.driver);
        ctx.logger.info('Driver service registered', { 
            serviceName, 
            driverName: this.driver.name,
            driverVersion: this.driver.version 
        });
    }

    // start() used to hold a named/default datasource registration block,
    // gated on `metadata.addDatasource` — a method no metadata service
    // implements, here or anywhere in the repo — so the guard's early return
    // made every line behind it (and the options that configured it)
    // unreachable on every boot. Typing the lookup (#4251) surfaced that; the
    // dead block is gone rather than typed against a phantom shape, and the
    // options followed it (#4320). Datasource declaration and visibility live
    // in ADR-0062's DatasourceConnectionService +
    // `registerInMemory('datasource', …)` path — see DefaultDatasourcePlugin.
    start = async (ctx: PluginContext) => {
        ctx.logger.debug('Driver plugin started', { driverName: this.driver.name || 'unknown' });
    }
}
