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

import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// ─── entry guard ───────────────────────────────────────────────────────
// ⛔ NOT ``import.meta.url === `file://${process.argv[1]}` ``. Node symlink-resolves
// `import.meta.url` but leaves `process.argv[1]` exactly as the caller typed it, and
// the template also skips the percent-encoding `pathToFileURL` applies — so that
// spelling goes INERT (exit 0, no output) through a symlink AND on any checkout path
// containing a character that needs encoding (a `#` in a parent directory name is
// enough, with no symlink involved). Compare RESOLVED PATHS, never URL strings.
//
// Same predicate as `packages/cli/src/utils/invocation.ts` (`isProcessEntry`) and
// `scripts/invoked-as.mjs` (`invokedAs`). Spelled out rather than imported because
// neither home is legally reachable from this file — the PR for #10269 carries the
// boundary measurement. ⚠️ Two predicates answering this question differently IS the
// defect this closes; change one, change all of them.
function isProcessEntry(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) return false; // `node --eval` / the REPL
  const self = resolve(fileURLToPath(import.meta.url));
  const entry = resolve(entryArg);
  // `node <dir>` gives the ENTRY ARGUMENT, and only it, directory resolution.
  const candidates = [entry, join(entry, 'index.js'), join(entry, 'index.mjs'), join(entry, 'index.ts')];
  if (candidates.includes(self)) return true;
  const realSelf = realOrSelf(self);
  return candidates.some((candidate) => realOrSelf(candidate) === realSelf);
}

/** `realpathSync`, degrading to the input for a path that cannot be read. */
function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

if (isProcessEntry()) {
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
