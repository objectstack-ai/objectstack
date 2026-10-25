/**
 * The repaired half of the objectui#9211 pair: the same `child_process.fork`
 * build spawn as `fork-build-inherits.fixture.ts`, with `VITEST` removed from
 * the child's environment by the rest-pattern spelling the gate accepts.
 *
 * ⚠️ Not a test and never executed — see the header of its pair for why the
 * `.fixture.ts` extension matters and what the two files are read by.
 *
 * The two fixtures differ only in the `env:`. This one must be judged
 * `scrubbed`; if both came back the same, the gate would be reporting the
 * spawner rather than the environment.
 */
import { fork } from 'node:child_process';

const { VITEST: _vitest, ...BUILD_ENV } = process.env;

export function spawnTheBuild(): void {
  fork('scripts/run-package-build.js', ['build'], { env: BUILD_ENV });
}
