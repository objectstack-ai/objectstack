// eslint-stack-headroom — the gates that drive ESLint IN-PROCESS must parse the
// same population `pnpm lint` can.
//
// ── THE DEFECT THIS CLOSES (#10449, rate measured in #10451) ────────────────
//
// `@typescript-eslint/parser` recurses over the AST, so what it costs is the
// AST's DEPTH. One file in this repo sits past V8's default ceiling; the full
// measurement (need 1085 KB, V8 default 984 KB, the ~1.10 KB per appended
// fragment, and the `ulimit -s` cliff above which V8 SIGSEGVs instead of
// throwing) lives in ONE place, `eslint.config.mjs`, and is not restated here.
//
// The morning fix for that landed on the root `lint` script's CLI invocation
// (`node --stack-size=4000 node_modules/eslint/bin/eslint.js …`). The two
// ratchets in this directory never go through that entry: they
// `import { ESLint } from 'eslint'` and lint in-process, so they ran on the
// DEFAULT V8 stack. One repo, one file, two invocation paths, one of them
// fixed — which is the whole defect. Measured on this tree, same commit:
//
//   • the gate's own ESLint channel over `registry.ts` alone:
//     10/10 runs FATAL at the default stack, 0/10 with `--stack-size=4000`;
//   • `pnpm check:slot-lookup` over its real population (`packages/**`):
//     2 parse failures in 14 runs at the default stack.
//
// Both numbers come from the same tree. The single-file case is deterministic
// and the whole-population case is intermittent because the verdict depends on
// the OTHER files in the same invocation (measured in `eslint.config.mjs`), not
// on this file's bytes. That asymmetry is load-bearing twice over: it is why
// each red looks like a flake and gets re-run away, and it is why the canary
// below is a LEADING indicator rather than a restatement of the gate.
//
// ── WHY THE FLAG LIVES HERE AND NOT IN A SCRIPT LINE ───────────────────────
//
// `--stack-size` cannot be moved into `NODE_OPTIONS`: node refuses it outright
// (re-confirmed on Node 22.22.2 — `node: --stack-size= is not allowed in
// NODE_OPTIONS`, exit 9). It has to be an argv flag on the node process that
// runs the parser. That leaves two homes, and the script line is the worse one:
// a flag in `package.json` applies only to the exact spelling that carries it,
// so `node scripts/check-slot-lookup-ratchet.mjs` run by hand — the spelling a
// developer reaches for, and the spelling `pnpm check:slot-lookup` itself
// expands to — silently drops the headroom again. `eslint.config.mjs` already
// has to warn twice about exactly that footgun for `pnpm exec eslint`.
//
// A gate that carries its own headroom cannot be invoked without it. So the
// gate re-execs itself once, following the re-exec precedent in
// `scripts/pm/check-governed-merges.mjs` (pure planner + guard env var +
// `spawnSync` inheriting stdio, child's status returned as the gate's).
//
// ⚠️ ONE TRAP, MEASURED. That precedent tests flag support with
// `process.allowedNodeEnvironmentFlags.has(FLAG)`. Do NOT copy that here:
// `allowedNodeEnvironmentFlags` is the set of flags permitted in NODE_OPTIONS,
// and `--stack-size` is precisely the flag that is NOT (that is the same fact
// as the exit-9 above). It returns `false` on a node where the argv flag works
// perfectly, so reusing it would leave the rearm permanently disabled and this
// whole file green, silent and inert. Support is probed by actually spawning
// the flag instead.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { GUARDED_GATES, collectFatalMessages } from './eslint-fatal-guard.mjs';
import { stripComments } from './js-comment-mask.mjs';

/**
 * The headroom the in-process gates run their parser with, in KB.
 *
 * Deliberately the same 4000 the root `lint` script uses, so the two invocation
 * paths that lint this repo agree about what the parser can read — the
 * disagreement between them IS #10449. The bounds behind that number (why not
 * lower, and why nothing near `ulimit -s`) are measured in `eslint.config.mjs`.
 *
 * This constant is owned here rather than derived from the `lint` script, on
 * purpose: the gates' need does not depend on that script keeping its flag, and
 * a derivation would hand a future edit to `package.json` the power to disable
 * these gates' headroom silently. What keeps it HONEST is not a cross-reference
 * but `canaryParseFailures()` below, which fails when this number stops being
 * enough for the tree it actually has to parse.
 */
export const PARSER_STACK_SIZE_KB = 4000;

/** The argv flag itself, so no call site spells the number a second time. */
export const STACK_FLAG = `--stack-size=${PARSER_STACK_SIZE_KB}`;

/** Set on the child, so a rearm can never become a spawn loop. */
export const STACK_REARM_GUARD = 'OS_ESLINT_STACK_REARMED';

