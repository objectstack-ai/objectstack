#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-node-version -- every workflow must run the Node version in .nvmrc.
//
// Before #3825 the repo ran two Node versions at once, and nobody had decided
// that: all 12 PR gates were on Node 20 while release.yml, publish-smoke.yml,
// scaffold-e2e.yml and showcase-smoke.yml were on 22. So code was verified on
// one runtime and shipped from another, and the verifying one had been EOL
// since 2026-04-30 -- no security patches on the runtime guarding every merge.
//
// The split was never a policy, it was drift. release.yml carried the receipt
// in a comment: "22 (not 20 like the other workflows)" because a downstream
// clone pinned engines.node >=22 and pnpm aborted on 20. One workflow got
// bumped to clear one error; the other twelve stayed behind. That is how the
// gates-vs-release gap opened, and nothing in CI could see it -- a version pin
// is 18 independent string literals, so drift is invisible until someone greps.
//
// It surfaced only by accident (#3812): a test imported better-sqlite3@13,
// whose engines say >=22. `engines` is a declaration, not enforcement, so it
// loaded on 20 and then killed the vitest worker with a process-level abort --
// no JS error, so the suite reported "22 passed (23)" while 17 cases silently
// never ran. A green check that had stopped running the tests.
//
//   node scripts/check-node-version.mjs
//
// .nvmrc is the single source of truth: it pins contributors' local runtime via
// `nvm use` AND is what this guard holds every workflow to. Bumping Node is
// therefore a one-line edit to .nvmrc plus whatever this guard then reports.
//
// Deliberately NOT checked: `engines.node` in package.json. That is a promise
// to users about what the published packages support, which is independent of
// what CI validates on, and tightening it is a breaking change. See #3825.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW_DIR = '.github/workflows';
const PIN_FILE = '.nvmrc';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

// The pin, e.g. "22". Tolerates the "v22" and "lts/jod" forms nvm also accepts,
// but this repo writes the bare major -- that is what setup-node wants too.
const pin = readFileSync(join(root, PIN_FILE), 'utf8').trim();
if (!pin) {
  console.error(`check-node-version: ${PIN_FILE} is empty -- it must pin a Node major, e.g. 22.`);
  process.exit(1);
}

const files = readdirSync(join(root, WORKFLOW_DIR))
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .sort();

// A step ends at the next YAML list item; `with:` keys live between the
// `uses: actions/setup-node` line and that boundary.
const SETUP_NODE = /^\s*(?:-\s+)?uses:\s*actions\/setup-node@/;
const NEXT_ITEM = /^\s*-\s/;
const NODE_VERSION = /^\s*node-version:\s*(.+?)\s*$/;
const NODE_VERSION_FILE = /^\s*node-version-file:\s*(.+?)\s*$/;

const unquote = (v) => v.replace(/^['"]|['"]$/g, '').trim();

const offenders = [];
let steps = 0;

for (const file of files) {
  const lines = readFileSync(join(root, WORKFLOW_DIR, file), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!SETUP_NODE.test(lines[i])) continue;
    steps++;

    let found = null;
    for (let j = i + 1; j < lines.length; j++) {
      // Stop at the next step -- but not on the `- uses:` line we started from.
      if (NEXT_ITEM.test(lines[j])) break;
      const v = lines[j].match(NODE_VERSION);
      if (v) {
        found = { line: j + 1, kind: 'node-version', value: unquote(v[1]) };
        break;
      }
      const f = lines[j].match(NODE_VERSION_FILE);
      if (f) {
        found = { line: j + 1, kind: 'node-version-file', value: unquote(f[1]) };
        break;
      }
    }

    const where = `${WORKFLOW_DIR}/${file}`;
    if (!found) {
      // No pin at all: the step silently inherits whatever Node the runner
      // image ships, which GitHub bumps without telling us.
      offenders.push({
        where: `${where}:${i + 1}`,
        problem: 'declares no Node version -- inherits the runner default',
        fix: `add "node-version: '${pin}'"`,
      });
      continue;
    }

    if (found.kind === 'node-version-file') {
      // Pointing at the pin file is the ideal form; anything else is a second
      // source of truth.
      if (found.value.replace(/^\.\//, '') !== PIN_FILE) {
        offenders.push({
          where: `${where}:${found.line}`,
          problem: `reads its version from "${found.value}", not ${PIN_FILE}`,
          fix: `use "node-version-file: ${PIN_FILE}"`,
        });
      }
      continue;
    }

    // A `${{ }}` expression (matrix input, env, workflow input) cannot be
    // resolved from the file, so the guard cannot tell 22 from 20 here. Fail
    // closed and say why, rather than either waving it through or reporting the
    // raw expression as if it were a version number. A deliberate multi-version
    // compatibility matrix is a real thing to want -- it just needs deciding
    // out loud, since it is exactly the gates-vs-release split done on purpose.
    if (found.value.includes('${{')) {
      offenders.push({
        where: `${where}:${found.line}`,
        problem: `resolves its version from an expression (${found.value}) that this guard cannot evaluate`,
        fix: `pin it literally as '${pin}', or extend this guard if a multi-version matrix is intended`,
      });
      continue;
    }

    if (found.value !== pin) {
      offenders.push({
        where: `${where}:${found.line}`,
        problem: `pins Node ${found.value}, but ${PIN_FILE} says ${pin}`,
        fix: `change it to '${pin}', or bump ${PIN_FILE} if the whole repo should move`,
      });
    }
  }
}

if (offenders.length === 0) {
  console.log(
    `check-node-version: OK (${steps} setup-node step(s) across ${files.length} workflow(s), all on Node ${pin}).`,
  );
  process.exit(0);
}

const plural = offenders.length === 1 ? 'step disagrees' : 'steps disagree';
console.error(`check-node-version: ${offenders.length} setup-node ${plural} with ${PIN_FILE} (Node ${pin})\n`);
for (const o of offenders) {
  console.error(`  • ${o.where} -- ${o.problem}`);
  console.error(`    ${o.fix}`);
}
console.error(`
Every workflow must run the Node version in ${PIN_FILE}, so that what CI
verifies is what release publishes from. When those drift apart, PR gates
validate code on a runtime nothing ships from -- and a dependency that needs the
newer one can abort the test worker mid-run, which vitest reports as a PASSING
suite with silently missing cases (#3812).

To move the whole repo to a new Node version, edit ${PIN_FILE} and then update
every step this guard lists.`);
process.exit(1);
