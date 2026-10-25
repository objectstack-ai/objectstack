/**
 * The live-e2e storage state is written by one file, named by two configs and
 * read by the specs — and all four must agree on the SAME tree.
 *
 * ## Why this pin exists where the gate cannot reach
 *
 * `scripts/check-test-path-roots.mjs` rejects a cwd-rooted filesystem path, but
 * its population is `TEST_FILE` — `*.test.*` / `*.spec.*`. A `global-setup.ts`
 * and a `*.config.ts` match neither, so the gate's registry could reach zero
 * (objectui#9188 repaired the last registered entry, the READ in
 * `inline-edit-polish-2572.spec.ts`) while two instances of the very same class
 * sat one directory away, invisible to it (objectui#9519). Widening that gate's
 * population is a scope question of its own and is NOT decided here; this test
 * holds the four known ends of one path together, by content.
 *
 * ## What "the same tree" cost when it was not held
 *
 * Measured for objectui#9519 on this tree: a live run launched from `e2e/`
 * really created `e2e/e2e/live/.auth/state.json`, while the repaired read went
 * looking under the repository root and found nothing. Playwright itself does
 * not save anyone here — `use.storageState` is resolved against the PROCESS
 * CWD, unlike `testDir` and `globalSetup`, which are config-dir rooted.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SELF_DEPTH_BELOW_REPO_ROOT = 3; // scripts / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');

/** Every file that names the live storage state, and how it must root it. */
const PARTICIPANTS = [
  { file: 'e2e/live/global-setup.ts', side: 'writes it' },
  { file: 'playwright.live.config.ts', side: 'names it to Playwright' },
  { file: 'playwright.import-console.config.ts', side: 'names it to Playwright' },
  { file: 'e2e/live/inline-edit-polish-2572.spec.ts', side: 'reads it' },
] as const;

/** A bare relative path reaching a filesystem call or the `storageState` option. */
const AMBIENT_ROOTED =
  /(storageState\s*:|readFileSync\(|writeFileSync\(|mkdirSync\(|existsSync\()\s*'e2e\/live\/\.auth/;

describe('live-e2e storage state — one path, one root (objectui#9519)', () => {
  for (const { file, side } of PARTICIPANTS) {
    it(`${file} roots the state path on its own file (${side})`, () => {
      const src = readFileSync(join(REPO_ROOT, file), 'utf8');

      expect(src).toContain('SELF_DEPTH_BELOW_REPO_ROOT');
      expect(src).toContain('new URL(import.meta.url).pathname');
      expect(src).toMatch(/join\(\s*REPO_ROOT,\s*'e2e\/live\/\.auth\/state\.json'\s*\)/);
      expect(src).not.toMatch(AMBIENT_ROOTED);
    });
  }

  it('the detector fires on the spelling this card repaired', () => {
    expect("  storageState: 'e2e/live/.auth/state.json',").toMatch(AMBIENT_ROOTED);
    expect("const STATE_PATH = join(REPO_ROOT, 'e2e/live/.auth/state.json');").not.toMatch(
      AMBIENT_ROOTED,
    );
  });
});
