// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN: `os generate picklist NAME` writes a shared option list that the
 * runtime SERVES, not one it ignores.
 *
 * ## What was measured before the row existed
 *
 * On `origin/main` 58a77dbde2, `os generate picklist industry` printed
 * `Unknown type: picklist` and exited 1, and the blank starter wired no
 * `src/picklists` barrel. A list could be authored only by hand, and the
 * command an author reaches for first did not know the kind.
 *
 * ## Why the row waited, and what this file holds against
 *
 * A scaffold of a kind with no runtime reader validates, builds, and then
 * serves nothing: the list registers and no field ever carries its options.
 * The row was held until the engine resolved `picklist` into `options`
 * (`@objectstack/objectql`, `picklist-resolution.ts`). So the obligation here
 * is end to end, not a template string: the file the generator writes,
 * loaded the way `os validate` loads authored TypeScript and collected under
 * the stack key `os init` and the blank starter wire its barrel into, is what
 * the engine resolves onto a field that names it.
 *
 * Every fact about the row is READ off the roster (`GENERATOR_SCAFFOLD_TARGETS`)
 * and the registry (`metadataFileName`), never restated, except the three the
 * card names: the type `picklist`, the directory `src/picklists`, and the
 * stack key `picklists` the engine reads.
 *
 * The control: the same object with no list registered serves no options, so
 * a green here cannot come from a field that carried options already.
 */

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleRequire } from 'bundle-require';
import { Field, ObjectSchema, PicklistSchema, PicklistServedFieldSchema } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { GENERATOR_SCAFFOLD_TARGETS } from './generate.js';
import { metadataFileName } from '../utils/metadata-file-name.js';
import { BUNDLE_REQUIRE_EXTERNALS } from '../utils/config.js';

const STEM = 'industry';

const PICKLIST = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === 'picklist');

/**
 * Inside this package's own `node_modules`, for the reason
 * `test/generate-scaffold-validates.test.ts` gives: git-ignored, and the
 * scaffold's `@objectstack/spec/data` import resolves from here exactly as it
 * would in an author's project.
 */
const TMP_ROOT = fs.mkdtempSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', '.generate-picklist-pin-'),
);

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** Materialize the scaffold through the loader `os validate` uses. */
async function loadScaffold(): Promise<Record<string, unknown>> {
  if (!PICKLIST) throw new Error('no `picklist` generator on the roster');
  const file = path.join(TMP_ROOT, metadataFileName('picklist', STEM) ?? 'unnamed.ts');
  fs.writeFileSync(file, PICKLIST.generate(STEM), 'utf8');
  const { mod } = await bundleRequire({ filepath: file, external: BUNDLE_REQUIRE_EXTERNALS });
  return ((mod as { default?: unknown }).default ?? mod) as Record<string, unknown>;
}

/** An object with one select field that names the list, as an author writes it. */
const account = (listName: string) => ObjectSchema.create({
  name: 'pin_account',
  label: 'Account',
  sharingModel: 'private',
  fields: {
    industry: Field.select({ picklist: listName, label: 'Industry' }),
  },
});

/** Register a package the way the boot does, through the stack keys it declares. */
function serve(collections: Record<string, unknown[]>) {
  const engine = new ObjectQL();
  engine.registerApp({ id: 'com.example.picklist_pin', name: 'picklist_pin', ...collections } as never);
  return engine.registry.getObject('pin_account')?.fields.industry as Record<string, unknown> | undefined;
}

describe('`os generate picklist` is on the roster, where the starter wires it', () => {
  it('scaffolds into src/picklists, collected under the `picklists` stack key', () => {
    expect(PICKLIST, 'the `picklist` generator').toBeDefined();
    expect(PICKLIST!.defaultDir).toBe('src/picklists');
    expect(PICKLIST!.stackKey).toBe('picklists');
    // A list names no object, so a namespaced project writes the name as typed,
    // and it needs no capability token to load.
    expect(PICKLIST!.namesObject).toBe(false);
    expect(PICKLIST!.requires).toEqual([]);
  });

  it('writes NAME.picklist.ts, the registry\'s own pattern for the kind', () => {
    expect(metadataFileName('picklist', STEM)).toBe(`${STEM}.picklist.ts`);
  });
});

describe('the scaffold the generator writes is a list the engine serves', () => {
  it('loads as a picklist named what `os g` reports it reached', async () => {
    const list = await loadScaffold();
    expect(PicklistSchema.safeParse(list).success).toBe(true);
    expect(list.name).toBe(PICKLIST!.itemName(STEM));
  });

  it('resolves onto a select field that names it: the served field carries the list\'s options', async () => {
    const list = await loadScaffold();
    const field = serve({ [PICKLIST!.stackKey]: [list], objects: [account(PICKLIST!.itemName(STEM))] });

    expect(field?.picklist).toBe(STEM);
    expect(field?.options).toEqual(list.options);
    // The served contract the object read exits owe a client.
    expect(PicklistServedFieldSchema.safeParse(field).success).toBe(true);
  });

  it('control: the same field with no list registered serves no options', () => {
    const field = serve({ objects: [account(STEM)] });
    expect(field?.picklist).toBe(STEM);
    expect(field?.options).toBeUndefined();
  });
});
