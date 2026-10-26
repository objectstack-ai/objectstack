import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#3448 — the wiring test for `scripts/check-doc-links.mjs`.
 *
 * The script is older than its gate. It existed, worked, and nothing under
 * `.github/` called it, so it had never run in CI at all and `main` carried a
 * broken link it would have caught (#3213, #3292). PR #3450 fixed that by adding
 * it as a step in `ci.yml`'s `docs` job — and rebuilt half the hole in the
 * process: `ci.yml` THEN listed every markdown path, plus `content/**`,
 * `docs/**` and `apps/site/**`, under the `paths-ignore` of both its triggers;
 * `paths-ignore` skips the *entire* workflow when every changed file matches it,
 * and GitHub has no per-job path filter. A docs-only PR therefore started no
 * workflow, so the one class of change most likely to break an internal link was
 * the one class the link check could never see.
 *
 * That paragraph is history — its lead-in used to be written in the present
 * tense, which objectui#4381 corrected here and in the workflow's own header.
 * objectui#3523 step 2 deleted `paths-ignore` from `ci.yml`'s `pull_request`
 * trigger; it survives only on `push`, so a docs-only PR does start `ci.yml` now
 * (measured: PR #3856, one markdown file, 16 checks) and objectui#3857 pinned
 * the correction. The in-job switch would not keep a link check out either — the
 * `docs` job runs its steps whenever anything the site build consumes changed,
 * which since objectui#8647 is a superset of `content/` and `apps/site/`.
 * What outlived the premise is what the assertions below pin: `ci.yml` keeps the
 * filter on its `push` lane, so a docs-only push to `main` starts it not at all,
 * and #3448 settled one gate, one home.
 *
 * `control-bytes.yml` hit this exact wall first and its header states the
 * consequence: a gate that cannot see a markdown-only PR "rebuilds the hole it
 * exists to close". `changeset-guard.yml` is the second instance. This is the
 * third, and the test below is what keeps it from regressing — the failure mode
 * is silent by construction, because a path-filtered gate looks green and
 * configured while simply never running.
 *
 * The last assertion pins the de-duplication decision, not just the shape: the
 * check has exactly ONE home. Re-adding a copy to a path-filtered workflow is
 * the specific mistake that would restore the illusion of coverage.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'scripts/check-doc-links.mjs';

// Retired with objectstack#25712: the workflow half of `exists at all`, `runs
// the link checker`, `gates pull requests, not just pushes`, `carries NO path
// filter of any kind`, `is the only workflow that runs the link checker`, and
// `every workflow that runs it is one a docs-only PR can start`. Each read
// objectui's `repo-gates.yml`, this gate's only home, and that file runs
// nowhere under the monorepo: GitHub runs the root `.github/workflows/` alone,
// and no workflow there runs this gate. objectstack#25880 ports the
// `repo-gates.yml` gates (row 24 of the objectstack#25697 workflow roster) into
// the root `Lint UI` job and brings these pins back against that job, by path.

describe('the internal link checker is reachable by name', () => {
  it('exists at all', () => {
    expect(fs.existsSync(path.join(repoRoot, SCRIPT)), `${SCRIPT} must exist for a workflow to run it`).toBe(true);
  });

  it('is runnable locally under the name the docs give', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['docs:check-links']).toBe(`node ${SCRIPT}`);
  });
});
