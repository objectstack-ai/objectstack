// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from '@objectstack/core';
import { NodeHttpServer } from './adapter.js';

export interface NodeServerPluginOptions {
    /** Port to listen on. `0` requests an OS-assigned free port. @default 3000 */
    port?: number;
    /** Drain window (ms) for graceful close. @default 10000 */
    drainTimeoutMs?: number;
}

/**
 * NodeServerPlugin — registers a {@link NodeHttpServer} as the kernel's
 * `http.server` service, exactly like `HonoServerPlugin` does for Hono.
 *
 * Deliberately thin (ADR-0076 D11 / OQ#10, #2462): no CORS, no static/SPA
 * mounts, no standard-endpoint fallbacks, no Server-Timing. Its job is to be
 * the *second* adapter behind the transport port so the framework's route
 * consumers (dispatcher bridge, REST generator) are validated against a
 * non-Hono `IHttpServer`. Production deployments should keep using
 * `plugin-hono-server`; this adapter targets embedding scenarios and the
 * multi-adapter conformance suite.
 */
export class NodeServerPlugin implements Plugin {
    name = 'com.objectstack.server.node';
    type = 'server';
    version = '0.1.0';

    private server: NodeHttpServer;

    constructor(private options: NodeServerPluginOptions = {}) {
        this.server = new NodeHttpServer(options.port ?? 3000, options.drainTimeoutMs);
    }

    init = async (ctx: PluginContext) => {
        // Same service names as the primary adapter, so every consumer that
        // resolves 'http.server' / 'http-server' works unchanged.
        ctx.registerService('http.server', this.server);
        ctx.registerService('http-server', this.server);
        ctx.logger.debug('Node HTTP server service registered', { serviceName: 'http.server' });
    };

    start = async (ctx: PluginContext) => {
        await this.server.listen(this.options.port ?? 3000);
        ctx.logger.info('Node HTTP server started', {
            port: this.server.getPort(),
            url: `http://localhost:${this.server.getPort()}`,
        });
    };

    async destroy() {
        await this.server.close();
    }
}
