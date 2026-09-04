// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14486 — `FilesystemLoader.list()` reports only names the resolve trio can
 * open: one shared name-to-path derivation for `list()`, `findFile()` and
 * `loadManyKeyed()`.
 *
 * ---------------------------------------------------------------------------
 * The defect (measured on `origin/main` @ 23619f579, this fixture)
 * ---------------------------------------------------------------------------
 * `list()` reported `path.basename(file, ext)` for every file its glob found —
 * nested or not, with an extension or without — while `findFile()` resolved
 * `ROOT/TYPE/NAME` plus one of five hard-coded extensions. The two disagreed
 * for three shapes, and the disagreement reached consumers through
 * `MetadataManager.listNames()`, which unions loader `list()` output unfiltered:
 *
 *   ROOT/object/crm/account.json  -> listed as `account`; exists()=false
 *   ROOT/object/noext             -> listed as `noext`;   exists()=false
 *   ROOT/object/*.js (default set)-> listed and resolvable; never LOADED, and
 *                                    `load()` threw `No serializer found`
 *
 * A name in the list that `get()` answers `null` for is a silent failure: the
 * author (human or AI) reads it as their own typo and retries the same word.
 *
 * ---------------------------------------------------------------------------
 * The rule this pins (maintainer ruling on #14486, via the director seat,
 * 2026-09-02 — option A, narrow)
 * ---------------------------------------------------------------------------
 * `list()` reports a file only where this loader's derivation is a bijection
 * for it: directly under `ROOT/TYPE/`, carrying an extension one of this
 * INSTANCE's registered serializers claims. Rejected as option B was the
 * reverse-unify — teach `list()` to report `crm/account` and `findFile()` to
 * accept path-shaped names — which makes a slash inside a metadata name every
 * consumer's permanent obligation, with no measured demand for it.
 *
 * The extension set is the REGISTERED serializer set, deliberately NOT
 * ADR-0008 §10's `.json`-only rule: §10 governs the `metadata-fs` store, and
 * applying it verbatim here would silently drop `.yaml` and `.ts` metadata from
 * `listNames()` — a breakage this card never asked for. Under the manager's
 * default set (`typescript` / `json` / `yaml`) that leaves `.js` out, closing
 * the card's row-4 membership mismatch for free.
 *
 * ---------------------------------------------------------------------------
 * What the RECORD cases are for
 * ---------------------------------------------------------------------------
 * `RECORD:` cases pin behaviour this repair deliberately LEAVES ALONE, so the
 * divergence that remains is visible in a diff rather than implicit. Both of
 * them are the same half of the ruling — "a file that does not fit is neither
 * listed NOR resolvable" — which could not be taken here: each would invert a
 * landed #14341 pin in `filesystem-loader-keyed-items.test.ts`, a file under a
 * concurrent claim (PR #14627) when this landed.
 *
 * `CONTROL:` cases pin the things that must NOT move, and one of them
 * (`javascript` registered) is the reverse verification that the narrowing
 * reads the registered set rather than a second hard-coded list.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MetadataFormat } from '@objectstack/spec/system';
import { MetadataManager } from '../metadata-manager.js';
import { FilesystemLoader } from './filesystem-loader.js';
import { JSONSerializer } from '../serializers/json-serializer.js';
import { YAMLSerializer } from '../serializers/yaml-serializer.js';
import { TypeScriptSerializer } from '../serializers/typescript-serializer.js';
import type { MetadataSerializer } from '../serializers/serializer-interface.js';

const TYPE = 'object';

/** The card's probe fixture, verbatim, plus a well-formed `.ts` module. */
const FIXTURE: Record<string, string> = {
  'flat.json': JSON.stringify({ name: 'flat', label: 'Flat' }),
  'dotted.config.json': JSON.stringify({ name: 'dotted.config' }),
  'yamlish.yaml': 'name: yamlish\n',
  'yamlish2.yml': 'name: yamlish2\n',
  'noext': JSON.stringify({ name: 'noext' }),
  // `.ts` carrying the `export const` pattern `TypeScriptSerializer` needs, and
  // a JSON-compatible object literal. The card's row 4 claimed `.ts` was never
  // loaded; that was the probe's fixture, not the loader — see the CONTROL.
  'scripted.ts': 'export const scripted = { "name": "scripted", "label": "Scripted" };\n',
  // Same pattern, `.js`: resolvable and listed before this repair, loadable by
  // nothing under the default format set.
  'jsonly.js': 'export const jsonly = { "name": "jsonly" };\n',
};

