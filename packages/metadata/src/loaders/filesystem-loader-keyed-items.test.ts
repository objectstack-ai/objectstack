// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14341 — `FilesystemLoader.loadManyKeyed()`: a file-held item is keyed by the
 * name this loader can actually RESOLVE for it, and by nothing else.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * `loadMany()` globbed files and pushed bodies, throwing away the path it had
 * just read. `MetadataManager.admitLoaderItems()` then fell back to keying by
 * `body.name`, which drops every body that has no top-level `name` — the exact
 * #14205 failure, unrepaired for this loader. A `defineView` container has no
 * own `name` BY DESIGN, so a file holding one was absent from `list('view')`
 * while `listDiagnosed()` called the short answer complete.
 *
 * ---------------------------------------------------------------------------
 * The rule this pins (PM ruling on #14341, 2026-09-02 — option D)
 * ---------------------------------------------------------------------------
 * An item is keyed by this loader's own name-to-path derivation (the basename
 * minus extension, the same derivation `list()` reports) ONLY where that
 * derivation is a BIJECTION for the file — it sits directly under `ROOT/TYPE/`
 * and carries an extension `findFile()` tries, so `findFile(type, key)` resolves
 * back to that same file. Every other shape keeps the pre-#14205 behaviour
 * verbatim: keyed by `body.name` when it has one, dropped when it has none.
 *
 * The ruling was taken over triage's "a nested path keeps whatever `list()`
 * reports for it today", knowingly, because the two derivations DISAGREE
 * outside the flat shape (measured on `origin/main` @ 253da34c4): `list()`
 * reports `account` for `ROOT/TYPE/crm/account.json`, and `findFile()` resolves
 * that name against `ROOT/TYPE/account.json` and finds nothing. Keying nested
 * files by their basename would mint names `get()` / `load()` / `exists()`
 * cannot open, and two directories holding one basename would collide in
 * silence. The card's own fence: "keying items under names nothing else uses
 * ... is worse than today's honest drop".
 *
 * ---------------------------------------------------------------------------
 * What the RECORD cases are for
 * ---------------------------------------------------------------------------
 * `RECORD:` cases pin behaviour this ruling deliberately LEAVES ALONE — the
 * nested nameless file is still dropped. They exist so the derivation repair
 * (#14486: one shared name-to-path function for `list()`, `findFile()` and
 * `loadManyKeyed()`) inverts them deliberately, with the change visible in a
 * diff, instead of silently.
 *
 * `CONTROL:` cases are green in both directions and pin "nothing consumers see
 * today changes shape".
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MetadataFormat } from '@objectstack/spec/system';
import { MetadataManager } from '../metadata-manager.js';
import { FilesystemLoader } from './filesystem-loader.js';
import { JSONSerializer } from '../serializers/json-serializer.js';
import type { MetadataSerializer } from '../serializers/serializer-interface.js';

const TYPE = 'view';

/** The aggregated container shape: identity is the target object, no own `name`. */
const NAMELESS_CONTAINER = { object: 'account', views: [{ label: 'All' }] };

let root: string;

/**
 * One tree holding every shape the rule distinguishes. The two `crm/` files and
 * the extension-less one are the shapes where `list()` and `findFile()` disagree.
 */
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fsloader-keyed-'));
  const typeDir = path.join(root, TYPE);
  await fs.mkdir(path.join(typeDir, 'crm'), { recursive: true });

  const write = (rel: string, body: unknown) =>
    fs.writeFile(path.join(typeDir, rel), JSON.stringify(body), 'utf-8');

  await write('flat_nameless.json', NAMELESS_CONTAINER);
  await write('flat_named.json', { name: 'flat_named', label: 'agrees with its basename' });
  await write('flat_disagreeing.json', { name: 'not_the_basename', label: 'disagrees' });
  await write('dotted.config.json', { name: 'dotted.config' });
  await write(path.join('crm', 'nested_named.json'), { name: 'nested_named' });
  await write(path.join('crm', 'nested_nameless.json'), { ...NAMELESS_CONTAINER, object: 'lead' });
  await write('extensionless', { name: 'extensionless_named' });
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function loader(): FilesystemLoader {
  const serializers = new Map<MetadataFormat, MetadataSerializer>([
    ['json', new JSONSerializer()],
  ]);
  return new FilesystemLoader(root, serializers);
}

/** A cold manager — empty registry, one filesystem loader answering. */
function coldManager(): MetadataManager {
  const manager = new MetadataManager({ formats: ['json'], loaders: [] });
  manager.registerLoader(loader());
  return manager;
}

async function keys(): Promise<string[]> {
  const keyed = await loader().loadManyKeyed(TYPE);
  return keyed.map(entry => entry.name).sort();
}

