// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every scaffold this package ships must emit a `manifest:` block that
 * `ManifestSchema` accepts — the schema the user's very first command parses
 * it with.
 *
 * ## The defect this pins
 *
 * `os create example <name>` wrote an `objectstack.config.ts` whose manifest
 * was three keys — `name`, `version`, `description` — and nothing else.
 * `ManifestSchema` requires `id` (the reverse-domain package id) and `type`
 * (`app` | `plugin` | …), and `namespace` decides every object name, table
 * name and REST path (there was none). Parsed against the schema the block
 * answered:
 *
 *     success : false
 *     issues  : invalid_type@id · invalid_value@type
 *
 * `defineStack` throws on exactly that, so a project scaffolded by a
 * documented command refused on its first run, before the author had written
 * a line. The three `os init` templates all stamped the identity block; the
 * `create` template was the one scaffold that had drifted, and nothing
 * noticed because no test ever looked at these templates as DATA.
 *
 * ## Why the sweep spans both scaffolders, and why it is derived
 *
 * The defect class is "a shipped scaffold whose manifest the shipped schema
 * refuses", and this package has two independent scaffold sources —
 * `init.ts`'s `TEMPLATES` and `create.ts`'s `templates`. Pinning only the
 * reported one would leave the other free to drift the same way, which is how
 * this one arrived. So the population is DERIVED from both maps (every entry
 * that emits an `objectstack.config.ts`), never written down: a template added
 * later is swept the day it is added, with nobody remembering to extend this
 * file.
 *
 * `create`'s `plugin` template contributes nothing here on purpose — it emits
 * no `objectstack.config.ts` at all. Its scaffolded `src/index.ts` declares a
 * `Plugin` object, a different contract from this package manifest, and a
 * sweep that pretended otherwise would report on a surface `ManifestSchema`
 * does not govern.
 *
 * ## Why the manifest is read back off a LOADED config, not off the source text
 *
 * Both scaffolders render their config as a template literal, so the only
 * honest reading of "what the scaffold declares" is the object the rendered
 * file actually evaluates to. The rendered file is written to disk and loaded
 * through `bundle-require` — the same loader `scaffold-validate.ts` uses for
 * `init`'s self-test — so what is parsed here is the real emitted artifact and
 * not a literal copied into a test, which is free to agree with a template
 * that has since changed.
 *
 * Temp projects go under this package's git-ignored `tmp/` (not
 * `os.tmpdir()`) because the rendered config imports `@objectstack/spec`,
 * which only resolves where Node can walk up into this package's
 * `node_modules` — the same constraint, for the same reason, as
 * `init-scaffold-authoring-rules.test.ts`. Keeping generated `.ts` out of
 * `test/` also keeps it away from any glob that collects sources.
 *
 * ## Why `ManifestSchema` is parsed explicitly, when `defineStack` already ran
 *
 * `defineStack` validates through `ObjectStackDefinitionSchema`, where
 * `manifest` is `ManifestSchema.optional()`. Two live gaps follow from that
 * `.optional()`, and both are the failure this file exists to catch:
 *
 *   - a template that drops the `manifest:` block ENTIRELY loads green — the
 *     stack door has nothing to check — and ships a project with no id, no
 *     namespace and no type;
 *   - a template that calls `defineStack(config, { strict: false })` skips the
 *     parse altogether.
 *
 * Neither would redden a pin that only asserted "the config loads". So the
 * load is the first assertion, and the standalone parse is the one that does
 * not depend on the door staying the way it is today.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManifestSchema } from '@objectstack/spec/kernel';
import { TEMPLATES, sanitizeNamespace } from '../src/commands/init.js';
import { templates as createTemplates } from '../src/commands/create.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.resolve(HERE, '../tmp');
const PROJECT_NAME = 'my-app';
const CONFIG_FILE = 'objectstack.config.ts';

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

interface Scaffold {
  /** `<command>:<template key>` — the command a user would have typed. */
  id: string;
  /** Render this scaffold's `objectstack.config.ts`, through its own emitter. */
  render: () => string;
}

