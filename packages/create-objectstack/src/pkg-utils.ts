// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Pure helpers for rewriting a scaffolded project's package.json. Kept out of
// index.ts because that module calls `program.parse()` on import — anything a
// test needs must be importable without running the CLI.

/**
 * Rewrite every `@objectstack/*` range in dependencies/devDependencies to
 * `^<version>`. All @objectstack packages version in lockstep, so the
 * scaffolder's own version always resolves and always matches the framework
 * the docs describe. No-op when the version is unknown (`0.0.0` fallback) so
 * a broken version read never corrupts the template's committed baseline.
 */
export function syncObjectStackDeps(
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  version: string,
): void {
  if (!/^\d+\.\d+\.\d+/.test(version) || version.startsWith('0.')) return;
  for (const deps of [pkg.dependencies, pkg.devDependencies]) {
    if (!deps) continue;
    for (const dep of Object.keys(deps)) {
      if (dep.startsWith('@objectstack/')) {
        deps[dep] = `^${version}`;
      }
    }
  }
}
