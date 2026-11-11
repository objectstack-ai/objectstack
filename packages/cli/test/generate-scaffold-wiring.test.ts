// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#20215) — what `os generate` writes can reach the stack, and the
 * instruments that say whether it did.
 *
 * ## The defect
 *
 * `os init -t app` wrote a config that imported `./src/objects` alone. Every
 * other generator wrote a scaffold and a barrel nothing imported, and
 * `os validate` exited 0 with `UI: 0 Apps` / `Logic: 0 Flows`. Once the flows
 * barrel was wired by hand, the flow scaffold was refused for a `requires`
 * without `triggers`; once the views barrel was, `os serve` refused the view
 * scaffold at boot for a container `name` that disagreed with its object key.
 *
 * ## What this file holds, in-process (the per-PR half)
 *
 *   1. The generator roster: every type's stack key is a key the stack schema
 *      declares, and `itemName` is the `name` the scaffold really writes.
 *   2. The `app` and `plugin` templates wire every generator's barrel under
 *      its stack key, write a barrel for each, and declare what the scaffolds
 *      need to run; the materialized template loads, with every wired key a
 *      list. A fresh template project was also measured to fail its own
 *      `tsc` with `Object.values` on an empty barrel — that half is
 *      `scaffold-emission-typechecks.test.ts`'s, which types every template.
 *   3. The pure instruments `os g` reports with: barrel membership asked of
 *      the compiler (a substring test dropped names), the stack reach reader,
 *      and the wiring lines it prints.
 *   4. `os init` never overwrites a barrel of the author's with an empty one,
 *      and appends its own export lines to one it finds.
 *   5. (#32212) The project a template scaffolds lists its objects: the `app`
 *      template's starter app navigates to every object, every object of the
 *      `app` and `plugin` templates has a list view binding it, and both bind
 *      the object through its import, so a rename moves them with it.
 *
 * The command's own behaviour — the reach report, the refusal that takes a
 * write back out — is spawned in `generate-stack-reach.test.ts`, and the whole
 * `os init` → `os g` every type → `os validate` chain runs nightly in
 * `generate-scaffolds-reach-stack.e2e.test.ts`.
 *
 * Sandboxes live under this package's `node_modules` so a scaffold's
 * `@objectstack/spec` import resolves to the workspace copy.
 */

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleRequire } from 'bundle-require';
import { ObjectStackDefinitionSchema } from '@objectstack/spec';
import ts from 'typescript';
import { GENERATOR_SCAFFOLD_TARGETS, stackBindingCandidates, type ScaffoldBindings } from '../src/commands/generate.js';
import {
  TEMPLATES,
  SCAFFOLD_WIRED_BARRELS,
  SCAFFOLD_WIRED_REQUIRES,
  sanitizeNamespace,
  writeTemplateSrcFiles,
} from '../src/commands/init.js';
import { BUNDLE_REQUIRE_EXTERNALS, loadConfig } from '../src/utils/config.js';
import {
  barrelExportNames,
  barrelExportsBinding,
  barrelSpecifier,
  declaredCapabilities,
  measureStackReach,
  missingCapabilities,
  registeredItemName,
  stackCarries,
  wiringLines,
} from '../src/utils/scaffold-wiring.js';
import { probeBindings } from './helpers/scaffold-bindings.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = fs.mkdtempSync(path.join(HERE, '..', 'node_modules', '.scaffold-wiring-'));

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

const PROJECT = 'my-app';
const NS = sanitizeNamespace(PROJECT);
const STEM = 'order_line';

let seq = 0;

/** Load one scaffold the way `os validate` loads authored TypeScript. */
async function materialize(source: string): Promise<Record<string, unknown>> {
  const file = path.join(TMP_ROOT, `scaffold-${seq++}.ts`);
  fs.writeFileSync(file, source, 'utf8');
  const { mod } = await bundleRequire({ filepath: file, external: BUNDLE_REQUIRE_EXTERNALS });
  return ((mod as { default?: unknown }).default ?? mod) as Record<string, unknown>;
}

/** An `os init -t <key>` project, written through the command's own emitters. */
function emitTemplate(key: string): string {
  const root = fs.mkdtempSync(path.join(TMP_ROOT, `init-${key}-`));
  const template = TEMPLATES[key];
  fs.writeFileSync(path.join(root, 'objectstack.config.ts'), template.configContent(PROJECT, NS));
  writeTemplateSrcFiles(template.srcFiles, root, PROJECT, NS);
  return root;
}