/**
 * The file this repo's ESLint population is measured against for parse
 * headroom: today the deepest linted file in the tree by a wide margin.
 *
 * ⚠️ This is a PATH, not a threshold, and the distinction is the point. A gate
 * that pinned "the parser must survive depth N" or "a stack of N KB must
 * suffice" would go stale the next time this file grows — and it grows by
 * design: it is an ADR-0087 D3 forever artifact that gains a step per breaking
 * protocol major, so its depth only ever rises. Asserting that THE CURRENT FILE
 * PARSES re-measures the real question every run and cannot expire.
 *
 * If the file is renamed or removed, the assertion fails loudly (ESLint throws
 * on a target that matches nothing) rather than passing over a canary that no
 * longer exists — which is the failure mode a pinned path otherwise has.
 */
export const HEADROOM_CANARY_FILE = 'packages/spec/src/migrations/registry.ts';

/**
 * Does this process need to re-exec itself with parser headroom before it can
 * lint? Pure, so every branch is testable without spawning anything.
 *
 * @param {{execArgv?: string[], env?: Record<string, string|undefined>, flagSupported?: boolean}} input
 * @returns {{rearm: boolean, flag: string, reason: string}}
 */
export function stackRearmPlan({ execArgv = [], env = {}, flagSupported = true } = {}) {
  if (execArgv.some((a) => a.startsWith('--stack-size'))) {
    return { rearm: false, flag: STACK_FLAG, reason: 'already running with an explicit --stack-size' };
  }
  if (env[STACK_REARM_GUARD] === '1') {
    return { rearm: false, flag: STACK_FLAG, reason: 'already re-armed once this run' };
  }
  if (!flagSupported) {
    return {
      rearm: false,
      flag: STACK_FLAG,
      reason: `this node does not accept ${STACK_FLAG} on argv; the parser runs on the default stack`,
    };
  }
  return {
    rearm: true,
    flag: STACK_FLAG,
    reason: `the in-process parser would otherwise run on V8's default stack (#10449)`,
  };
}

/**
 * Whether this node accepts the flag on ARGV. Probed by spawning it, never by
 * `allowedNodeEnvironmentFlags` — see the trap note at the top of this file.
 *
 * @returns {boolean}
 */
export function probeStackFlagSupported() {
  const probe = spawnSync(process.execPath, [STACK_FLAG, '-e', '0'], { stdio: 'ignore' });
  return probe.status === 0;
}

/**
 * Re-exec this script with parser headroom, once.
 *
 * @param {{scriptPath: string, args?: string[], env?: Record<string, string|undefined>, execArgv?: string[], plan?: ReturnType<typeof stackRearmPlan>, spawn?: typeof spawnSync}} input
 * @returns {{rearmed: boolean, status?: number, reason: string}} `rearmed` true
 *   means the child ran to completion and `status` is the exit code THIS
 *   process should exit with.
 */
export function rearmWithStackHeadroom({
  scriptPath,
  args = [],
  env = process.env,
  execArgv = process.execArgv,
  plan,
  spawn = spawnSync,
} = {}) {
  const decision = plan ?? stackRearmPlan({ execArgv, env, flagSupported: probeStackFlagSupported() });
  if (!decision.rearm) return { rearmed: false, reason: decision.reason };

  const child = spawn(process.execPath, [decision.flag, scriptPath, ...args], {
    stdio: 'inherit',
    env: { ...env, [STACK_REARM_GUARD]: '1' },
  });
  if (typeof child.status === 'number') return { rearmed: true, status: child.status, reason: decision.reason };

  // Could not spawn at all. Continue in-process rather than inventing a
  // failure: the gate then runs on the default stack and either passes or
  // reports the parse failure it was always going to report — but say so, so a
  // reader of the log is not left to infer that the headroom applied.
  return {
    rearmed: false,
    reason: `could not re-exec with ${decision.flag} (${child.error?.message ?? 'no exit status'}); ` +
      'continuing on the default stack',
  };
}

/**
 * The whole thing, as a gate calls it. Re-execs and exits when a rearm is
 * warranted; returns (having printed nothing) when the process already has its
 * headroom.
 *
 * @param {string} scriptPath absolute path of the calling gate
 * @param {string[]} [args] the calling gate's own argv tail
 */
export function ensureStackHeadroom(scriptPath, args = process.argv.slice(2)) {
  const outcome = rearmWithStackHeadroom({ scriptPath, args });
  if (outcome.rearmed) process.exit(outcome.status);
  if (!/^already /.test(outcome.reason)) {
    console.error(`WARNING  eslint-stack-headroom: ${outcome.reason}.`);
  }
}