/**
 * `os init -t <key>`: every template renders a config, so the whole map
 * contributes.
 */
const initScaffolds: Scaffold[] = Object.keys(TEMPLATES).map((key) => ({
  id: `init:${key}`,
  render: () => TEMPLATES[key].configContent(PROJECT_NAME, sanitizeNamespace(PROJECT_NAME)),
}));

/**
 * `os create <key> <name>`: only the templates whose file map carries an
 * `objectstack.config.ts` contribute — derived from the map, so a template
 * that grows one later is swept without an edit here.
 */
const createScaffolds: Scaffold[] = Object.entries(createTemplates)
  .filter(([, template]) => CONFIG_FILE in template.files)
  .map(([key, template]) => ({
    id: `create:${key}`,
    render: () => {
      const emit = (template.files as Record<string, (name: string) => unknown>)[CONFIG_FILE];
      return String(emit(PROJECT_NAME));
    },
  }));

const SCAFFOLDS: Scaffold[] = [...initScaffolds, ...createScaffolds];

/** Write one rendered config into a throwaway directory and load it back. */
async function loadStack(scaffold: Scaffold): Promise<Record<string, unknown>> {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(TMP_ROOT, `manifest-${scaffold.id.replace(':', '-')}-`));
  roots.push(root);
  fs.writeFileSync(path.join(root, CONFIG_FILE), scaffold.render());

  const { bundleRequire } = await import('bundle-require');
  const { mod } = await bundleRequire({ filepath: path.join(root, CONFIG_FILE), cwd: root });
  return (mod.default ?? mod) as Record<string, unknown>;
}

describe('every shipped scaffold emits a manifest `ManifestSchema` accepts', () => {
  // A sweep that swept nothing reports exactly what a clean tree reports. The
  // counts are DERIVED from the two maps rather than frozen, so this stays a
  // check that the filters still match something — not a copy of today's
  // template list that the next added template makes stale.
  it('sweeps both scaffolders, and every template that emits a config', () => {
    expect(initScaffolds.length).toBe(Object.keys(TEMPLATES).length);
    expect(initScaffolds.length).toBeGreaterThan(0);
    expect(createScaffolds.length).toBeGreaterThan(0);
    expect(SCAFFOLDS.length).toBe(initScaffolds.length + createScaffolds.length);
  });

  // The reported instance, named so a future edit that drops the identity
  // block again fails with the incident's own vocabulary rather than a bare
  // count.
  it('includes `os create example` — the scaffold that drifted', () => {
    expect(SCAFFOLDS.map((s) => s.id)).toContain('create:example');
  });

  it.each(SCAFFOLDS.map((s) => s.id))(
    'scaffold "%s" declares a manifest the protocol schema accepts',
    async (id) => {
      const scaffold = SCAFFOLDS.find((s) => s.id === id)!;

      let stack: Record<string, unknown>;
      try {
        stack = await loadStack(scaffold);
      } catch (error) {
        // `defineStack` refuses an invalid manifest by throwing, so this IS
        // the first-run failure the user sees. Re-raise it with the scaffold
        // named, because the thrown text alone does not say which one.
        throw new Error(
          `scaffold "${id}" produces a project that refuses to load — the user's very first `
            + `command fails on this:\n${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // `ObjectStackDefinitionSchema.manifest` is `.optional()`, so a missing
      // block is silent at the door above. It is not silent here.
      expect(stack.manifest, `scaffold "${id}" declares no \`manifest:\` block`).toBeDefined();

      const result = ManifestSchema.safeParse(stack.manifest);
      const issues = result.success
        ? ''
        : result.error.issues
            .map((i) => `${i.code}@${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('\n  ');
      expect(
        result.success,
        `scaffold "${id}" emits a manifest \`ManifestSchema\` refuses:\n  ${issues}`,
      ).toBe(true);
    },
    120_000,
  );
});
