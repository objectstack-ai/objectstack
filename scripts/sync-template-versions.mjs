// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Re-sync the create-objectstack blank template's @objectstack/* dependency
// ranges with the scaffolder's own package version. Runs as part of the root
// `version` script (changesets/action calls `pnpm run version` when preparing
// the release PR), so a version bump can never ship with the template pinning
// a stale range — the drift class behind #2907: the template froze at ^6.0.0
// while the registry published 14.x, and every fresh `npm create objectstack`
// project landed eight majors behind the docs. The scaffold-time dep rewrite
// (pkg-utils.ts) and the ratchet test (template-consistency.test.ts) both
// guard this too, but release PRs opened by changesets/action with the default
// GITHUB_TOKEN do not trigger CI, so fixing the file at version time is the
// only spot that cannot be skipped.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scaffolderPkgPath = join(root, 'packages/create-objectstack/package.json');
const templatePkgPath = join(
  root,
  'packages/create-objectstack/src/templates/blank/package.json',
);

const version = JSON.parse(readFileSync(scaffolderPkgPath, 'utf8')).version;
if (!/^\d+\.\d+\.\d+/.test(String(version))) {
  console.error(`✗ sync-template-versions: cannot parse create-objectstack version '${version}'`);
  process.exit(1);
}
const range = `^${String(version).split('.')[0]}.0.0`;

const templatePkg = JSON.parse(readFileSync(templatePkgPath, 'utf8'));
let changed = 0;
for (const deps of [templatePkg.dependencies, templatePkg.devDependencies]) {
  if (!deps) continue;
  for (const dep of Object.keys(deps)) {
    if (dep.startsWith('@objectstack/') && deps[dep] !== range) {
      console.log(`  ${dep}: ${deps[dep]} → ${range}`);
      deps[dep] = range;
      changed++;
    }
  }
}

if (changed === 0) {
  console.log(`✓ blank template already pins ${range} — in lockstep with create-objectstack@${version}`);
} else {
  writeFileSync(templatePkgPath, JSON.stringify(templatePkg, null, 2) + '\n');
  console.log(`✓ blank template: ${changed} @objectstack/* range(s) → ${range} (lockstep with create-objectstack@${version})`);
}
