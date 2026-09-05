// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14921 — two files sharing one stem are REFUSED, never resolved by
 * extension precedence.
 *
 * ---------------------------------------------------------------------------
 * The defect (measured on `origin/main` @ c463d03e0, this fixture)
 * ---------------------------------------------------------------------------
 * `FilesystemLoader` derives a name by stripping a flat file's extension, and
 * resolves a name back under a FIXED precedence (`.json` → `.yaml` → `.yml` →
 * `.ts` → `.js`). With `object/twin.json` and `object/twin.yaml` both present:
 *
 *   twin occurrences in list(): 2      <- one name, listed twice
 *   twin resolves to          : twin.json
 *
 * So `twin.yaml` was counted in the list and addressable through no name at
 * all, and `loadMany()` returned BOTH bodies. `MetadataManager.listNames()`
 * unions loader output into a `Set`, which collapses the duplicate and takes
 * the count discrepancy with it — the file stayed unreachable either way, so a
 * clean-looking `listNames()` was never evidence the problem was absorbed.
 *
 * The invariant that broke, in one line: **what is listed is what is
 * loadable.** The listed set and the addressable set stopped being the same
 * set.
 *
 * ---------------------------------------------------------------------------
 * The rule this pins (maintainer ruling on #14921, via the director seat,
 * 2026-09-05 — option 1 of three, verbatim 「同意」)
 * ---------------------------------------------------------------------------
 * Two files sharing a stem across the REGISTERED extensions is an authoring
 * error, refused at list time with both paths and the type named, never served
 * by precedence. Not taken: option 2 (keep the precedence, log at `warn` — with
 * zero instances in any measured tree nobody reads that log, and the invariant
 * stays broken) and option 3 (make the extension part of the name for the
 * non-first file — a naming rule invented for an error state).
 *
 * ---------------------------------------------------------------------------
 * The three pins the ruling requires
 * ---------------------------------------------------------------------------
 *   PIN 1  the duplicate is refused, with BOTH paths named
 *   PIN 2  a single file per stem is still listed AND loadable
 *   PIN 3  the `loadMany()` two-body symptom is gone
 *
 * `CONTROL:` cases pin what must NOT move — chiefly that the refusal reads
 * THIS instance's registered serializer set rather than a second hard-coded
 * extension list, that it covers exactly the flat/resolvable domain `list()`
 * reports, and that a storage OUTAGE still degrades at the manager seams
 * instead of being swept up by the new rethrow.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MetadataFormat, MetadataLoaderContract, MetadataStats } from '@objectstack/spec/system';
import { MetadataManager } from '../metadata-manager.js';
import { FilesystemLoader } from './filesystem-loader.js';
import type { MetadataLoader } from './loader-interface.js';
import {
  AmbiguousMetadataStemError,
  isAmbiguousMetadataStemError,
  AMBIGUOUS_METADATA_STEM_CODE,
  AMBIGUOUS_METADATA_STEM_STATUS,
} from './ambiguous-metadata-stem.js';
import { JSONSerializer } from '../serializers/json-serializer.js';
import { YAMLSerializer } from '../serializers/yaml-serializer.js';
import { TypeScriptSerializer } from '../serializers/typescript-serializer.js';
import type { MetadataSerializer } from '../serializers/serializer-interface.js';

const TYPE = 'object';

/** The card's probe fixture, verbatim, plus the shapes the CONTROLs need. */
const AMBIGUOUS: Record<string, string> = {
  'twin.json': JSON.stringify({ name: 'twin-json' }),
  'twin.yaml': 'name: twin-yaml\n',
};

/**
 * One file per stem, three registered extensions — the tree PIN 2 proves is
 * untouched. Kept in its own root: the refusal is per type directory, so a
 * collision anywhere in `object/` would take these down with it and PIN 2 would
 * be testing nothing.
 */
const CLEAN: Record<string, string> = {
  'solo.json': JSON.stringify({ name: 'solo', label: 'Solo' }),
  'alpha.yaml': 'name: alpha\n',
  'beta.ts': 'export const beta = { "name": "beta" };\n',
};