/**
 * [#21325] What `target` is rendered against. A view is named after the object
 * it binds, so its binding is the object its own `itemName` names, resolved
 * the command's way off a stack declaring it; every other binding scaffold
 * takes the probe stack's (`helpers/scaffold-bindings.ts`) — this file reads
 * the item's own name, not what it binds.
 */
function bindingsFor(target: (typeof GENERATOR_SCAFFOLD_TARGETS)[number], namespace?: string): ScaffoldBindings | undefined {
  if (target.binds.object !== 'name') return probeBindings(target);
  const { objects } = stackBindingCandidates({
    objects: [{ name: target.itemName(STEM, namespace), fields: { name: { type: 'text', label: 'Name' } } }],
  });
  return { object: objects[0] };
}

// ── 1. The roster ─────────────────────────────────────────────────────────

describe('[#20215] every generator names where its items land', () => {
  const declaredKeys = new Set(Object.keys((ObjectStackDefinitionSchema as unknown as { shape: object }).shape));

  it('has generators to measure', () => {
    expect(GENERATOR_SCAFFOLD_TARGETS.length).toBeGreaterThan(0);
  });

  it.each(GENERATOR_SCAFFOLD_TARGETS.map((t) => [t.type, t] as const))(
    '`%s` is collected under a key the stack schema declares',
    (_type, target) => {
      expect(declaredKeys.has(target.stackKey), `${target.type} → ${target.stackKey}`).toBe(true);
    },
  );

  it.each(GENERATOR_SCAFFOLD_TARGETS.map((t) => [t.type, t] as const))(
    '`%s`: itemName is the name the scaffold writes, with and without a namespace',
    async (_type, target) => {
      for (const namespace of [NS, undefined]) {
        const artifact = await materialize(target.generate(STEM, namespace, bindingsFor(target, namespace)));
        // [#21325] The key the item is REGISTERED under: its `name`, or for a
        // views container the object it binds (it writes no `name`).
        expect(registeredItemName(target.stackKey, artifact)).toBe(target.itemName(STEM, namespace));
        // …and the reach reader finds it by exactly that name under that key.
        expect(stackCarries({ [target.stackKey]: [artifact] }, target.stackKey, target.itemName(STEM, namespace)))
          .toBe(true);
      }
    },
  );

  // [#21325] It used to write `name` equal to its object key, which the boot
  // registrar only ever compares against that key (a disagreeing `name` is
  // refused; an absent one is not), and a `label` no reader reaches. Both were
  // `liveness-dead-property` warnings on every scaffold.
  it('the view container writes no name or label, and is registered under the object it binds', async () => {
    const view = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === 'view')!;
    const artifact = await materialize(view.generate(STEM, NS, bindingsFor(view, NS)));
    expect(artifact.name).toBeUndefined();
    expect(artifact.label).toBeUndefined();
    expect(artifact.object).toBe(`${NS}_${STEM}`);
    expect(registeredItemName('views', artifact)).toBe(`${NS}_${STEM}`);
  });

  it('the flow scaffold declares the capabilities it runs on, in its own header too', () => {
    const flow = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === 'flow')!;
    expect([...flow.requires].sort()).toEqual(['automation', 'triggers']);
    const source = flow.generate(STEM, NS, bindingsFor(flow, NS));
    for (const token of flow.requires) expect(source).toContain(`'${token}'`);
  });
});

// ── 2. The templates ──────────────────────────────────────────────────────

const WIRING_TEMPLATES = ['app', 'plugin'] as const;

/**
 * [#32212] The scaffolds each template ships beside its object, by stack key:
 * the `app` template its starter app and the object's list view, the `plugin`
 * template the list view alone (a package's navigation is its host's).
 */
const STARTER_SCAFFOLDS: Record<(typeof WIRING_TEMPLATES)[number], Record<string, number>> = {
  app: { apps: 1, views: 1 },
  plugin: { views: 1 },
};

