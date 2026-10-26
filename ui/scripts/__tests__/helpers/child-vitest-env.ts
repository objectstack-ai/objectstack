/**
 * The environment for a vitest a TEST spawns (objectui#8616).
 *
 * ## The defect
 *
 * Vitest asks `std-env` whether it is running under an AI agent and, when the
 * answer is yes, configures itself differently — measured in vitest 4.1.10:
 *
 *   - `createCLI()` calls tinyrainbow's `disableDefaultColors()`, so the run
 *     emits no SGR at all;
 *   - the worker repeats that call for `config.isAgent`;
 *   - the default reporter becomes `agent` instead of `default`;
 *   - coverage defaults to `skipFull` and gains a `text-summary` reporter;
 *   - `watch` defaults off.
 *
 * `isAgent` is read from the ENVIRONMENT, and a child inherits its parent's.
 * So a vitest spawned from inside an agent container is configured differently
 * from the same command on CI, and a test that reads the child's output is
 * asserting against a byte stream CI never produces. Scrubbing the `VITEST*`
 * keys — the natural thing to write, and what every spawn site here already did
 * — does not touch it: those markers are `CLAUDECODE`, `AI_AGENT` and friends.
 *
 * Measured on `4d65991c5`, one tree, one command
 * (`scripts/__tests__/network-escape-worker-coverage-8537.test.ts`'s child):
 *
 * | child env                       | SGR sequences | `/Test Files\s+2 failed \(2\)/` on RAW bytes |
 * |---------------------------------|---------------|----------------------------------------------|
 * | as the container gives it       | 0             | passes                                       |
 * | `env -u CLAUDECODE -u AI_AGENT` | 264           | FAILS, identically to CI                     |
 * | `CI=1 GITHUB_ACTIONS=1`         | 0             | passes — does NOT reproduce                  |
 * | `FORCE_COLOR=1`                 | 0             | passes — does NOT reproduce                  |
 * | this helper                     | 264           | FAILS, identically to CI                     |
 *
 * ⚠️ The two middle rows are why this is worth a helper rather than a comment.
 * Imitating CI is the correct instinct and it is the one that does not work:
 * `CI=true` leaves `isAgent` true. ⛔ Nor does `FORCE_COLOR=1`, which the card
 * proposed: `disableDefaultColors()` OVERWRITES tinyrainbow's palette after
 * `FORCE_COLOR` has already been consulted, so the flag is inert here.
 *
 * ## The shape, and why it is this one
 *
 * ⛔ Not repaired by loosening the assertions to accept either byte stream —
 * that discards what the pins exist to check. ⛔ Nor by forcing `NO_COLOR` on
 * the child, which is deterministic but is a THIRD stream, matching neither
 * the container nor CI. What this returns is the environment CI would give the
 * child: the agent markers removed and nothing else about reporting decided,
 * so the child's own defaults land where CI's land.
 *
 * It is the same repair as objectui#8598's `BUILD_ENV` and objectui#8590's
 * scoped `VITEST` scrub, in the same place for the same reason: the CALLER is
 * the only party that knows its child is a fresh CLI rather than a nested
 * worker, and the only one that can say so.
 *
 * `scripts/__tests__/spawned-vitest-child-env-8616.test.ts` keeps every vitest
 * spawn in the test tree on this helper, and measures — rather than assumes —
 * that what comes back really is read as a non-agent.
 */

/**
 * Every environment variable `std-env` consults to decide `isAgent`, as of
 * std-env 4.1.0 (`detectAgent()`).
 *
 * ⚠️ Three of std-env's probes are PREDICATES over variables that mean
 * something else — `PATH` matching `/\.pi[\\/]agent/`, `EDITOR` matching
 * `/devin/`, `TERM_PROGRAM` matching `/kiro/`. `EDITOR` and `TERM_PROGRAM` are
 * listed here and deleted, because a spawned vitest needs neither. `PATH` is
 * deliberately NOT: deleting it would break the child outright, so on a host
 * whose `PATH` names a `.pi/agent` directory this helper cannot reach a
 * non-agent child. ⛔ That is not papered over — the pin's live control asserts
 * the result IS read as a non-agent, so such a host goes loudly red here rather
 * than silently producing the wrong byte stream somewhere downstream.
 */
export const AGENT_ENV_MARKERS: readonly string[] = [
  'AI_AGENT',
  'AUGMENT_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE',
  'CODEX_SANDBOX',
  'CODEX_THREAD_ID',
  'CURSOR_AGENT',
  'EDITOR',
  'GEMINI_CLI',
  'GOOSE_PROVIDER',
  'OPENCODE',
  'REPL_ID',
  'TERM_PROGRAM',
];

/**
 * The environment for a vitest spawned from inside a vitest.
 *
 * Two removals, and no additions of its own:
 *
 *  1. every `VITEST*` key, so the child is a fresh CLI and not read as a nested
 *     worker (this is what each call site used to hand-roll);
 *  2. every {@link AGENT_ENV_MARKERS} entry, so the child configures itself the
 *     way it does on CI.
 *
 * ⭐ `overrides` is applied LAST and wins, including over the removals: a caller
 * that has its own reason to decide part of the child's reporting — a fixed
 * `NO_COLOR`, a marker its fixture reads — states it at the call site, where
 * the reason lives, and it survives.
 */
export function childVitestEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('VITEST')) delete env[key];
  for (const key of AGENT_ENV_MARKERS) delete env[key];
  return Object.assign(env, overrides);
}
