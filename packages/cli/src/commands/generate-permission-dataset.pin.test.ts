// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN: `os generate permission NAME` and `os generate dataset NAME` write a
 * permission set and an analytics dataset into the directories the blank
 * starter wires, each bound to an object the stack declares.
 *
 * ## What was measured before the rows existed
 *
 * On `origin/main` 5fa9375e, `os generate permission` and
 * `os generate dataset` each printed `Unknown type:` and exited 1, and the
 * blank starter wired no `src/security` or `src/datasets` barrel. An app that
 * real users sign in to needs a permission set, and a dashboard widget binds
 * to a dataset; both could be written only by hand, in a directory the author
 * also had to wire by hand.
 *
 * ## What this file holds, and what it leaves to the derived pins
 *
 * The roster facts the starter depends on — the type key, the directory, the
 * stack key — and the scaffold's own shape: it parses under the schema the
 * stack key carries, under the name `os g` reports it reached, and it names
 * the object it was bound to, never one derived from its own name. That every
 * scaffold passes `os validate`, `os build` and `os lint` with zero findings,
 * type-checks, and reaches the stack is held for the whole roster by
 * `test/generate-scaffold-validates.test.ts`,
 * `test/scaffold-emission-typechecks.test.ts` and
 * `test/generate-scaffolds-reach-stack.e2e.test.ts`; the blank starter's
 * wiring by `test/create-objectstack-wiring-parity.test.ts`.
 *
 * Every other fact is READ off the roster (`GENERATOR_SCAFFOLD_TARGETS`) and
 * the registry (`metadataFileName`).
 */

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleRequire } from 'bundle-require';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { DatasetSchema } from '@objectstack/spec/ui';
import { GENERATOR_SCAFFOLD_TARGETS, type ScaffoldObjectBinding } from './generate.js';
import { metadataFileName } from '../utils/metadata-file-name.js';
import { BUNDLE_REQUIRE_EXTERNALS } from '../utils/config.js';

const STEM = 'sales_user';

/** Deliberately NOT named like the item: a binding derived from the name would miss it. */
const TARGET: ScaffoldObjectBinding = {
  name: 'pin_account',
  label: 'Account',
  fields: ['name', 'industry'],
  displayField: 'name',
};

const target = (type: string) => GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === type);

/**
 * Inside this package's own `node_modules`, for the reason
 * `test/generate-scaffold-validates.test.ts` gives: git-ignored, and the
 * scaffold's `@objectstack/spec/*` import resolves from here exactly as it
 * would in an author's project.
 */
const TMP_ROOT = fs.mkdtempSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', '.generate-permission-dataset-pin-'),
);

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** Materialize a scaffold through the loader `os validate` uses. */
async function loadScaffold(type: string, object: ScaffoldObjectBinding): Promise<Record<string, unknown>> {
  const gen = target(type);
  if (!gen) throw new Error(`no \`${type}\` generator on the roster`);
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, `${type}-`));
  const file = path.join(dir, metadataFileName(type, STEM) ?? 'unnamed.ts');
  fs.writeFileSync(file, gen.generate(STEM, undefined, { object }), 'utf8');
  const { mod } = await bundleRequire({ filepath: file, external: BUNDLE_REQUIRE_EXTERNALS });
  return ((mod as { default?: unknown }).default ?? mod) as Record<string, unknown>;
}

describe('`os generate permission` and `os generate dataset` are on the roster, where the starter wires them', () => {
  it.each([
    ['permission', 'src/security', 'permissions'],
    ['dataset', 'src/datasets', 'datasets'],
  ])('%s scaffolds into %s, collected under the `%s` stack key', (type, dir, stackKey) => {
    const gen = target(type);
    expect(gen, `the \`${type}\` generator`).toBeDefined();
    expect(gen!.defaultDir).toBe(dir);
    expect(gen!.stackKey).toBe(stackKey);
    // Both bind an object the stack declares, from `--object` or the only one.
    expect(gen!.binds).toEqual({ object: 'flag' });
    expect(gen!.namesObject).toBe(true);
    expect(gen!.requires).toEqual([]);
  });

  it.each(['permission', 'dataset'])('writes NAME.%s.ts, the registry\'s own pattern for the kind', (type) => {
    expect(metadataFileName(type, STEM)).toBe(`${STEM}.${type}.ts`);
  });
});

describe('the permission scaffold is a set that grants the bound object', () => {
  it('parses as a permission set named what `os g` reports it reached', async () => {
    const set = await loadScaffold('permission', TARGET);
    expect(PermissionSetSchema.safeParse(set).success).toBe(true);
    expect(set.name).toBe(target('permission')!.itemName(STEM));
  });

  it('grants the bound object, and only it, without delete', async () => {
    const set = await loadScaffold('permission', TARGET);
    expect(Object.keys(set.objects as object)).toEqual([TARGET.name]);
    expect((set.objects as Record<string, Record<string, unknown>>)[TARGET.name]).toMatchObject({
      allowRead: true,
      allowCreate: true,
      allowEdit: true,
      allowDelete: false,
      // The read depth is declared, not left to the object's sharing model.
      readScope: 'own',
    });
    // Never bound to every signed-in user by the scaffold.
    expect(set.isDefault).toBe(false);
  });
});

describe('the dataset scaffold is a dataset over the bound object', () => {
  it('parses as a dataset named what `os g` reports it reached, over the bound object', async () => {
    const dataset = await loadScaffold('dataset', TARGET);
    expect(DatasetSchema.safeParse(dataset).success).toBe(true);
    expect(dataset.name).toBe(target('dataset')!.itemName(STEM));
    expect(dataset.object).toBe(TARGET.name);
  });

  it('declares a record count, grouped by the record\'s title field', async () => {
    const dataset = await loadScaffold('dataset', TARGET);
    expect(dataset.measures).toEqual([{ name: 'record_count', label: 'Records', aggregate: 'count' }]);
    expect(dataset.dimensions).toEqual([{ name: TARGET.displayField, field: TARGET.displayField }]);
  });

  it('an object with no title field gets no dimension, and the dataset still parses', async () => {
    const dataset = await loadScaffold('dataset', { ...TARGET, displayField: undefined });
    expect(dataset.dimensions).toEqual([]);
    expect(DatasetSchema.safeParse(dataset).success).toBe(true);
  });
});
