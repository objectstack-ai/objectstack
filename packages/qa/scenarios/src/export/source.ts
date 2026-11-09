// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The generated app's metadata source: what the AI wrote, as a reader reviews
 * it — never `node_modules`, the build output, the installed skills or the
 * scaffold's deployment boilerplate.
 *
 * It is an allow-list, so nothing reaches the gallery by default: the four
 * project files that declare the app ({@link SOURCE_ROOT_FILES}) and the whole
 * `src/` tree, regular files only. A symbolic link anywhere in it refuses the
 * export — what it points at is not the project's own text.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The project files at the root that declare the app; `objectstack.config.ts` is required. */
export const SOURCE_ROOT_FILES = ['objectstack.config.ts', 'objectstack.manifest.json', 'package.json', 'tsconfig.json'] as const;

/** The directory whose whole tree is the app's metadata. */
export const SOURCE_DIR = 'src';

/** Trees never copied, even under `src/`. */
const NEVER = new Set(['node_modules', 'dist', '.objectstack', '.git']);

export interface AuthoredSource {
  /** Relative path (forward slashes) → bytes, sorted by path. */
  files: Map<string, Buffer>;
}

export class SourceRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceRefusal';
  }
}

export function readAuthoredSource(projectDir: string): AuthoredSource {
  if (!existsSync(join(projectDir, 'objectstack.config.ts'))) throw new SourceRefusal(`no objectstack.config.ts in ${projectDir}: not the run's project`);
  const found: Array<[string, Buffer]> = [];
  const take = (rel: string) => {
    const p = join(projectDir, rel);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new SourceRefusal(`${rel} is a symbolic link: only the project's own files are exported`);
    if (st.isFile()) found.push([rel, readFileSync(p)]);
  };
  for (const f of SOURCE_ROOT_FILES) if (existsSync(join(projectDir, f))) take(f);
  const walk = (rel: string) => {
    for (const ent of readdirSync(join(projectDir, rel), { withFileTypes: true })) {
      const child = `${rel}/${ent.name}`;
      if (ent.isSymbolicLink()) throw new SourceRefusal(`${child} is a symbolic link: only the project's own files are exported`);
      if (ent.isDirectory()) {
        if (!NEVER.has(ent.name)) walk(child);
      } else if (ent.isFile()) take(child);
    }
  };
  if (existsSync(join(projectDir, SOURCE_DIR))) walk(SOURCE_DIR);
  found.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { files: new Map(found) };
}

/**
 * The framework version the app was built on: the `@objectstack/spec` the
 * project pins (`create-objectstack` pins every `@objectstack/*` package to
 * its own version, exactly). Refused when the project names none.
 */
export function projectFrameworkVersion(projectDir: string): string {
  const p = join(projectDir, 'package.json');
  if (!existsSync(p)) throw new SourceRefusal(`no package.json in ${projectDir}: the framework version cannot be stated`);
  const pkg = JSON.parse(readFileSync(p, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const v = pkg.dependencies?.['@objectstack/spec'] ?? pkg.devDependencies?.['@objectstack/spec'];
  if (typeof v !== 'string' || v === '') throw new SourceRefusal(`the project's package.json names no @objectstack/spec: the framework version cannot be stated`);
  return v;
}
