// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// One name, one holder for positions and permission sets, on the cold boot
// (ADR-0048 addendum N.3; maintainer ruling letter A on #22307, record
// 6063176077): a package-held name the environment catalog already holds
// refuses the boot, as it refuses a hot install. Over the real composition,
// restarted on one database file.
//
// ## Why the cold boot needed its own check
//
// A boot registers every package in the kernel's first phase, through the
// package door, and hydrates the environment catalog from `sys_metadata` in its
// second (`ObjectQLPlugin.start`). The door therefore could not see an
// environment-held name at a cold boot: the stored row hydrated over the
// package's definition with a `[Registry] Collision` warning, and served in its
// place. The same package hot-installed was refused (`422`, holder
// `environment`). Measured on `origin/main` 28bff18d0c with the same steps, in a
// probe that was not committed: the cold boot came up, with two collision
// warnings, and the by-name read answered the environment's definitions. With
// the check ablated, this file's two refusal cases go red and its two controls
// stay green.
//
// The engine plugin now judges every package-held position and permission-set
// name against the environment's items right after hydration, and refuses the
// boot with the door's envelope, naming both holders. The refusal leaves
// `start()`, so the kernel wraps it; the envelope is the wrapper's `cause`.
//
// ## The cases
//
//  - an environment-saved permission set and position, then a package declaring
//    both: the hot install is refused, and so is the cold boot;
//  - a row saved over a package-held name before the packaged locks: the save
//    door refuses that write now, so the row is written at the driver the way
//    an older release left it, and the restart is refused;
//  - CONTROL: stored definitions under two built-in position names — the
//    platform's own declaration sits beside them (ADR-0005), and the restart
//    boots;
//  - CONTROL: a package whose names the environment does not hold boots on a
//    database whose environment holds others, and restarts.
//
// Each case boots its own database file, in a directory of its own directly
// under the system temp directory. A refused boot leaves no kernel to stop, but
// its directory can still be removed, so this file removes every directory it
// created in its `afterAll`, once `afterEach` has stopped the last kernel. The
// harness leaves a `databaseFile`'s lifetime to its caller.
//
// The base is spelled `join(tmpdir(), ...)` on purpose: the tree's
// scratch-directory scan must be able to read every `mkdtempSync` base
// (`scripts/pm/dispatch-gates.mjs`, "no mkdtempSync site in this tree takes a
// base the scan cannot read"), and `process.cwd()` is not a base it reads.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeStacks, defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { NAMESPACE_CONFLICT_CODE } from '@objectstack/objectql';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { context: { isSystem: true } } as const;
const BOOT_TIMEOUT = 300_000;

const BASE_ID = 'com.dogfood.coldbootbase';
const ADDON_ID = 'com.dogfood.coldbootaddon';
const SET = 'coldboot_env_set';
const POSITION = 'coldboot_env_position';

const manifestOf = (id: string, namespace: string) => ({
  id, namespace, version: '0.0.1', type: 'app' as const, name: id, engines: { protocol: '^17' },
});

const Note = ObjectSchema.create({
  name: 'coldbootbase_note',
  label: 'Cold Boot Note',
  pluralLabel: 'Cold Boot Notes',
  fields: { title: Field.text({ label: 'Title', maxLength: 80 }) },
});

/** The deployment's app, declaring no catalog name. */
const baseApp = defineStack({ manifest: manifestOf(BASE_ID, 'coldbootbase'), objects: [Note] } as any);

/** A package declaring one permission set and one position. */
const addon = (set: string, position: string) =>
  defineStack({
    manifest: manifestOf(ADDON_ID, 'coldbootaddon'),
    permissions: [{ name: set, label: 'Shipped by the package', objects: {} }],
    positions: [{ name: position, label: 'Shipped by the package' }],
  } as any);

/** The deployment with the package added to its configuration. */
const withAddon = (set: string, position: string) =>
  composeStacks([baseApp, addon(set, position)] as any, { manifest: 'preserve' } as any);

type Envelope = Error & {
  code?: string;
  status?: number;
  conflicts?: Array<{ catalogType: string; name: string; incomingPackageId: string; existingHolder: unknown }>;
};