/** `.js` is NOT in the manager's default format set — see the CONTROL pair. */
const REGISTERED_SET_PROBE: Record<string, string> = {
  'dual.json': JSON.stringify({ name: 'dual-json' }),
  'dual.js': 'export const dual = { "name": "dual-js" };\n',
};

let ambiguousRoot: string;
let cleanRoot: string;
let probeRoot: string;

beforeAll(async () => {
  ambiguousRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fsloader-ambig-'));
  cleanRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fsloader-clean-'));
  probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fsloader-probe-'));

  const ambiguousDir = path.join(ambiguousRoot, TYPE);
  await fs.mkdir(ambiguousDir, { recursive: true });
  for (const [rel, body] of Object.entries(AMBIGUOUS)) {
    await fs.writeFile(path.join(ambiguousDir, rel), body, 'utf-8');
  }
  // A SECOND type directory under the same root, deliberately clean: the
  // refusal is scoped to the directory that holds the collision.
  await fs.mkdir(path.join(ambiguousRoot, 'view'), { recursive: true });
  await fs.writeFile(
    path.join(ambiguousRoot, 'view', 'ok.json'),
    JSON.stringify({ name: 'ok' }),
    'utf-8',
  );

  const cleanDir = path.join(cleanRoot, TYPE);
  await fs.mkdir(path.join(cleanDir, 'crm'), { recursive: true });
  for (const [rel, body] of Object.entries(CLEAN)) {
    await fs.writeFile(path.join(cleanDir, rel), body, 'utf-8');
  }
  // Nested twin of a FLAT name. Not a collision: a nested file is neither
  // listed nor resolvable (#14486), so it derives no name to collide with.
  await fs.writeFile(
    path.join(cleanDir, 'crm', 'solo.json'),
    JSON.stringify({ name: 'nested-solo' }),
    'utf-8',
  );

  const probeDir = path.join(probeRoot, TYPE);
  await fs.mkdir(probeDir, { recursive: true });
  for (const [rel, body] of Object.entries(REGISTERED_SET_PROBE)) {
    await fs.writeFile(path.join(probeDir, rel), body, 'utf-8');
  }
});

