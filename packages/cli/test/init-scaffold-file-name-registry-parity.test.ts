// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#11598) — every object `objectstack init` scaffolds is written under a
 * name the registry's `object` entry actually declares.
 *
 * ## The defect
 *
 * `init` scaffolded `src/objects/<namespace>_item.ts` while
 * `DEFAULT_METADATA_TYPE_REGISTRY` declares `*.object.ts` (plus `.yml` /
 * `.json`) for the `object` type. Measured on `origin/main` with `node:path`'s
 * `matchesGlob`: `src/objects/my_app_item.ts` matched ZERO of the three,
 * `src/objects/my_app_item.object.ts` matches exactly one.
 *
 * ## What is and is NOT claimed here — the measured load path
 *
 * This is deliberately NOT the silent-strip shape (#10359, and #11071's case
 * for `os generate`). A scaffolded project declares its objects in CODE:
 *
 *     import * as objects from './src/objects';
 *     export default defineStack({ …, objects: Object.values(objects) });
 *
 * `os compile` bundle-requires that config, so the object arrives through the
 * barrel's MODULE SPECIFIER, and `os dev` / `os serve` then boot from the
 * compiled `dist/objectstack.json` — `standalone-stack.ts` hands
 * `MetadataPlugin` an `artifactSource`, which routes bootstrap to
 * `_loadFromLocalFile` and leaves `_loadFromFileSystem` (the glob pass) off a
 * scaffolded project's path entirely. Measured end-to-end, not inferred: a
 * `*.object.ts` file dropped into `src/objects/` and NOT re-exported from the
 * barrel does not reach the compiled artifact.
 *
 * So the scaffold WORKED under the old name and nothing was invisible. What
 * it was, is one CLI teaching two spellings for one metadata type: `os init`
 * wrote `<ns>_item.ts`, `os g object customer` (after #11071) writes
 * `customer.object.ts`, `create-objectstack`'s own blank starter already
 * shipped `note.object.ts`, and the examples (`app-crm/src/objects/
 * account.object.ts`) plus the registry's own glob keys speak the same shape.
 * The scaffold is the first thing a new author reads as the house convention.
 *
 * That is why the assertion below is `matchesGlob` against the REGISTRY and
 * not `toBe('my_app_item.object.ts')`. A string equality here would be a pin
 * on this edit; the property is that whatever `init` emits stays inside the
 * set the platform declares discoverable — which is what makes the two
 * commands converge, and what keeps a future template from drifting back out.
 *
 * ## Why no `dist/` is on this file's measured path
 *
 * `TEMPLATES` / `writeTemplateSrcFiles` are imported from `../src/commands/
 * init.js` — an in-package RELATIVE specifier, so vitest loads the source
 * this PR edits, never `packages/cli/dist`. Nothing here spawns a child
 * process (the CLI e2e suites that do, drive `bin/run-dev.js`, which is the
 * tsx source entry point by its own header). An ablation of `init.ts`
 * therefore reaches this file without a rebuild — stated because the opposite
 * case is the one that comes back green while measuring nothing.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { matchesGlob } from 'node:path';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { TEMPLATES, sanitizeNamespace, writeTemplateSrcFiles } from '../src/commands/init.js';
import { metadataFileName } from '../src/utils/metadata-file-name.js';

const PROJECT_NAME = 'my-app';
const OBJECT_DIR = 'src/objects';

/** The registry's own entry for the `object` type — the authority this pins to. */
const OBJECT_ENTRY = DEFAULT_METADATA_TYPE_REGISTRY.find((entry) => entry.type === 'object');

const roots: string[] = [];

afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Emit one template through `init`'s OWN emitter and return the relative paths
 * of the object sources it wrote (the barrel excluded — it is a re-export, not
 * a metadata file, and the registry declares nothing about it).
 */
function emitObjectSources(templateKey: string): { written: string[]; objects: string[]; root: string } {
  const template = TEMPLATES[templateKey];
  const namespace = sanitizeNamespace(PROJECT_NAME);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `os-init-11598-${templateKey}-`));
  roots.push(root);
  const written = writeTemplateSrcFiles(template.srcFiles, root, PROJECT_NAME, namespace);
  const objects = written.filter(
    (rel) => rel.startsWith(`${OBJECT_DIR}/`) && path.basename(rel) !== 'index.ts',
  );
  return { written, objects, root };
}