/** A boot's refusal, unwrapped from the kernel's `start()` wrapper — or `undefined` and the stack. */
async function bootOrRefusal(config: unknown, databaseFile: string): Promise<{ refusal?: Envelope; stack?: VerifyStack }> {
  try {
    return { stack: await bootStack(config, { databaseFile }) };
  } catch (e) {
    return { refusal: ((e as { cause?: unknown }).cause ?? e) as Envelope };
  }
}

const environmentConflicts = (set: string, position: string) => [
  { catalogType: 'position', name: position, incomingPackageId: ADDON_ID, existingHolder: { kind: 'environment' } },
  { catalogType: 'permission', name: set, incomingPackageId: ADDON_ID, existingHolder: { kind: 'environment' } },
];

/** Every directory `databaseFile()` created; the `afterAll` below removes them (see the header). */
const createdRoots: string[] = [];

/** A fresh database file in a directory of its own under the system temp directory (see the header). */
const databaseFile = () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-cold-boot-'));
  createdRoots.push(root);
  return join(root, 'deployment.db');
};

describe('ADR-0048 N.3: a package-held position or permission-set name the environment catalog holds refuses the cold boot, as it refuses a hot install', () => {
  let stack: VerifyStack | undefined;
  afterEach(async () => {
    await stack?.stop();
    stack = undefined;
  });
  afterAll(() => {
    for (const root of createdRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  // The built-in control saves under two built-in position names, which the
  // platform's package registers, so the save needs the documented hatch. The
  // protocol reads `OS_METADATA_WRITABLE` ONCE per process and memoises it, so
  // it is set for the whole file, before the first boot: set inside the one
  // case, a save in an earlier case would already have memoised it closed. No
  // other case depends on it: a new position name saves without it, and the
  // packaged permission-set lock refuses its save with or without it.
  let previousWritable: string | undefined;
  beforeAll(() => {
    previousWritable = process.env.OS_METADATA_WRITABLE;
    process.env.OS_METADATA_WRITABLE = 'position';
  });
  afterAll(() => {
    if (previousWritable === undefined) delete process.env.OS_METADATA_WRITABLE;
    else process.env.OS_METADATA_WRITABLE = previousWritable;
  });

  it('environment-saved names, then a package declaring both: the hot install is refused, and so is the cold boot, naming both holders', async () => {
    const db = databaseFile();
    stack = await bootStack(baseApp, { databaseFile: db });
    const token = await stack.signIn();
    const savedSet = await stack.apiAs(token, 'PUT', `/meta/permission/${SET}`, { name: SET, label: 'Saved in the environment', objects: {} });
    expect(savedSet.status, JSON.stringify(await savedSet.clone().json().catch(() => ({})))).toBe(200);
    const savedPosition = await stack.apiAs(token, 'PUT', `/meta/position/${POSITION}`, { name: POSITION, label: 'Saved in the environment' });
    expect(savedPosition.status, JSON.stringify(await savedPosition.clone().json().catch(() => ({})))).toBe(200);

    // The hot install: the engine door every install path reaches.
    const manifest = await stack.kernel.getServiceAsync<{ register(m: unknown): Promise<void> | void }>('manifest');
    let hot: Envelope | undefined;
    try {
      await manifest.register({
        ...manifestOf(ADDON_ID, 'coldbootaddon'),
        permissions: [{ name: SET, label: 'Shipped by the package', objects: {} }],
        positions: [{ name: POSITION, label: 'Shipped by the package' }],
      });
    } catch (e) {
      hot = e as Envelope;
    }
    expect(hot?.code).toBe(NAMESPACE_CONFLICT_CODE);
    expect(hot?.status).toBe(422);
    expect(hot?.conflicts).toEqual(environmentConflicts(SET, POSITION));
    await stack.stop();
    stack = undefined;

    // The cold boot with the package in the configuration.
    const { refusal, stack: booted } = await bootOrRefusal(withAddon(SET, POSITION), db);
    stack = booted;
    expect(refusal, 'the cold boot was refused').toBeDefined();
    expect(refusal!.code).toBe(NAMESPACE_CONFLICT_CODE);
    expect(refusal!.status).toBe(422);
    expect(refusal!.conflicts).toEqual(environmentConflicts(SET, POSITION));
  }, BOOT_TIMEOUT);

  it('a row saved over a package-held name before the packaged locks refuses the restart, naming both holders', async () => {
    const set = 'coldboot_legacy_set';
    const position = 'coldboot_legacy_position';
    const db = databaseFile();
    stack = await bootStack(withAddon(set, position), { databaseFile: db });
    const token = await stack.signIn();
    // The save door refuses the write now (the packaged locks)...
    const locked = await stack.apiAs(token, 'PUT', `/meta/permission/${set}`, { name: set, label: 'Over the package', objects: {} });
    expect(locked.status).toBe(403);
    // ...so the rows are written the way an older release left them: active,
    // environment-wide, bound to no package.
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    const now = new Date().toISOString();
    for (const [type, name, body] of [
      ['permission', set, { name: set, label: 'Saved before the lock', objects: {} }],
      ['position', position, { name: position, label: 'Saved before the lock' }],
    ] as const) {
      await ql.insert('sys_metadata', {
        type, name, organization_id: null, package_id: null, state: 'active', version: 1, checksum: null,
        created_at: now, updated_at: now, metadata: JSON.stringify(body),
      }, SYS);
    }
    await stack.stop();
    stack = undefined;

    const { refusal, stack: booted } = await bootOrRefusal(withAddon(set, position), db);
    stack = booted;
    expect(refusal, 'the restart was refused').toBeDefined();
    expect(refusal!.code).toBe(NAMESPACE_CONFLICT_CODE);
    expect(refusal!.status).toBe(422);
    expect(refusal!.conflicts).toEqual(environmentConflicts(set, position));
  }, BOOT_TIMEOUT);

  it('CONTROL — stored definitions under built-in position names: the restart boots, and the stored definition answers', async () => {
    const db = databaseFile();
    stack = await bootStack(baseApp, { databaseFile: db });
    const saveToken = await stack.signIn();
    for (const name of ['org_admin', 'everyone']) {
      const saved = await stack.apiAs(saveToken, 'PUT', `/meta/position/${name}`, { name, label: `Repurposed ${name}` });
      expect(saved.status, JSON.stringify(await saved.clone().json().catch(() => ({})))).toBe(200);
    }
    await stack.stop();
    stack = undefined;

    const { refusal, stack: booted } = await bootOrRefusal(baseApp, db);
    stack = booted;
    expect(refusal).toBeUndefined();
    const token = await stack!.signIn();
    const read = await stack!.apiAs(token, 'GET', '/meta/position/org_admin');
    expect(read.status).toBe(200);
    const body: any = await read.json();
    expect(body?.item?.label ?? body?.data?.label ?? body?.label).toBe('Repurposed org_admin');
  }, BOOT_TIMEOUT);

  it('CONTROL — a package whose names the environment does not hold boots beside the environment\'s, and restarts', async () => {
    const db = databaseFile();
    stack = await bootStack(baseApp, { databaseFile: db });
    const token = await stack.signIn();
    const saved = await stack.apiAs(token, 'PUT', `/meta/permission/${SET}`, { name: SET, label: 'Saved in the environment', objects: {} });
    expect(saved.status).toBe(200);
    await stack.stop();
    stack = undefined;

    for (const boot of ['first boot with the package', 'same-package restart']) {
      const { refusal, stack: booted } = await bootOrRefusal(withAddon('coldboot_other_set', 'coldboot_other_position'), db);
      stack = booted;
      expect(refusal, boot).toBeUndefined();
      const ql: any = await stack!.kernel.getServiceAsync('objectql');
      expect(ql.registry.getItem('permission', 'coldboot_other_set')?._packageId, boot).toBe(ADDON_ID);
      expect(ql.registry.getItem('permission', SET)?.label, boot).toBe('Saved in the environment');
      await stack!.stop();
      stack = undefined;
    }
  }, BOOT_TIMEOUT);
});
