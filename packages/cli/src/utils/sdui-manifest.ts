// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Resolve the optional ADR-0080 SDUI component manifest.
 *
 * `validateJsxPages` does full component/prop validation when a manifest is in
 * hand and falls back to parse-level checking when it is not. The resolution
 * order (project file, then the copy shipped inside `@objectstack/console`) used
 * to live inline in `validate.ts` — the only command that ran the JSX gate. Once
 * `os build` and `os lint` run it too (#4409), a rule whose STRENGTH depends on
 * how its caller resolves an input is a second drift axis waiting to open: the
 * same page could pass on one command and fail on another purely because one
 * call site forgot the console fallback. One resolver, three callers.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * The manifest for the current project, or `undefined` when neither source is
 * present. Never throws: an unreadable or malformed manifest degrades to
 * parse-level JSX validation, which is what the gate did before manifests
 * existed.
 */
export function resolveSduiManifest(): unknown {
  try {
    const projectManifest = join(process.cwd(), 'sdui.manifest.json');
    if (existsSync(projectManifest)) {
      const parsed = JSON.parse(readFileSync(projectManifest, 'utf8'));
      if (parsed) return parsed;
    }
    // Fall back to the manifest shipped inside @objectstack/console (built from
    // objectui's public-tier registry; the CLI already depends on it).
    const consoleManifest = createRequire(import.meta.url).resolve(
      '@objectstack/console/dist/sdui.manifest.json',
    );
    if (existsSync(consoleManifest)) return JSON.parse(readFileSync(consoleManifest, 'utf8'));
  } catch {
    /* fall back to parse-level */
  }
  return undefined;
}
