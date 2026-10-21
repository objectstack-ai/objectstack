// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Give a lean test engine what every real `single` install has: an
 * organization object holding its Default Organization.
 *
 * ADR-0131 D1: a table the SQL driver creates carries its tenant column NOT
 * NULL. The engine stamps an organization-less system write with the derived
 * organization under `single` (D9) — but only where the composition registers
 * the organization object; a bare `ObjectQL` + `SqlDriver` registers none, so
 * the write reaches the database with no organization and is refused there.
 * A suite whose subject is not tenancy (claims, acks, idle cost, at-rest
 * shapes) calls this once its own objects are registered, so its system
 * writes land the way they do on a real install.
 *
 * The object mirrors the platform's: managed by better-auth, so it carries no
 * tenant column of its own.
 */
export const DEFAULT_ORGANIZATION_ID = 'org_default';

export async function installDefaultOrganization(engine: {
  registry: { registerObject(def: unknown, owner: string): unknown };
  getSchema(object: string): unknown;
  syncSchemas(): Promise<unknown>;
  getDriverForObject(object: string):
    | {
        create(object: string, data: Record<string, unknown>): Promise<unknown>;
        findOne(object: string, query: unknown): Promise<unknown>;
      }
    | undefined;
}): Promise<void> {
  // Idempotent: a suite that syncs one engine more than once may call it each time.
  if (!engine.getSchema('sys_organization')) {
    engine.registry.registerObject(
      { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } },
      '@objectstack/client',
    );
  }
  await engine.syncSchemas();
  // Seeded through the driver: the organization is data at rest, not a write
  // the suite under test should observe (an audit or activity mirror would).
  const driver = engine.getDriverForObject('sys_organization')!;
  if (await driver.findOne('sys_organization', { where: { id: DEFAULT_ORGANIZATION_ID } })) return;
  await driver.create('sys_organization', { id: DEFAULT_ORGANIZATION_ID, name: 'Default' });
}