describe('[#20215] the `app` and `plugin` templates wire every generator barrel', () => {
  it('the roster the templates wire IS the generator roster', () => {
    expect(SCAFFOLD_WIRED_BARRELS.map((b) => [b.type, b.dir, b.stackKey])).toEqual(
      GENERATOR_SCAFFOLD_TARGETS.map((t) => [t.type, t.defaultDir, t.stackKey]),
    );
    expect([...SCAFFOLD_WIRED_REQUIRES].sort()).toEqual(
      [...new Set(GENERATOR_SCAFFOLD_TARGETS.flatMap((t) => t.requires))].sort(),
    );
  });

  it.each(WIRING_TEMPLATES)('`%s`: imports each barrel, wires it under its key, and writes it', (key) => {
    const template = TEMPLATES[key];
    const config = template.configContent(PROJECT, NS);
    for (const b of SCAFFOLD_WIRED_BARRELS) {
      expect(config).toContain(`import * as ${b.stackKey} from './${b.dir}';`);
      expect(config).toContain(`  ${b.stackKey}: exportsOf(${b.stackKey}),`);
      expect(Object.keys(template.srcFiles)).toContain(`${b.dir}/index.ts`);
    }
    expect(config).toContain(`requires: [${SCAFFOLD_WIRED_REQUIRES.map((t) => `'${t}'`).join(', ')}],`);
  });

  it.each(WIRING_TEMPLATES)('`%s`: the emitted project loads, and every wired key is a list', async (key) => {
    const root = emitTemplate(key);
    const { config } = await loadConfig(path.join(root, 'objectstack.config.ts'));
    const stack = config as Record<string, unknown>;
    for (const b of SCAFFOLD_WIRED_BARRELS) {
      expect(Array.isArray(stack[b.stackKey]), b.stackKey).toBe(true);
    }
    // The template's own object is carried, through the reader `os g` uses.
    const reach = await measureStackReach({ stackKey: 'objects', itemName: `${NS}_item`, requires: SCAFFOLD_WIRED_REQUIRES }, root);
    expect(reach).toMatchObject({ kind: 'loaded', reached: true, missingRequires: [] });
    // [#32212] The template's own app and list view are carried too…
    for (const [stackKey, count] of Object.entries(STARTER_SCAFFOLDS[key])) {
      expect(stack[stackKey], stackKey).toHaveLength(count);
    }
    // …and nothing else is there yet: an empty barrel is a key counted at zero.
    for (const b of SCAFFOLD_WIRED_BARRELS.filter((x) => x.type !== 'object' && !(x.stackKey in STARTER_SCAFFOLDS[key]))) {
      expect(stack[b.stackKey], b.stackKey).toEqual([]);
    }
  });

  it('`empty` stays a bare config: it writes no directory to wire', () => {
    expect(Object.keys(TEMPLATES.empty.srcFiles)).toEqual([]);
    expect(TEMPLATES.empty.configContent(PROJECT, NS)).not.toContain('import * as');
  });
});

// ── 3. The instruments ────────────────────────────────────────────────────

describe('[#20215] barrel membership is asked of the compiler, not of a substring', () => {
  // The flows barrel: one the `app` template writes empty (its views barrel
  // carries the starter list view since #32212).
  it('an empty barrel exports no name, whatever its text contains', () => {
    const empty = TEMPLATES.app.srcFiles['src/flows/index.ts'](PROJECT, NS);
    expect([...barrelExportNames(ts, empty)]).toEqual([]);
  });

  it('`port` is not exported by `export {};` — the substring test said it was', async () => {
    const empty = TEMPLATES.app.srcFiles['src/flows/index.ts'](PROJECT, NS);
    expect(empty.includes('port')).toBe(true); // the old test's verdict: "already there"
    expect(await barrelExportsBinding(empty, 'port')).toBe(false);
  });

  it('`order` is not exported by a barrel that exports `orderLine`', async () => {
    const barrel = "export { default as orderLine } from './order_line.view';\n";
    expect(barrel.includes('order')).toBe(true);
    expect(await barrelExportsBinding(barrel, 'order')).toBe(false);
    expect(await barrelExportsBinding(barrel, 'orderLine')).toBe(true);
  });

  it('reads every by-name export form, and nothing from `export *`', () => {
    const names = barrelExportNames(ts, [
      "export { default as a, b } from './x';",
      'const c = 1; export { c as d };',
      'export const e = 1, f = 2;',
      'export function g() {}',
      'export class H {}',
      "export * from './y';",
      '// export { z }',
    ].join('\n'));
    expect([...names].sort()).toEqual(['H', 'a', 'b', 'd', 'e', 'f', 'g']);
  });
});