afterAll(async () => {
  for (const root of [ambiguousRoot, cleanRoot, probeRoot]) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

/** The manager's DEFAULT format set, exactly as `MetadataManager` builds it. */
function defaultSerializers(): Map<MetadataFormat, MetadataSerializer> {
  return new Map<MetadataFormat, MetadataSerializer>([
    ['json', new JSONSerializer()],
    ['yaml', new YAMLSerializer()],
    ['typescript', new TypeScriptSerializer('typescript')],
  ]);
}

const loaderFor = (root: string): FilesystemLoader =>
  new FilesystemLoader(root, defaultSerializers());

/** A cold manager — empty registry, one filesystem loader answering. */
function coldManager(root: string): MetadataManager {
  const manager = new MetadataManager({ formats: ['typescript', 'json', 'yaml'], loaders: [] });
  manager.registerLoader(loaderFor(root));
  return manager;
}

/** Reject-or-null, so the thrown value itself can be asserted on. */
const caught = async (run: () => Promise<unknown>): Promise<unknown> =>
  run().then(() => null, (e: unknown) => e);

const twinJson = (): string => path.join(ambiguousRoot, TYPE, 'twin.json');
const twinYaml = (): string => path.join(ambiguousRoot, TYPE, 'twin.yaml');

describe('#14921 PIN 1 — the ambiguous stem is refused, with BOTH paths named', () => {
  it('list() throws the ADR-0112 envelope: code, status, and both paths + the type in the message', async () => {
    const error = await caught(() => loaderFor(ambiguousRoot).list(TYPE));

    // The envelope, not the throw: a bare `.toThrow()` would stay green against
    // any `Error` at all, including one thrown for a different reason.
    expect(isAmbiguousMetadataStemError(error)).toBe(true);
    expect((error as AmbiguousMetadataStemError).code).toBe(AMBIGUOUS_METADATA_STEM_CODE);
    expect((error as AmbiguousMetadataStemError).status).toBe(AMBIGUOUS_METADATA_STEM_STATUS);

    // The ruling's own words: "both paths and the type in the message".
    const message = (error as Error).message;
    expect(message).toContain(twinJson());
    expect(message).toContain(twinYaml());
    expect(message).toContain(TYPE);
  });

  it('the error carries both paths structurally, sorted — never just the precedence winner', async () => {
    const error = (await caught(() =>
      loaderFor(ambiguousRoot).list(TYPE),
    )) as AmbiguousMetadataStemError;

    expect(error.type).toBe(TYPE);
    expect(error.stem).toBe('twin');
    expect([...error.paths]).toEqual([twinJson(), twinYaml()].sort());
  });

  it('MetadataManager.listNames() PROPAGATES rather than absorbing', async () => {
    // The `Set` at this layer hides the DUPLICATE, never the unreachability —
    // so a clean-looking `listNames()` was the misreading the ruling names.
    const error = await caught(() => coldManager(ambiguousRoot).listNames(TYPE));

    expect(isAmbiguousMetadataStemError(error)).toBe(true);
  });

  it('MetadataManager.list() propagates too — the sibling plural read', async () => {
    // `admitLoaderItems()` refuses before contributing anything, so absorbing
    // here would answer with a `degraded` set missing EVERY item this loader
    // holds: an authoring error rendered as a storage outage.
    const error = await caught(() => coldManager(ambiguousRoot).list(TYPE));

    expect(isAmbiguousMetadataStemError(error)).toBe(true);
  });

  it('the refusal is scoped to the type directory that holds the collision', async () => {
    expect(await loaderFor(ambiguousRoot).list('view')).toEqual(['ok']);
  });
});

describe('#14921 PIN 2 — one file per stem is still listed AND loadable', () => {
  it('lists every flat file carrying a registered extension', async () => {
    expect((await loaderFor(cleanRoot).list(TYPE)).sort()).toEqual(['alpha', 'beta', 'solo']);
  });

  it('EVERY listed name still resolves through exists(), stat() and load()', async () => {
    const loader = loaderFor(cleanRoot);

    for (const name of await loader.list(TYPE)) {
      expect(await loader.exists(TYPE, name)).toBe(true);
      expect(await loader.stat(TYPE, name)).not.toBeNull();
      expect((await loader.load(TYPE, name)).data).not.toBeNull();
    }
  });

  it('the manager still lists and gets them', async () => {
    const manager = coldManager(cleanRoot);

    expect((await manager.listNames(TYPE)).sort()).toEqual(['alpha', 'beta', 'solo']);
    expect(await manager.get(TYPE, 'solo')).toEqual({ name: 'solo', label: 'Solo' });
  });

  it('CONTROL: a NESTED file sharing a flat name is not a collision', async () => {
    // `crm/solo.json` sits beside a flat `solo.json`. A nested file derives no
    // resolvable name at all (#14486), so there is nothing for it to collide
    // with — and treating basenames as the unit would refuse this good tree.
    const loader = loaderFor(cleanRoot);

    expect(await loader.list(TYPE)).toContain('solo');
    expect((await loader.load(TYPE, 'solo')).data).toEqual({ name: 'solo', label: 'Solo' });
  });
});

describe('#14921 PIN 3 — the loadMany() two-body symptom is gone', () => {
  it('loadMany() no longer answers with two bodies for one name', async () => {
    const bodies = await caught(() => loaderFor(ambiguousRoot).loadMany<{ name?: string }>(TYPE));

    // Refused, not silently de-duplicated: picking a winner here is option 2,
    // which the ruling declined — the loser would stay unreachable and the
    // listed set would stay different from the addressable one.
    expect(isAmbiguousMetadataStemError(bodies)).toBe(true);
    expect(Array.isArray(bodies)).toBe(false);
  });

  it('loadManyKeyed() refuses on the same walk', async () => {
    const keyed = await caught(() => loaderFor(ambiguousRoot).loadManyKeyed(TYPE));

    expect(isAmbiguousMetadataStemError(keyed)).toBe(true);
  });

  it('a `limit` cannot buy a caller past the refusal', async () => {
    // The check runs over the whole matched set, before `limit` truncates, so
    // whether a tree is refused never depends on how much was asked for.
    const bodies = await caught(() => loaderFor(ambiguousRoot).loadMany(TYPE, { limit: 1 }));

    expect(isAmbiguousMetadataStemError(bodies)).toBe(true);
  });

  it('CONTROL: loadMany() on the clean tree is unchanged', async () => {
    const bodies = await loaderFor(cleanRoot).loadMany<{ name?: string }>(TYPE);

    // Flat AND nested, exactly as before: this walk was never narrowed to the
    // listed set (#14486 RECORD), and this card does not narrow it either.
    expect(bodies.map(b => b.name).sort()).toEqual(['alpha', 'beta', 'nested-solo', 'solo']);
  });
});

describe('#14921 CONTROL — the refusal reads the REGISTERED extension set', () => {
  it('`dual.json` + `dual.js` is NOT ambiguous under the default set', async () => {
    // `.js` carries no registered serializer there, so it derives no name —
    // the same reason #14486 stopped listing it.
    const loader = loaderFor(probeRoot);

    expect(await loader.list(TYPE)).toEqual(['dual']);
    expect((await loader.load(TYPE, 'dual')).data).toEqual({ name: 'dual-json' });
  });

  it('registering `javascript` makes the SAME tree ambiguous — the reverse verification', async () => {
    // Nothing on disk changed. If the refusal read a second hard-coded
    // extension list instead of this instance's serializer map, this case
    // would answer identically to the one above.
    const serializers = defaultSerializers();
    serializers.set('javascript', new TypeScriptSerializer('javascript'));
    const loader = new FilesystemLoader(probeRoot, serializers);

    const error = await caught(() => loader.list(TYPE));

    expect(isAmbiguousMetadataStemError(error)).toBe(true);
    expect((error as AmbiguousMetadataStemError).stem).toBe('dual');
    expect([...(error as AmbiguousMetadataStemError).paths]).toEqual(
      [path.join(probeRoot, TYPE, 'dual.js'), path.join(probeRoot, TYPE, 'dual.json')].sort(),
    );
  });
});

/**
 * A loader whose reads fail the way a datasource fails: an `ECONNRESET` with no
 * ambiguous-stem brand on it.
 *
 * Hand-rolled rather than driven through `DatabaseLoader`, because the thing
 * under test is the DISCRIMINATION in the manager's two `catch` blocks, and
 * what makes a case sharp here is only that the thrown value is un-branded. A
 * real driver harness would add machinery without adding evidence.
 */
class OutageLoader implements MetadataLoader {
  readonly contract: MetadataLoaderContract = {
    name: 'outage',
    protocol: 'test:',
    capabilities: { read: true, write: false, watch: false, list: true },
    supportedFormats: ['json'],
    supportsWatch: false,
    supportsWrite: false,
    supportsCache: false,
  };

  private fail(): never {
    throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  }

  async load(): Promise<never> { this.fail(); }
  async loadMany(): Promise<never> { this.fail(); }
  async exists(): Promise<boolean> { return false; }
  async stat(): Promise<MetadataStats | null> { return null; }
  async list(): Promise<never> { this.fail(); }
}

describe('#14921 CONTROL — a storage OUTAGE still degrades, it is not swept up', () => {
  it('listNames() still absorbs an un-branded loader failure', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(new OutageLoader());

    // Degraded, exactly as #14423 left it: an array, short and served.
    expect(await manager.listNames(TYPE)).toEqual([]);
  });

  it('list() still absorbs it too, and still reports the read as degraded', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(new OutageLoader());

    const diagnosed = await manager.listDiagnosed(TYPE);

    expect(diagnosed.items).toEqual([]);
    expect(diagnosed.degraded).toBe(true);
  });
});
