// Types for `vitest-memory-tmp.mjs`, published for the package vitest configs
// that import it. Several of those configs sit inside a package's
// `tsconfig.test.json` program, where an untyped `.mjs` import is TS7016. See
// `invoked-as.d.mts` for why this pairing exists; this file follows the same
// convention, and `check:declaration-mirrors` holds it in step with the module.

/**
 * The `test.env` that moves `os.tmpdir()` onto /dev/shm:
 * `{ TMPDIR: '/dev/shm' }` when that directory is writable, `{}` otherwise.
 */
export function memoryBackedTmpEnv(): Record<string, string>;
