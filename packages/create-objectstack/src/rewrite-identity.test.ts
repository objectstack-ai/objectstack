// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Regression cover for #4902: every published remote template scaffolded into a
// project that could not build, because the object-name prefix rewrite was
// guarded on a field only the BUNDLED template's manifest has.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_ID_PATTERN } from '@objectstack/spec/kernel';
import {
  deriveManifestId,
  readTemplateNamespace,
  rewriteObjectNamePrefix,
  findStaleNamespacePrefixes,
} from './rewrite-identity.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-rewrite-'));
  fs.mkdirSync(path.join(dir, 'src', 'objects'), { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const writeConfig = (ns: string) =>
  fs.writeFileSync(
    path.join(dir, 'objectstack.config.ts'),
    `export default defineStack({\n  manifest: {\n    id: 'com.example.x',\n    namespace: '${ns}',\n  },\n});\n`,
  );

const writeObject = (file: string, name: string) =>
  fs.writeFileSync(
    path.join(dir, 'src', 'objects', file),
    `export const o = {\n  name: '${name}',\n  label: 'X',\n};\n`,
  );

describe('readTemplateNamespace', () => {
  it('reads a REMOTE template shape: registry manifest with no namespace, config has it', () => {
    // The exact shape every template in objectstack-ai/templates ships:
    // $schema template-manifest.json, no `namespace` key anywhere in it.
    fs.writeFileSync(
      path.join(dir, 'objectstack.manifest.json'),
      JSON.stringify({
        $schema: 'https://schemas.objectstack.dev/template-manifest.json',
        name: 'todo',
        displayName: 'Todo',
        category: 'productivity',
        skills: ['objectstack-platform'],
      }),
    );
    writeConfig('todo');
    // Reading the manifest alone yields undefined — that was the bug.
    expect(readTemplateNamespace(dir)).toBe('todo');
  });

  it('reads a BUNDLED template shape: app manifest carrying namespace', () => {
    fs.writeFileSync(
      path.join(dir, 'objectstack.manifest.json'),
      JSON.stringify({ name: 'blank', namespace: 'blank' }),
    );
    writeConfig('blank');
    expect(readTemplateNamespace(dir)).toBe('blank');
  });

  it('falls back to the manifest when the config declares no namespace', () => {
    fs.writeFileSync(
      path.join(dir, 'objectstack.manifest.json'),
      JSON.stringify({ namespace: 'fallback' }),
    );
    fs.writeFileSync(
      path.join(dir, 'objectstack.config.ts'),
      'export default defineStack({ manifest: { id: "com.example.x" } });\n',
    );
    expect(readTemplateNamespace(dir)).toBe('fallback');
  });

  it('is undefined when neither source declares one', () => {
    expect(readTemplateNamespace(dir)).toBeUndefined();
  });

  it('survives an unparseable manifest', () => {
    fs.writeFileSync(path.join(dir, 'objectstack.manifest.json'), '{ not json');
    writeConfig('todo');
    expect(readTemplateNamespace(dir)).toBe('todo');
  });
});

describe('rewriteObjectNamePrefix', () => {
  it('moves every object name onto the new namespace', () => {
    writeObject('todo_task.object.ts', 'todo_task');
    writeObject('todo_label.object.ts', 'todo_label');
    const n = rewriteObjectNamePrefix(path.join(dir, 'src'), 'todo', 'my_app');
    expect(n).toBe(2);
    const read = (f: string) =>
      fs.readFileSync(path.join(dir, 'src', 'objects', f), 'utf8');
    expect(read('todo_task.object.ts')).toContain("name: 'my_app_task'");
    expect(read('todo_label.object.ts')).toContain("name: 'my_app_label'");
  });

  it('leaves names that do not carry the template prefix alone', () => {
    writeObject('other.object.ts', 'sys_user');
    expect(rewriteObjectNamePrefix(path.join(dir, 'src'), 'todo', 'my_app')).toBe(0);
    expect(
      fs.readFileSync(path.join(dir, 'src', 'objects', 'other.object.ts'), 'utf8'),
    ).toContain("name: 'sys_user'");
  });

  it('is a no-op on a missing directory rather than throwing', () => {
    expect(rewriteObjectNamePrefix(path.join(dir, 'nope'), 'todo', 'my_app')).toBe(0);
  });
});

describe('findStaleNamespacePrefixes', () => {
  it('reports nothing once the rewrite has run', () => {
    writeObject('todo_task.object.ts', 'todo_task');
    rewriteObjectNamePrefix(path.join(dir, 'src'), 'todo', 'my_app');
    expect(findStaleNamespacePrefixes(path.join(dir, 'src'), 'todo')).toEqual([]);
  });

  it('reports what a skipped rewrite leaves behind — the #4902 failure state', () => {
    writeObject('todo_task.object.ts', 'todo_task');
    writeObject('todo_label.object.ts', 'todo_label');
    // No rewrite at all: exactly what the old manifest-only guard produced.
    const stale = findStaleNamespacePrefixes(path.join(dir, 'src'), 'todo');
    expect(stale).toHaveLength(2);
    expect(stale.map((s) => s.file).sort()).toEqual([
      path.join('objects', 'todo_label.object.ts'),
      path.join('objects', 'todo_task.object.ts'),
    ]);
    expect(stale[0].line).toBeGreaterThan(0);
  });
});

// ── deriveManifestId — the pin the scaffold's id is held against ─────────────
//
// The rule is imported, never restated. A local copy of the regex is the very
// defect #17534 fixed one level up: `ManifestSchema.id` and
// `PackageSchema.manifestId` were two copies of one rule and drifted, so the
// scaffold satisfied the one that was not enforced. This asserts against the
// exported `MANIFEST_ID_PATTERN` so a future change to the rule fails HERE, in
// the scaffolder, rather than in the user's first `os validate`.
describe('deriveManifestId', () => {
  it.each([
    ['my-app', 'com.example.my-app'],
    ['myapp', 'com.example.myapp'],
    // The case prerequisite 4 names: a project name the namespace sanitizer
    // turns into `my_app`, which is NOT a legal id segment.
    ['my_app', 'com.example.my-app'],
    ['My App', 'com.example.my-app'],
    ['@acme/support-desk', 'com.example.support-desk'],
    ['support.desk', 'com.example.support-desk'],
    ['--leading-and-trailing--', 'com.example.leading-and-trailing'],
    // A segment must OPEN with a letter.
    ['123', 'com.example.app-123'],
    ['', 'com.example.app'],
  ])('%s → %s', (input, expected) => {
    expect(deriveManifestId(input)).toBe(expected);
  });

  it('every derived id satisfies the spec rule itself', () => {
    const names = [
      'my-app', 'my_app', 'My App', '@acme/support-desk', 'support.desk',
      '123', '', '---', 'a', 'UPPER_CASE_NAME', 'name with  spaces', 'ünïcödé-app',
    ];
    for (const name of names) {
      const id = deriveManifestId(name);
      expect(MANIFEST_ID_PATTERN.test(id), `${JSON.stringify(name)} → ${id}`).toBe(true);
    }
  });

  it('is not the namespace rule — the two disagree on the underscore', () => {
    // sanitizeNamespace('my-app') is 'my_app'; reusing it as the id produced
    // `com.example.my_app`, which the schema refuses.
    expect(deriveManifestId('my-app')).not.toContain('_');
  });
});

// The bundled template is the one scaffold output that ships as checked-in
// source, so it is pinned directly rather than through the derivation.
describe('the bundled blank template', () => {
  it('declares a manifest id the spec accepts', () => {
    const config = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates', 'blank', 'objectstack.config.ts'),
      'utf8',
    );
    const id = /\bid:\s*'([^']+)'/.exec(config)?.[1];
    expect(id, 'the template must declare a manifest id').toBeTruthy();
    expect(MANIFEST_ID_PATTERN.test(id as string), `template id ${id}`).toBe(true);
  });
});
