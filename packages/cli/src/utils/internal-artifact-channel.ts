// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The CLI's INTERNAL parent-to-child artifact channel.
 *
 * `os start` and `os dev` are supervisors: each resolves an artifact, then
 * spawns `os serve` to boot it. They used to hand the resolved path down by
 * writing `OS_ARTIFACT_PATH` into the child environment — the same variable an
 * operator sets to name an artifact. That made the two indistinguishable
 * downstream: every `objectstack.config.ts` evaluated inside the child saw
 * `OS_ARTIFACT_PATH` set on **every** boot, including boots where no operator
 * had ever mentioned it, so a config could not answer "did a human ask for
 * this, or did the CLI put it here?".
 *
 * This module moves the CLI's own plumbing onto a variable the CLI owns, and
 * restores the property downstream consumers need:
 *
 *   **the presence of `OS_ARTIFACT_PATH` in a config's environment means an
 *   operator set it.**
 *
 * ## Why this name
 *
 * `OS_INTERNAL_ARTIFACT_PATH` keeps the mandatory `OS_` prefix and the
 * `OS_{DOMAIN}_{FEATURE}_{QUALIFIER}` shape (AGENTS.md Prime Directive #9),
 * with `INTERNAL` in the domain slot. There is no `INTERNAL` subsystem, and
 * that is the point: like the deliberately ungrouped, deliberately
 * scary-looking `OS_ALLOW_*` escape hatches, the name groups with nothing and
 * reads at a glance as "not a knob you set". It is deliberately **not** listed
 * in `content/docs/deployment/environment-variables.mdx` — a documented name is
 * a supported name, and this one is a private call between two processes the
 * CLI owns both ends of.
 *
 * ## Precedence is unchanged
 *
 * The channel is read by `serve` strictly between `OS_ARTIFACT_URL` and
 * `OS_ARTIFACT_PATH`:
 *
 *   `--artifact` > `OS_ARTIFACT_URL` > `OS_INTERNAL_ARTIFACT_PATH` > `OS_ARTIFACT_PATH` > `<cwd>/dist/objectstack.json`
 *
 * That position is what preserves today's answers exactly, in both directions:
 *
 * - It must beat `OS_ARTIFACT_PATH`, because `os start --artifact X` run with
 *   an operator's `OS_ARTIFACT_PATH=Y` in the environment boots **X** today
 *   (the parent overwrote the variable on the way down). The operator's `Y` is
 *   now inherited by the child untouched, so only a higher-precedence channel
 *   keeps X winning.
 * - It must lose to `OS_ARTIFACT_URL`, because `os dev` writes the channel
 *   unconditionally — as it wrote `OS_ARTIFACT_PATH` unconditionally — and
 *   `OS_ARTIFACT_URL` outranks `OS_ARTIFACT_PATH` in `serve` today.
 *
 * The parent's own resolution ladder is untouched, and so is the value: the
 * child is handed exactly the path the parent resolved, "named" in the sense
 * `resolveDefaultArtifactPath` means it — a named artifact that is missing is
 * still a loud refusal, never a silent empty boot.
 */

/**
 * The internal channel's variable name. Not an operator-facing knob — see the
 * module docblock for why it is spelled this way.
 */
export const INTERNAL_ARTIFACT_PATH_ENV = 'OS_INTERNAL_ARTIFACT_PATH';

/**
 * What a supervisor command decided about the artifact, as handed to the child.
 *
 * - `resolved` — a local path or `http(s)://` URL the parent resolved. It is
 *   passed down verbatim.
 * - `reference` — `OS_ARTIFACT_URL` is driving this boot. The parent resolves
 *   nothing and says nothing: the child owns the fetch, the `#sha256=`
 *   verification and the refusal.
 * - `empty` — nothing resolved, and booting an app-less kernel is the intended
 *   outcome (`os start`'s quick-start mode).
 */
export type ArtifactChannelDecision =
  | { kind: 'resolved'; path: string }
  | { kind: 'reference' }
  | { kind: 'empty' };

/**
 * Build the child environment for a `serve` child: the parent environment plus
 * this command's artifact decision.
 *
 * Two deliberate asymmetries, both load-bearing:
 *
 * 1. **The parent OWNS `OS_INTERNAL_ARTIFACT_PATH` in the child env** — it is
 *    set on a `resolved` decision and *deleted* otherwise, so the value the
 *    child reads is a pure function of what the parent decided. An inherited
 *    copy can never speak for a decision the parent did not make.
 *
 * 2. **`OS_BOOT_EMPTY` is only ever ADDED, never removed.** An operator who
 *    exported it keeps whatever it means for them today; this function does not
 *    quietly start clearing it. What matters for the artifact-reference refusal
 *    is that the CLI does not *add* it on a `reference` boot — setting it there
 *    would tell `serve` that an app-less kernel is an acceptable outcome and
 *    turn an unreachable artifact host into a silently empty platform instead
 *    of the loud refusal the reference boot promises.
 *
 * `OS_ARTIFACT_PATH` is never written here, and never read here. Whatever the
 * parent inherited is passed through untouched — including its exact spelling,
 * so a config downstream sees the operator's own value rather than an
 * absolutised rewrite of it.
 */
export function childEnvWithResolvedArtifact(
  parentEnv: NodeJS.ProcessEnv,
  decision: ArtifactChannelDecision,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...parentEnv };

  if (decision.kind === 'resolved') {
    childEnv[INTERNAL_ARTIFACT_PATH_ENV] = decision.path;
  } else {
    delete childEnv[INTERNAL_ARTIFACT_PATH_ENV];
  }

  if (decision.kind === 'empty') {
    childEnv.OS_BOOT_EMPTY = '1';
  }

  return childEnv;
}

/**
 * Reader side, for `serve`: the artifact path a supervising `os start` /
 * `os dev` already resolved for this process, if any.
 *
 * Returns `undefined` for an unset or blank value so an exported-but-empty
 * variable cannot be mistaken for a decision.
 */
export function readInternalArtifactPath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env[INTERNAL_ARTIFACT_PATH_ENV];
  return raw && raw.trim() !== '' ? raw : undefined;
}
