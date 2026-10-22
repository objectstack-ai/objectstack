// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A fixture plugin that gives a served test boot what every real `single`
 * install has before its inline seed runs: an organization object holding the
 * Default Organization.
 *
 * ADR-0131 D1: a table the SQL driver creates carries its tenant column NOT
 * NULL. A real `os dev` / `os serve` composes authentication, which provisions
 * the Default Organization, and the engine stamps every organization-less seed
 * row with it (D9). `createStandaloneStack` alone composes no authentication,
 * so a suite that serves an artifact's seeds through it would have them refused
 * at the database. Spliced into the plugin list ahead of the app plugin (see
 * {@link withDefaultOrganization}), it starts after the default datasource and
 * before the app's `start()` seeds.
 *
 * The object mirrors the platform's: managed by better-auth, so it carries no
 * tenant column of its own; its row is seeded through the driver, as data at
 * rest.
 */
export const DEFAULT_ORGANIZATION_ID = 'org_default';

export function defaultOrganizationPlugin() {
  return {
    name: 'test.default-organization',
    version: '0.0.0',
    type: 'standard',
    dependencies: ['com.objectstack.runtime.default-datasource'],
    async init() {},
    async start(ctx: { getService(name: string): any }) {
      const ql = ctx.getService('objectql');
      if (!ql.getSchema('sys_organization')) {
        ql.registry.registerObject(
          { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } },
          'test.default-organization',
        );
      }
      await ql.syncObjectSchema('sys_organization');
      const driver = ql.getDriverForObject('sys_organization');
      if (await driver.findOne('sys_organization', { where: { id: DEFAULT_ORGANIZATION_ID } })) return;
      await driver.create('sys_organization', { id: DEFAULT_ORGANIZATION_ID, name: 'Default' });
    },
  };
}

/** The served plugin list with {@link defaultOrganizationPlugin} ahead of every app plugin. */
export function withDefaultOrganization<T>(plugins: readonly T[]): T[] {
  const out = [...plugins];
  const datasource = out.findIndex((p: any) => p?.name === 'com.objectstack.runtime.default-datasource');
  out.splice(datasource + 1, 0, defaultOrganizationPlugin() as T);
  return out;
}