describe('#14341 FilesystemLoader.loadManyKeyed() keys by the resolvable name', () => {
  it('keys a FLAT file by its basename, the derivation list() reports', async () => {
    expect(await keys()).toEqual(
      ['dotted.config', 'extensionless_named', 'flat_disagreeing', 'flat_named', 'flat_nameless', 'nested_named'],
    );
  });

  it('admits a flat NAMELESS body, keyed by the file name', async () => {
    // Pre-repair this body had no key at all and fell out of the merge.
    const keyed = await loader().loadManyKeyed(TYPE);
    const entry = keyed.find(item => item.name === 'flat_nameless');

    expect(entry).toBeDefined();
    expect(entry!.data).toEqual(NAMELESS_CONTAINER);
  });

  it('never synthesises a name into a body that deliberately has none', async () => {
    const keyed = await loader().loadManyKeyed(TYPE);
    const entry = keyed.find(item => item.name === 'flat_nameless')!;

    // The key travels BESIDE the body; the body stays byte-identical to disk,
    // so `assertMetadataRegisterContract`'s `data.name` check keeps its meaning.
    expect(Object.prototype.hasOwnProperty.call(entry.data as object, 'name')).toBe(false);
  });

  it('keys a flat file by its BASENAME even when body.name disagrees', async () => {
    // #14205's rule applied to this loader: identity is the key the store holds
    // the item under, not `body.name`. `flat_disagreeing.json` says
    // `name: 'not_the_basename'`, and the store's key is the file's.
    const keyed = await loader().loadManyKeyed(TYPE);

    expect(keyed.map(entry => entry.name)).toContain('flat_disagreeing');
    expect(keyed.map(entry => entry.name)).not.toContain('not_the_basename');
    // ...and the disagreeing body is handed back unedited.
    expect(keyed.find(entry => entry.name === 'flat_disagreeing')!.data).toEqual({
      name: 'not_the_basename',
      label: 'disagrees',
    });
  });

  it('strips only the final extension, so dotted.config.json keys as dotted.config', async () => {
    expect(await keys()).toContain('dotted.config');
  });

  it('EVERY key it mints resolves back to a file through findFile()', async () => {
    // The bijection claim itself, and the reason the disagreeing shapes below
    // are NOT keyed by their basename: a minted key that `exists()` cannot open
    // is exactly what the card refused.
    const fsLoader = loader();
    const derived = ['dotted.config', 'flat_disagreeing', 'flat_named', 'flat_nameless'];

    for (const key of derived) {
      expect(await fsLoader.exists(TYPE, key)).toBe(true);
    }
  });

  it('keys a NESTED file by body.name — the pre-#14205 behaviour, unchanged', async () => {
    // `list()` reports `nested_named` for it too, but `findFile()` resolves that
    // name against `ROOT/view/nested_named.json`, which does not exist: the
    // derivation is not a bijection here, so it is not used.
    const fsLoader = loader();

    expect(await keys()).toContain('nested_named');
    expect(await fsLoader.exists(TYPE, 'nested_named')).toBe(false);
    expect(await fsLoader.exists(TYPE, path.join('crm', 'nested_named'))).toBe(true);
  });

  it('RECORD: a nested NAMELESS file is still dropped — the honest drop, #14486', async () => {
    // Not a repair this ruling makes: there is no name for it that any other
    // door reports. #14486 (one shared name-to-path derivation) is where this
    // inverts, deliberately.
    const keyed = await loader().loadManyKeyed(TYPE);

    expect(keyed.some(entry => (entry.data as { object?: string }).object === 'lead')).toBe(false);
  });

  it('keys an EXTENSION-LESS file by body.name — findFile() cannot resolve it either', async () => {
    const fsLoader = loader();

    expect(await keys()).toContain('extensionless_named');
    // `findFile()` always appends one of its extensions, so the bare file name
    // resolves to nothing; keying by the basename would mint a dead name.
    expect(await fsLoader.exists(TYPE, 'extensionless')).toBe(false);
  });

  it('CONTROL: loadMany() still answers with bodies only, and with every file', async () => {
    // The shared walk behind both methods must not leak its envelope, and must
    // not start dropping what it read: `loadMany()`'s callers are untouched.
    const items = await loader().loadMany(TYPE);

    expect(items).toHaveLength(7);
    for (const item of items) {
      expect(Object.prototype.hasOwnProperty.call(item as object, 'file')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(item as object, 'data')).toBe(false);
    }
    expect(items).toContainEqual(NAMELESS_CONTAINER);
  });
});

describe('#14341 the repair reaches MetadataManager.list()', () => {
  it('a flat nameless body reaches list() end to end', async () => {
    const items = await coldManager().list(TYPE);

    expect(items).toContainEqual(NAMELESS_CONTAINER);
  });

  it('listDiagnosed() counts it and stays complete-and-not-degraded', async () => {
    const result = await coldManager().listDiagnosed(TYPE);

    // Nothing threw before the repair and nothing throws after — the loader
    // answered successfully both times. What changes is that the short answer
    // is no longer served as a full one.
    expect(result.degraded).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.items).toContainEqual(NAMELESS_CONTAINER);
  });

  it('CONTROL: a named body is still listed, and still only once', async () => {
    const items = await coldManager().list(TYPE);

    expect(items).toContainEqual({ name: 'flat_named', label: 'agrees with its basename' });
    expect(items.filter(item => (item as { name?: string }).name === 'flat_named')).toHaveLength(1);
  });

  it('RECORD: the nested nameless body is still absent from list()', async () => {
    const items = await coldManager().list(TYPE);

    expect(items.some(item => (item as { object?: string }).object === 'lead')).toBe(false);
  });
});