describe('[#20215] the reach reader and the lines it prints', () => {
  it('finds an item by name in the list form, the map form and a folded package', () => {
    expect(stackCarries({ views: [{ name: 'a' }] }, 'views', 'a')).toBe(true);
    expect(stackCarries({ views: [{ name: 'a' }] }, 'views', 'b')).toBe(false);
    expect(stackCarries({ flows: { a: { label: 'A' } } }, 'flows', 'a')).toBe(true);
    const app = { name: 'crm_app', label: 'CRM' };
    const pkg = { manifest: { id: 'com.example.p', version: '1.0.0', type: 'app', name: 'p', apps: [app] } };
    expect(stackCarries({ packages: [pkg] }, 'apps', 'crm_app')).toBe(true);
    expect(stackCarries({}, 'apps', 'a')).toBe(false);
  });

  it('names the capability tokens a stack does not declare', () => {
    expect(declaredCapabilities({})).toBeNull();
    expect(missingCapabilities({}, ['automation', 'triggers'])).toEqual(['automation', 'triggers']);
    expect(missingCapabilities({ requires: ['triggers'] }, ['automation', 'triggers'])).toEqual(['automation']);
    expect(missingCapabilities({ requires: ['automation', 'triggers'] }, ['automation', 'triggers'])).toEqual([]);
  });

  it('prints the import, the key, and the WHOLE requires list when one is missing', () => {
    expect(wiringLines({ specifier: './src/views', stackKey: 'views', missingRequires: [], declaredRequires: null }))
      .toEqual({ importLine: "import * as views from './src/views';", stackLines: ['views: Object.values(views),'] });
    const flows = wiringLines({ specifier: './src/flows', stackKey: 'flows', missingRequires: ['triggers'], declaredRequires: ['automation'] });
    expect(flows.stackLines[1]).toMatch(/^requires: \['automation', 'triggers'\],/);
  });

  it('spells the barrel import relative to the config, extensionless', () => {
    expect(barrelSpecifier('/p/objectstack.config.ts', '/p/src/views')).toBe('./src/views');
    expect(barrelSpecifier('/p/app/objectstack.config.mjs', '/p/lib/views')).toBe('../lib/views');
    expect(barrelSpecifier('/p/objectstack.config.ts', '/p')).toBe('./index');
  });

  it('reports a directory with no config, and a config that does not load', async () => {
    const bare = fs.mkdtempSync(path.join(TMP_ROOT, 'bare-'));
    expect(await measureStackReach({ stackKey: 'views', itemName: 'a', requires: [] }, bare)).toEqual({ kind: 'no-config' });
    fs.writeFileSync(path.join(bare, 'objectstack.config.ts'), "throw new Error('broken on purpose');\n");
    const reach = await measureStackReach({ stackKey: 'views', itemName: 'a', requires: [] }, bare);
    expect(reach.kind).toBe('load-failed');
  });
});

// ── 4. `os init` keeps an author's barrel ─────────────────────────────────

describe('[#20215] an empty barrel never overwrites a file that is already there', () => {
  it('keeps an existing flows barrel byte-identical, and still writes the objects barrel', () => {
    const root = fs.mkdtempSync(path.join(TMP_ROOT, 'existing-'));
    const kept = "export { default as mine } from './mine.flow';\n";
    const replaced = "export { default as old } from './old.object';\n";
    fs.mkdirSync(path.join(root, 'src', 'flows'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'objects'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'flows', 'index.ts'), kept);
    fs.writeFileSync(path.join(root, 'src', 'objects', 'index.ts'), replaced);

    const written = writeTemplateSrcFiles(TEMPLATES.app.srcFiles, root, PROJECT, NS);

    expect(fs.readFileSync(path.join(root, 'src', 'flows', 'index.ts'), 'utf-8')).toBe(kept);
    expect(written).not.toContain('src/flows/index.ts');
    // Control: the objects barrel carries the template's own object, and is
    // written as it always was.
    expect(fs.readFileSync(path.join(root, 'src', 'objects', 'index.ts'), 'utf-8')).not.toBe(replaced);
    expect(written).toContain('src/objects/index.ts');
    // …and a wired directory with no barrel yet gets one.
    expect(written).toContain('src/dashboards/index.ts');
  });

  // [#32212] The views barrel now carries the template's list view. An
  // author's existing one keeps every export it had, and gains the template's
  // line once, the way `os g view` appends to a barrel it finds.
  it('appends the template\'s view to an existing views barrel, once, keeping the author\'s lines', () => {
    const root = fs.mkdtempSync(path.join(TMP_ROOT, 'existing-views-'));
    const kept = "export { default as mine } from './mine.view';"; // no trailing newline
    const barrel = path.join(root, 'src', 'views', 'index.ts');
    fs.mkdirSync(path.dirname(barrel), { recursive: true });
    fs.writeFileSync(barrel, kept);

    const written = writeTemplateSrcFiles(TEMPLATES.app.srcFiles, root, PROJECT, NS);

    const templateLine = `export { default as myAppItem } from './${NS}_item.view';`;
    expect(fs.readFileSync(barrel, 'utf-8')).toBe(`${kept}\n${templateLine}\n`);
    expect(written).toContain('src/views/index.ts');
    expect(written).toContain(`src/views/${NS}_item.view.ts`);

    // A second run finds the line and writes nothing to the barrel.
    const again = writeTemplateSrcFiles(TEMPLATES.app.srcFiles, root, PROJECT, NS);
    expect(fs.readFileSync(barrel, 'utf-8')).toBe(`${kept}\n${templateLine}\n`);
    expect(again).not.toContain('src/views/index.ts');
  });
});

