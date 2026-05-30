// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import type { IHttpServer } from '@objectstack/spec/contracts';

/**
 * External Datasource Federation REST routes (ADR-0015 §6.2).
 *
 * Mounted under `/api/v1/datasources/:name/external/*` and served by the
 * `external-datasource` service. Every route degrades gracefully
 * (`503 external_service_unavailable`) when federation is not wired into the
 * host, so the routes are safe to register unconditionally.
 *
 *   GET  /datasources/:name/external/tables             → listRemoteTables
 *   POST /datasources/:name/external/tables/:remote/draft → generateObjectDraft
 *   POST /datasources/:name/external/refresh-catalog    → refreshCatalog
 *   POST /datasources/:name/external/validate           → validateAll (this ds)
 */
export function registerExternalDatasourceRoutes(
  server: IHttpServer,
  ctx: PluginContext,
  basePath = '/api/v1',
): void {
  const ext = `${basePath}/datasources/:name/external`;

  const externalService = (): any => {
    try {
      return ctx.getService<any>('external-datasource');
    } catch {
      return undefined;
    }
  };

  const unavailable = (res: any) =>
    res.status(503).json({ error: 'external_service_unavailable' });

  // List remote tables (optionally filtered by ?schema=).
  server.get(`${ext}/tables`, async (req: any, res: any) => {
    const svc = externalService();
    if (!svc?.listRemoteTables) return unavailable(res);
    const schema = typeof req.query?.schema === 'string' ? req.query.schema : undefined;
    const tables = await svc.listRemoteTables(req.params.name, { schema });
    res.json({ tables });
  });

  // Generate an Object draft (structured + *.object.ts source) from a table.
  server.post(`${ext}/tables/:remote/draft`, async (req: any, res: any) => {
    const svc = externalService();
    if (!svc?.generateObjectDraft) return unavailable(res);
    const draft = await svc.generateObjectDraft(
      req.params.name,
      req.params.remote,
      (req.body as Record<string, unknown>) ?? {},
    );
    res.json({ draft });
  });

  // Refresh and return the cached catalog snapshot.
  server.post(`${ext}/refresh-catalog`, async (req: any, res: any) => {
    const svc = externalService();
    if (!svc?.refreshCatalog) return unavailable(res);
    const catalog = await svc.refreshCatalog(req.params.name);
    res.json({ catalog });
  });

  // Validate the federated objects on this datasource.
  server.post(`${ext}/validate`, async (req: any, res: any) => {
    const svc = externalService();
    if (!svc?.validateAll) return unavailable(res);
    const report = await svc.validateAll();
    const results = (report.results ?? []).filter((r: any) => r.datasource === req.params.name);
    res.json({ ok: results.every((r: any) => r.ok), results });
  });
}