const NESTED: Record<string, string> = {
  'account.json': JSON.stringify({ name: 'account', label: 'Account' }),
  'nameless-nested.json': JSON.stringify({ label: 'Nameless nested' }),
};

/** Exactly the flat files carrying an extension the DEFAULT set registers. */
const LISTED_UNDER_DEFAULT_SET = ['dotted.config', 'flat', 'scripted', 'yamlish', 'yamlish2'];

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fsloader-reach-'));
  const typeDir = path.join(root, TYPE);
  await fs.mkdir(path.join(typeDir, 'crm'), { recursive: true });

  for (const [rel, body] of Object.entries(FIXTURE)) {
    await fs.writeFile(path.join(typeDir, rel), body, 'utf-8');
  }
  for (const [rel, body] of Object.entries(NESTED)) {
    await fs.writeFile(path.join(typeDir, 'crm', rel), body, 'utf-8');
  }
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** The manager's DEFAULT format set, exactly as `MetadataManager` builds it. */
function defaultSerializers(): Map<MetadataFormat, MetadataSerializer> {
  return new Map<MetadataFormat, MetadataSerializer>([
    ['json', new JSONSerializer()],
    ['yaml', new YAMLSerializer()],
    ['typescript', new TypeScriptSerializer('typescript')],
  ]);
}

function loader(): FilesystemLoader {
  return new FilesystemLoader(root, defaultSerializers());
}

/** A cold manager — empty registry, one filesystem loader answering. */
function coldManager(): MetadataManager {
  const manager = new MetadataManager({ formats: ['typescript', 'json', 'yaml'], loaders: [] });
  manager.registerLoader(loader());
  return manager;
}

describe('#14486 FilesystemLoader.list() reports only names findFile() resolves', () => {
  it('lists exactly the flat files carrying a registered extension', async () => {
    expect((await loader().list(TYPE)).sort()).toEqual(LISTED_UNDER_DEFAULT_SET);
  });

  it('EVERY listed name resolves through findFile(), stat() and load()', async () => {
    // The bijection claim itself. Before the repair `account`, `nameless-nested`
    // and `noext` were listed and answered `false` / `null` / `null` here.
    const fsLoader = loader();

    for (const name of await fsLoader.list(TYPE)) {
      expect(await fsLoader.exists(TYPE, name)).toBe(true);
      expect(await fsLoader.stat(TYPE, name)).not.toBeNull();
      expect((await fsLoader.load(TYPE, name)).data).not.toBeNull();
    }
  });

  it('a NESTED file is no longer listed under its bare basename', async () => {
    const listed = await loader().list(TYPE);

    expect(listed).not.toContain('account');
    expect(listed).not.toContain('nameless-nested');
  });

  it('an EXTENSION-LESS file is no longer listed', async () => {
    expect(await loader().list(TYPE)).not.toContain('noext');
  });

  it('a .js file leaves list() under the default set — row 4, closed for free', async () => {
    // Not a rule about `.js`: it is the extension set following the REGISTERED
    // serializers. Under the default set nothing can deserialize `javascript`,
    // so the file is now neither listed nor resolvable instead of being listed,
    // resolvable, and unloadable.
    const fsLoader = loader();

    expect(await fsLoader.list(TYPE)).not.toContain('jsonly');
    expect(await fsLoader.exists(TYPE, 'jsonly')).toBe(false);
  });

  it('CONTROL: registering `javascript` puts the .js file back, listed AND loadable', async () => {
    // The reverse verification: the narrowing reads this instance's serializer
    // map, not a second hard-coded extension list.
    const serializers = defaultSerializers();
    serializers.set('javascript', new TypeScriptSerializer('javascript'));
    const fsLoader = new FilesystemLoader(root, serializers);

    expect(await fsLoader.list(TYPE)).toContain('jsonly');
    expect(await fsLoader.exists(TYPE, 'jsonly')).toBe(true);
    expect((await fsLoader.load(TYPE, 'jsonly')).data).toEqual({ name: 'jsonly' });
  });

  it('CONTROL: .yaml AND .yml both survive — §10 governs metadata-fs, not this set', async () => {
    const listed = await loader().list(TYPE);

    expect(listed).toContain('yamlish');
    expect(listed).toContain('yamlish2');
  });

  it('CONTROL: only the final extension is stripped, so dotted.config.json lists as dotted.config', async () => {
    expect(await loader().list(TYPE)).toContain('dotted.config');
  });

  it('CONTROL: a well-formed .ts module loads — the card row-4 `.ts` claim was its fixture', async () => {
    // Re-measured as triage required: `TypeScriptSerializer` is registered under
    // the default set and deserializes an `export const` module whose object
    // literal is JSON-compatible. The card's probe missed because its `.ts`
    // fixture was not that, and `load()` threw where `loadMany()` drops silently.
    expect((await loader().load(TYPE, 'scripted')).data).toEqual({
      name: 'scripted',
      label: 'Scripted',
    });
  });
});