/**
 * Parse the canary through a gate's OWN ESLint channel and report any parse
 * failure. The instance is passed in rather than built here so that what is
 * proved is the channel the gate really measures with — same config, same
 * `allowInlineConfig`, same process, same stack.
 *
 * Deliberately a SINGLE-file lint: measured on this tree, the narrow scope is
 * the worst case (10/10 fatal at the default stack) while the gate's own
 * whole-population run at the same stack was intermittent (2/14). So this
 * assertion trips BEFORE the population run starts reddening PRs — the point
 * of having it at all.
 *
 * @param {{lintFiles: (targets: string[]) => Promise<object[]>}} eslint
 * @param {{repoRoot: string, file?: string}} options
 * @returns {Promise<ReturnType<typeof collectFatalMessages>>} empty when it parsed
 */
export async function canaryParseFailures(eslint, { repoRoot, file = HEADROOM_CANARY_FILE }) {
  const results = await eslint.lintFiles([file]);
  return collectFatalMessages(results, repoRoot);
}

/**
 * The stack this process is actually running with, as text. Read from argv
 * rather than assumed, so a canary failure can never blame a headroom the run
 * did not have -- the difference between "4000 KB is no longer enough" and
 * "the rearm did not happen", which are opposite bugs with opposite fixes.
 *
 * @param {string[]} [execArgv]
 * @returns {string}
 */
export function stackInEffect(execArgv = process.execArgv) {
  const flag = execArgv.find((a) => a.startsWith('--stack-size'));
  return flag ? `--stack-size=${flag.split('=')[1]}` : "V8's default stack (no --stack-size on this process)";
}

/** The author-facing text for a canary that no longer parses. */
export function formatCanaryFailure(fatals, file = HEADROOM_CANARY_FILE) {
  return [
    `${file} did not parse at ${stackInEffect()}:`,
    ...fatals.map((f) => `    ${f.file}:${f.line}:${f.column} - ${f.message}`),
    '  This is the early warning, not the outage: the gates lint this file inside a',
    '  whole-population run, where the same parse fails only INTERMITTENTLY and each',
    '  red reads as a flake (#10449/#10451). Raise PARSER_STACK_SIZE_KB in',
    '  scripts/eslint-stack-headroom.mjs -- staying well under `ulimit -s`, above',
    '  which V8 SIGSEGVs instead of throwing -- or reduce the file\'s AST depth',
    '  (#10122 is the standing fix for that).',
  ].join('\n');
}

/**
 * The largest `--stack-size` it is safe to ask for on this machine, or null
 * when the limit cannot be read. At or above the OS thread stack V8 runs off
 * the real stack and SIGSEGVs instead of throwing a clean RangeError, so a
 * headroom setting that crosses it turns a loud gate into a crash.
 *
 * @returns {number|null} KB
 */
export function osThreadStackKb() {
  try {
    const out = execFileSync('sh', ['-c', 'ulimit -s'], { encoding: 'utf8' }).trim();
    if (!/^\d+$/.test(out)) return null; // "unlimited", or a shell without it
    return Number(out);
  } catch {
    return null;
  }
}

/**
 * Assert every gate that drives ESLint in-process still arms its own headroom.
 *
 * Read from the gates' own source, for the same reason `checkGuardAdoption()`
 * does it: a gate that quietly stopped re-execing looks, from its output,
 * exactly like one that never lost the flag -- right up until it starts
 * reddening other people's PRs a quarter of the time.
 *
 * @param {string} repoRoot
 * @returns {string[]} problems, empty when every gate still arms it
 */
export function checkHeadroomAdoption(repoRoot) {
  const problems = [];
  for (const gate of GUARDED_GATES) {
    let src;
    try {
      src = readFileSync(resolve(repoRoot, gate), 'utf8');
    } catch {
      problems.push(`${gate}: named as an in-process ESLint gate but unreadable - renamed or removed?`);
      continue;
    }
    // Prose is not adoption. Comment out the call and the identifier is still
    // in the text, so a raw regex reports the gate as armed at exactly the
    // moment it stopped being armed -- found by ablating this check. The
    // repo-wide answer to "comment or code" is scripts/js-comment-mask.mjs;
    // a private strip here would be the 17th copy it exists to retire.
    // `stripComments` rather than `maskComments` because this reports gate
    // NAMES, never a line or an offset into the original text.
    src = stripComments(src);
    if (!/eslint-stack-headroom\.mjs/.test(src)) {
      problems.push(
        `${gate}: does not import scripts/eslint-stack-headroom.mjs. A gate that lints ` +
        'in-process runs on V8\'s default stack, where this repo\'s deepest file does not ' +
        'parse (#10449).',
      );
      continue;
    }
    if (!/ensureStackHeadroom\s*\(/.test(src)) {
      problems.push(
        `${gate}: imports the headroom module but never calls ensureStackHeadroom(). ` +
        'Importing it does not arm it.',
      );
    }
  }
  return problems;
}
