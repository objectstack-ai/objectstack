/**
 * A build started with `child_process.fork`, handed the worker's environment
 * unchanged — the LEAK objectui#8598's gate exists to refuse, spelled with the
 * spawner that gate could not see before objectui#9211.
 *
 * ⚠️ Not a test and never executed: read only as TEXT by
 * `spawned-build-vitest-env-8598.test.ts`, which parses this file and asks its
 * own `buildSpawns()` what it finds. The `.fixture.ts` extension keeps it out
 * of that gate's LIVE census (`/\.(test|spec)\.tsx?$/`), so the deliberate leak
 * below cannot turn the real gate red. `tsconfig.scripts.json` compiles every
 * `.ts` under `scripts/`, so it does have to type-check.
 *
 * Its pair, `fork-build-scrubbed.fixture.ts`, differs ONLY in what the `env:`
 * does to `VITEST`. Everything else — the spawner, the arguments, the shape of
 * the call — is byte-identical, so the verdict the gate returns is attributable
 * to that one difference and to nothing else.
 */
import { fork } from 'node:child_process';

export function spawnTheBuild(): void {
  fork('scripts/run-package-build.js', ['build'], { env: { ...process.env } });
}
