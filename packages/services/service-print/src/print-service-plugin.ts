// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { FILE_ATTACHMENT_SERVICE, type IAuthService, type IFileAttachmentService } from '@objectstack/spec/contracts';
import { createChromiumDriver } from './chromium-driver.js';
import {
  describeEndpoint,
  resolvePrintPlacement,
  type PrintPlacementOptions,
  type PrintPlacementResolution,
} from './config.js';
import { principalSessionMinterOf } from './principal-session.js';
import { PrintService, type PrintEngine } from './print-service.js';

/** The service-registry slot the plugin registers {@link PrintService} under. */
export const PRINT_SERVICE = 'print' as const;

/** Plugin configuration: where the engine runs and where it loads the console from. */
export type PrintServicePluginOptions = PrintPlacementOptions;

/**
 * PrintServicePlugin — registers the `print` service.
 *
 * Composed explicitly: a deployment that prints lists this plugin, and one that
 * does not never loads a browser driver. It registers no route and no action;
 * the in-process service is its only door.
 *
 * Lifecycle:
 *   - `init`: read the placement (options, then `OS_PRINT_*`), build the
 *     driver for it, and register the service.
 *   - `start`: probe the engine — launch the local executable or connect to the
 *     remote endpoint, read its version, close — and say what it found, once.
 *     A ready engine logs its placement and Chromium version. An absent,
 *     misconfigured or unreachable engine logs a `warn` naming the
 *     consequence and the remedy, so a deployment learns it at boot and never
 *     at its first print. Printing is a capability, not a store: a missing
 *     engine makes the deployment visibly smaller and loses nothing, which is
 *     a `warn`.
 *   - `kernel:ready`: the services a print needs (the auth service's
 *     principal-session mint, `file-attachments`, the data engine)
 *     are registered by other plugins, so their absence is reported only once
 *     every plugin has started. `status()` reads them at call time either way.
 */
export class PrintServicePlugin implements Plugin {
  name = 'com.objectstack.service.print';
  providesServices = [PRINT_SERVICE];
  version = '1.0.0';
  type = 'standard' as const;

  private service?: PrintService;
  private placement?: PrintPlacementResolution;

  constructor(private readonly options: PrintServicePluginOptions = {}) {}

  async init(ctx: PluginContext): Promise<void> {
    const placement = resolvePrintPlacement(this.options, process.env);
    this.placement = placement;
    const driver = placement.state === 'configured' ? createChromiumDriver(placement.resolved) : null;
    const optional = <T>(name: string): T | undefined => {
      try {
        return ctx.getService<T>(name) ?? undefined;
      } catch {
        return undefined;
      }
    };
    this.service = new PrintService({
      placement,
      driver,
      getEngine: () => optional<PrintEngine>('objectql'),
      getAttachments: () => optional<IFileAttachmentService>(FILE_ATTACHMENT_SERVICE),
      getMinter: () => principalSessionMinterOf(optional<IAuthService>('auth')),
      logger: ctx.logger,
    });
    ctx.registerService(PRINT_SERVICE, this.service);
  }

  async start(ctx: PluginContext): Promise<void> {
    const { service, placement } = this;
    if (!service || !placement) return;
    if (placement.state === 'unconfigured') {
      ctx.logger.warn(`PrintServicePlugin: ${placement.reason}`);
      return;
    }
    if (placement.state === 'misconfigured') {
      ctx.logger.warn(`PrintServicePlugin: printing is off until this is fixed — ${placement.reason}`);
      return;
    }
    const { resolved } = placement;
    const where =
      resolved.placement === 'local'
        ? `local executable ${resolved.target}`
        : `remote endpoint ${describeEndpoint(resolved.target)}`;
    await service.probe();
    const probed = service.status();
    if (probed.version === undefined) {
      ctx.logger.warn(`PrintServicePlugin: printing is off until this is fixed — ${probed.reason}`);
      return;
    }
    ctx.logger.info(`PrintServicePlugin: Chromium ${probed.version} on the ${where}; console at ${resolved.consoleUrl}`);
    ctx.hook('kernel:ready', async () => {
      const ready = service.status();
      if (ready.state !== 'ready') {
        ctx.logger.warn(`PrintServicePlugin: printing is off until this is fixed — ${ready.reason}`);
      }
    });
  }

  async destroy(): Promise<void> {
    this.service = undefined;
    this.placement = undefined;
  }
}