// ── 5. The starter app and list view (#32212) ─────────────────────────────

/** Every `objectName` an app's navigation opens, group children included. */
function navigatedObjects(app: Record<string, unknown>): string[] {
  const walk = (items: unknown): string[] =>
    ((items as Record<string, unknown>[] | undefined) ?? []).flatMap((item) => [
      ...(item.type === 'object' && typeof item.objectName === 'string' ? [item.objectName] : []),
      ...walk(item.children),
    ]);
  return walk(app.navigation);
}

describe('[#32212] a scaffolded project lists its objects in an app, each with a list view', () => {
  async function loadedStack(root: string): Promise<Record<string, Record<string, unknown>[]>> {
    const { config } = await loadConfig(path.join(root, 'objectstack.config.ts'));
    return config as Record<string, Record<string, unknown>[]>;
  }

  it.each(WIRING_TEMPLATES)('`%s`: every object has a list view that binds it, with columns it declares', async (key) => {
    const stack = await loadedStack(emitTemplate(key));
    expect(stack.objects.length, 'the template scaffolds an object').toBeGreaterThan(0);
    for (const object of stack.objects) {
      const views = stack.views.filter((v) => v.object === object.name);
      expect(views, `a view binds ${String(object.name)}`).toHaveLength(1);
      const list = views[0].list as { type: string; label: string; columns: { field: string }[] };
      expect(list.type).toBe('grid');
      expect(list.label).toBeTruthy();
      expect(list.columns.map((c) => c.field)).toEqual(Object.keys(object.fields as object));
    }
  });

  it('`app`: the starter app navigates to every object the template scaffolds', async () => {
    const stack = await loadedStack(emitTemplate('app'));
    expect(stack.apps).toHaveLength(1);
    expect(stack.apps[0].name).toBe(`${NS}_main_app`);
    expect(navigatedObjects(stack.apps[0]).sort()).toEqual(stack.objects.map((o) => String(o.name)).sort());
  });

  it('`plugin`: ships no app, so a host that loads the package composes its own navigation', async () => {
    const stack = await loadedStack(emitTemplate('plugin'));
    expect(stack.apps).toEqual([]);
    expect(Object.keys(TEMPLATES.plugin.srcFiles).filter((f) => f.startsWith('src/apps/') && f !== 'src/apps/index.ts'))
      .toEqual([]);
  });

  it('`empty`: scaffolds no object, so it has nothing for an app or a view to name', () => {
    expect(Object.keys(TEMPLATES.empty.srcFiles)).toEqual([]);
  });

  // The route the card asked to be named: the object is referenced through an
  // import of its module, never as a typed-out name. So renaming the object in
  // its own file — the only `name:` that carries it — moves the app entry and
  // the view with it, and no other file spells the name to go stale.
  it.each(WIRING_TEMPLATES)('`%s`: renaming the object in its own file moves the app entry and the view with it', async (key) => {
    const root = emitTemplate(key);
    const objectFile = path.join(root, 'src', 'objects', `${NS}_item.object.ts`);
    const before = fs.readFileSync(objectFile, 'utf-8');
    expect(before).toContain(`name: '${NS}_item',`);
    for (const rel of Object.keys(TEMPLATES[key].srcFiles).map((f) => f.replace(/__name__/g, NS))) {
      if (!/^src\/(apps|views)\/(?!index\.ts$)/.test(rel)) continue;
      expect(fs.readFileSync(path.join(root, rel), 'utf-8'), `${rel} spells the object's name out`)
        .not.toContain(`'${NS}_item'`);
    }
    fs.writeFileSync(objectFile, before.replace(`name: '${NS}_item',`, `name: '${NS}_renamed',`));

    const stack = await loadedStack(root);
    expect(stack.objects.map((o) => o.name)).toEqual([`${NS}_renamed`]);
    expect(stack.views.map((v) => v.object)).toEqual([`${NS}_renamed`]);
    if (key === 'app') expect(navigatedObjects(stack.apps[0])).toEqual([`${NS}_renamed`]);
  });
});
