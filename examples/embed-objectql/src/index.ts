// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Embedding the ObjectQL engine as a plain library (ADR-0076).
//
// This imports from `@objectstack/objectql/core` — the LEAN entry. It pulls the
// data engine (query/CRUD/hooks/validation) only: NO kernel, NO ObjectQLPlugin,
// and NOT `@objectstack/metadata-protocol` (the metadata-management layer).
// Ideal for a thin, latency-sensitive host (e.g. a gateway) that wants the
// engine and the *same* object definitions as the full platform, without the
// platform itself.
//
// The object below is an ordinary `ObjectSchema.create({...})` — the exact same
// shape you would ship in a `*.object.ts` to a full ObjectStack backend. One
// object model, two hosts; only the installed capability set differs.

import { ObjectQL } from '@objectstack/objectql/core';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { ObjectSchema, Field, type ServiceObject } from '@objectstack/spec/data';

export const Account = ObjectSchema.create({
  name: 'account',
  label: 'Account',
  pluralLabel: 'Accounts',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    industry: Field.text({ label: 'Industry' }),
    active: Field.boolean({ label: 'Active' }),
  },
});

export interface AccountRow {
  id: string;
  name: string;
  industry?: string;
  active?: boolean;
}

/** Boot a standalone engine, register one object, do CRUD, return active rows. */
export async function runEmbeddedEngine(): Promise<AccountRow[]> {
  const engine = new ObjectQL();
  engine.registerDriver(new InMemoryDriver({ persistence: false }), true);
  await engine.init();

  // Register the object directly — the registry lives in the core engine, so no
  // kernel/plugin/metadata-protocol is involved. (`ObjectSchema.create` is the
  // authoring shape; `registerObject` takes the canonical `ServiceObject`.)
  engine.registry.registerObject(Account as ServiceObject, 'example-embed');

  await engine.insert('account', { name: 'Acme', industry: 'Manufacturing', active: true });
  await engine.insert('account', { name: 'Globex', industry: 'Energy', active: false });
  await engine.insert('account', { name: 'Initech', industry: 'Software', active: true });

  return engine.find('account', {
    where: { active: true },
    orderBy: [{ field: 'name', order: 'asc' }],
  }) as Promise<AccountRow[]>;
}

// Allow `node`/`tsx`-style direct execution to print the result.
if (import.meta.url === `file://${process.argv[1]}`) {
  runEmbeddedEngine()
    .then((rows) => {
      // eslint-disable-next-line no-console
      console.log(`Active accounts (${rows.length}):`, rows.map((r) => r.name).join(', '));
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