/** Templates that actually emit an object source — the corpus this pin measures. */
const TEMPLATES_WITH_OBJECTS = Object.keys(TEMPLATES).filter(
  (key) => emitObjectSources(key).objects.length > 0,
);

describe('[#11598] the init scaffold writes object files the registry declares', () => {
  it('the registry still declares an `object` type with file patterns to check against', () => {
    // Without this the sweep below would pass by having no contract to fail.
    expect(OBJECT_ENTRY, 'DEFAULT_METADATA_TYPE_REGISTRY has no `object` entry').toBeDefined();
    expect(OBJECT_ENTRY!.filePatterns.length).toBeGreaterThan(0);
  });

  it('at least one built-in template emits an object source at all', () => {
    // The green-because-nothing-ran direction: an `it.each` over an empty
    // roster is a passing test that measured nothing.
    expect(
      TEMPLATES_WITH_OBJECTS,
      'no built-in template emits a src/objects source — this pin would sweep nothing',
    ).not.toHaveLength(0);
  });

  it.each(TEMPLATES_WITH_OBJECTS)(
    'template "%s" writes every object under a name the `object` patterns match',
    (templateKey) => {
      const { objects } = emitObjectSources(templateKey);
      expect(objects.length, `template "${templateKey}" emitted no object source`).toBeGreaterThan(0);

      for (const rel of objects) {
        const matched = OBJECT_ENTRY!.filePatterns.filter((pattern) => matchesGlob(rel, pattern));
        expect(
          matched.length,
          `template "${templateKey}" scaffolds "${rel}", which matches none of `
            + `${JSON.stringify(OBJECT_ENTRY!.filePatterns)} — the CLI would be teaching a `
            + 'spelling the platform does not declare for this type',
        ).toBeGreaterThan(0);
      }
    },
  );

  it.each(TEMPLATES_WITH_OBJECTS)(
    'template "%s" writes the same filename `os g object` would, for the same stem',
    (templateKey) => {
      // The convergence half (#11071 direction, inherited): one CLI, one
      // spelling. `metadataFileName` is the derivation `os generate` uses —
      // reading the infix out of the pattern rather than interpolating the
      // type key — so this compares the two commands' OUTPUTS, not two
      // literals someone kept in sync by hand.
      const { objects } = emitObjectSources(templateKey);
      for (const rel of objects) {
        const base = path.basename(rel);
        // The stem `os g object <stem>` would be handed to produce this file.
        const stem = base.replace(/\.[^.]+\.ts$/, '').replace(/\.ts$/, '');
        expect(
          base,
          `\`os init -t ${templateKey}\` writes "${base}" but \`os g object ${stem}\` writes `
            + `"${metadataFileName('object', stem)}" — one CLI, two spellings for one type`,
        ).toBe(metadataFileName('object', stem));
      }
    },
  );

  it.each(TEMPLATES_WITH_OBJECTS)(
    'template "%s" barrel re-exports a specifier that resolves to a file it actually wrote',
    (templateKey) => {
      // The rename has to move BOTH `srcFiles` keys and the barrel that
      // imports them. A scaffold whose barrel points at a filename nobody
      // emitted does not compile at all — `os compile` bundle-requires the
      // config, which imports this barrel, so this is the behaviour the two
      // edits jointly have to preserve.
      const { written, root } = emitObjectSources(templateKey);
      const barrel = written.find((rel) => rel === `${OBJECT_DIR}/index.ts`);
      expect(barrel, `template "${templateKey}" emits objects but no barrel`).toBeDefined();

      const src = fs.readFileSync(path.join(root, barrel!), 'utf8');
      const specifiers = [...src.matchAll(/from\s+'(\.\/[^']+)'/g)].map((m) => m[1]);
      expect(specifiers.length, 'barrel re-exports nothing').toBeGreaterThan(0);

      for (const spec of specifiers) {
        const stem = spec.replace(/^\.\//, '').replace(/\.js$/, '');
        const candidates = [`${stem}.ts`, `${stem}.js`, stem];
        const resolved = candidates.find((candidate) =>
          written.includes(`${OBJECT_DIR}/${candidate}`),
        );
        expect(
          resolved,
          `template "${templateKey}" barrel imports '${spec}' but the template wrote `
            + `${JSON.stringify(written.filter((rel) => rel.startsWith(`${OBJECT_DIR}/`)))} — `
            + 'the scaffold would fail to compile on the user\'s next command',
        ).toBeDefined();
      }
    },
  );
});
