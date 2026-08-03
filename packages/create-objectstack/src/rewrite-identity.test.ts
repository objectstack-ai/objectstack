// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Regression cover for #4902: every published remote template scaffolded into a
// project that could not build, because the object-name prefix rewrite was
// guarded on a field only the BUNDLED template's manifest has.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
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
    `export default defineStack({\n  manifest: {\n    id: 'x',\n    namespace: '${ns}',\n  },\n});\n`,
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
      'export default defineStack({ manifest: { id: "x" } });\n',
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
