/**
 * The Node child-process entry points that start a program — ONE definition
 * (objectui#9211).
 *
 * ## The defect this closes
 *
 * Two gates derive a population of child-process call sites by AST and then
 * judge each one's `env:` — `spawned-build-vitest-env-8598.test.ts` (does the
 * child of a spawned BUILD still carry `VITEST`?) and
 * `spawned-vitest-child-env-8616.test.ts` (does a spawned VITEST still carry
 * this container's agent markers?). Each one carried its own hand-maintained
 * copy of this set, and the copies had already diverged: objectui#8616's
 * listed `fork`, objectui#8598's did not, and NEITHER file's prose gave a
 * reason. Measured on `1f4e02995a` and re-measured on `b775500`, `fork` occurs
 * in neither file outside the set literal itself — so it was drift, not an
 * unrecorded decision.
 *
 * ⚠️ The direction of that drift is what makes it worth a module rather than a
 * one-line edit. Dropping a member from a POPULATION set is a false GREEN, not
 * a false red: a build started as `fork('…', ['build'], { env })` simply never
 * entered objectui#8598's population, so the gate that exists to stop `VITEST`
 * reaching a spawned build reported clean about a call site it never looked at.
 * A gate cannot notice that it is judging fewer things than it should.
 *
 * ## Why the module, and not just adding `fork` back
 *
 * The failure is not that the two sets disagreed on a Tuesday — it is the
 * construction that let them: one set, maintained in two places, with nothing
 * comparing them. Repairing only the instance leaves the construction, and the
 * next divergence is written by the same mechanism and noticed by nobody. So
 * the correct shape is made the only spelling available: one exported constant,
 * both gates importing it, no second literal to keep honest.
 *
 * ⭐ Converged UPWARD, to the set that includes `fork`. The other direction —
 * dropping `fork` from objectui#8616's set — narrows a live gate's census, and
 * weakening a gate is not a repair.
 *
 * ⚠️ `fork` is LATENT here, not live: the test tree holds zero `fork(` call
 * sites today, so nothing is leaking through the hole this closes. That is also
 * why `spawned-build-vitest-env-8598.test.ts` carries a fixture-driven case —
 * against a live population of 0, adding `fork` to this set changes no observed
 * result, and a green suite would carry no information about whether it works.
 */
export const SPAWNERS: ReadonlySet<string> = new Set(['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork']);