describe('#14486 the repair reaches MetadataManager', () => {
  it('listNames() and get() give the same answer for every name', async () => {
    const manager = coldManager();

    for (const name of await manager.listNames(TYPE)) {
      expect(await manager.get(TYPE, name)).toBeDefined();
    }
  });

  it('the unresolvable names are gone from listNames()', async () => {
    const names = await coldManager().listNames(TYPE);

    expect(names.sort()).toEqual(LISTED_UNDER_DEFAULT_SET);
  });

  it('get() still answers undefined for the shapes that stopped being listed', async () => {
    const manager = coldManager();

    expect(await manager.get(TYPE, 'account')).toBeUndefined();
    expect(await manager.get(TYPE, 'noext')).toBeUndefined();
  });
});

describe('#14486 RECORD: the half of the ruling this PR could not take', () => {
  it('RECORD: loadMany() still returns bodies for files list() no longer names', async () => {
    // The ruling also pinned "nothing unlisted is returned by `loadMany()`
    // either". Filtering the shared walk would invert three landed #14341 pins
    // — `filesystem-loader-keyed-items.test.ts:113`, `:167`, `:187` — and its
    // `loadMany()` CONTROL at `:196` ("with every file", length 7), in a file
    // held by a concurrent claim (PR #14627). Recorded, not repaired.
    const bodies = await loader().loadMany<{ name?: string; label?: string }>(TYPE);

    expect(bodies).toContainEqual({ name: 'account', label: 'Account' });
    expect(bodies).toContainEqual({ name: 'noext' });
    // ...and the `.js` file is still absent, for the row-4 reason: no serializer.
    expect(bodies.some(body => body.name === 'jsonly')).toBe(false);
  });

  it('RECORD: a path-shaped name still resolves, though nothing lists it', async () => {
    // The other half of "neither listed NOR resolvable". Refusing a separator in
    // `findFile()` would invert `filesystem-loader-keyed-items.test.ts:175`, and
    // `save()` would still CREATE nested files (it mkdir -p's the name's
    // dirname), so the write side would have to narrow in the same stroke.
    const fsLoader = loader();

    expect(await fsLoader.exists(TYPE, path.join('crm', 'account'))).toBe(true);
    expect(await fsLoader.list(TYPE)).not.toContain(path.join('crm', 'account'));
  });
});
