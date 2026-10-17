// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext, TenancyPostureSource } from '@objectstack/core';
import { classifyAdmissionTenancyPosture } from '@objectstack/core';
import {
  FILE_ATTACHMENT_SERVICE,
  type IAuthService,
  type IFileAttachmentService,
  type IHttpServer,
} from '@objectstack/spec/contracts';
import type { TenancyPosture } from '@objectstack/spec/security';
import { createChromiumDriver } from './chromium-driver.js';
import {
  describeConsoleUrl,
  describeEndpoint,
  resolvePrintPlacement,
  type PrintPlacementOptions,
  type PrintPlacementResolution,
} from './config.js';
import { principalSessionMinterOf } from './principal-session.js';
import { PRINT_RECORDS_ROUTE, registerPrintRoutes } from './print-routes.js';
import { PrintService, type PrintEngine } from './print-service.js';

/** The service-registry slot the plugin registers {@link PrintService} under. */
export const PRINT_SERVICE = 'print' as const;

/** Plugin configuration: where the engine runs and where it loads the console from. */
export type PrintServicePluginOptions = PrintPlacementOptions;

/**
 * PrintServicePlugin — registers the `print` service and its one HTTP door.
 *
 * Composed explicitly: a deployment that prints lists this plugin, and one that
 * does not never loads a browser driver. Two doors reach the service: the
 * in-process `print` service, and `POST /api/v1/print/records` on the
 * kernel's HTTP server (`print-routes.ts`), which a console action calls to
 * print the record it is on. The plugin registers no action: an app declares
 * one (a `type: 'api'` action whose `target` is that path).
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
 *     The door is mounted then too, on every path — an engine that is not
 *     configured is answered by the door as the service refuses it
 *     (`SERVICE_UNAVAILABLE` / `503`), never by an unmounted route. A kernel
 *     with no HTTP server mounts no door, and says so once.
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
    ctx.hook('kernel:ready', async () => this.mountDoor(ctx, service));
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
    ctx.logger.info(`PrintServicePlugin: Chromium ${probed.version} on the ${where}; console at ${describeConsoleUrl(resolved.consoleUrl)}`);
    ctx.hook('kernel:ready', async () => {
      const ready = service.status();
      if (ready.state !== 'ready') {
        ctx.logger.warn(`PrintServicePlugin: printing is off until this is fixed — ${ready.reason}`);
      }
    });
  }

  /**
   * Mount the print door on the kernel's HTTP server. Every service the door
   * reads is read per request, so a provider that registers after this hook is
   * still seen.
   */
  private mountDoor(ctx: PluginContext, service: PrintService): void {
    let http: IHttpServer | undefined;
    try {
      http = ctx.getService<IHttpServer>('http-server') ?? undefined;
    } catch {
      http = undefined;
    }
    if (!http) {
      ctx.logger.warn(
        `PrintServicePlugin: no HTTP server is registered, so the print door (POST ${PRINT_RECORDS_ROUTE}) is not ` +
          'mounted and a console action cannot print a record. The print service is still reachable in-process ' +
          '(kernel.getService("print")).',
      );
      return;
    }
    const optional = <T>(name: string): T | undefined => {
      try {
        return ctx.getService<T>(name) ?? undefined;
      } catch {
        return undefined;
      }
    };
    registerPrintRoutes(http, {
      print: service,
      getEngine: () => optional<unknown>('objectql'),
      getAuth: () => optional<IAuthService>('auth'),
      resolveTenancyPosture: () => resolveAdmissionTenancyPosture(ctx),
    });
    ctx.logger.info(`PrintServicePlugin: print door mounted at POST ${PRINT_RECORDS_ROUTE}`);
  }

  async destroy(): Promise<void> {
    this.service = undefined;
    this.placement = undefined;
  }
}

/**
 * The tenancy posture in force, for the door's admission (the resolver's two
 * posture-conditional API-key refusals). Read through the kernel's async
 * accessor, per request, and classified by the platform's one rule
 * (`classifyAdmissionTenancyPosture`): a `tenancy` service never registered is
 * a kernel with no organization wall, answered `undefined`; one that is
 * registered and cannot answer rejects, and the door answers that outage. A
 * host with no async accessor (a `LiteKernel`) registers no `tenancy` service
 * either, and is answered `undefined`.
 */
async function resolveAdmissionTenancyPosture(ctx: PluginContext): Promise<TenancyPosture | undefined> {
  const kernel = ctx.getKernel?.() as
    | { getServiceAsync?: <T>(name: string, scopeId?: string) => Promise<T> }
    | undefined;
  if (!kernel || typeof kernel.getServiceAsync !== 'function') return undefined;
  return classifyAdmissionTenancyPosture(() => kernel.getServiceAsync!<TenancyPostureSource>('tenancy'));
}
