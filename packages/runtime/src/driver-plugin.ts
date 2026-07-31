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
/**
 * ⚠️ Both options are INERT. They configured start()'s datasource
 * registration, which probed `metadata.addDatasource` — a method no metadata
 * service implements — so the guarded block never ran on any boot and was
 * removed when typing the lookup surfaced it (#4251). The one live caller
 * that passes them (`serve.ts`, `datasourceName: 'telemetry'`) has never
 * gotten the registration it asks for. Kept only for source compatibility;
 * revive-or-remove is tracked in #4320.
 */
export interface DriverPluginOptions {
    /**
     * If set, registers a named datasource so packages declaring
     * `defaultDatasource: '<name>'` resolve to this driver.
     */
    datasourceName?: string;
    /**
     * If `true` (default), registers this driver as the `default` datasource
     * when none exists. Set to `false` for proxy drivers (e.g. cloud proxy)
     * that should never become the default.
     */
    registerAsDefault?: boolean;
}

export class DriverPlugin implements Plugin {
    name: string;
    type = 'driver';
    version = '1.0.0';

    private driver: any;

    // Options are accepted (source compatibility for existing callers) but no
    // longer stored — nothing reads them since the dead datasource block left
    // start(); see the DriverPluginOptions doc.
    constructor(driver: any, driverNameOrOptions?: string | DriverPluginOptions, _options?: DriverPluginOptions) {
        this.driver = driver;
        const driverName = typeof driverNameOrOptions === 'string' ? driverNameOrOptions : undefined;
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
    // made every line behind it (and the options above) unreachable on every
    // boot. Typing the lookup (#4251) surfaced that; the dead block is gone
    // rather than typed against a phantom shape. Datasource declaration and
    // visibility live in ADR-0062's DatasourceConnectionService +
    // `registerInMemory('datasource', …)` path — see DefaultDatasourcePlugin.
    start = async (ctx: PluginContext) => {
        ctx.logger.debug('Driver plugin started', { driverName: this.driver.name || 'unknown' });
    }
}
