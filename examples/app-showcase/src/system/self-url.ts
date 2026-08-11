// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The showcase's **single source of truth for its own base URL** (#7538).
 *
 * Several showcase surfaces point at the running server itself so their demo is
 * observable with no external dependency: the hand-wired `rest` connector
 * plugin in objectstack.config.ts, and the two declarative REST/OpenAPI
 * connector instances in `src/system/connectors/`. Before #7538 the plugin read
 * `SHOWCASE_SELF_URL` while the declarative instances carried the literal
 * `http://127.0.0.1:3000` — so on any instance NOT listening on 3000 (CI, QA,
 * any dev boot on an isolated port) every flow dispatching through those
 * connectors failed with `fetch failed`. That failure is indistinguishable from
 * a sandbox egress block, which is what made it expensive: the QA run in #7516
 * only proved it was an address problem by putting a TCP forwarder on 3000.
 *
 * Resolution order — most explicit first:
 *
 * 1. `SHOWCASE_SELF_URL` — a full base URL. The escape hatch for anything the
 *    port alone cannot express (a different host/interface, https, a proxy
 *    prefix). Kept as the primary knob because objectstack.config.ts already
 *    documented it.
 * 2. `OS_PORT`, then its deprecated alias `PORT` — **the same names, in the
 *    same order, that the CLI itself reads to choose the listen port**
 *    (`packages/cli/src/commands/serve.ts`: `readEnvWithDeprecation('OS_PORT',
 *    'PORT') ?? '3000'`). Following the CLI's own inputs is what makes the
 *    isolated-port boot self-ping correctly with no extra configuration — the
 *    exact case #7538 was filed for.
 * 3. `http://127.0.0.1:3000` — the historical literal, unchanged, so a plain
 *    `pnpm dev` behaves exactly as before.
 *
 * **When this is read matters.** These are ordinary Node modules evaluated at
 * config load, so the read happens in whichever process loads
 * objectstack.config.ts. On the `os dev` / `os serve` path that is the serving
 * process itself, so the value follows the live environment. On the
 * artifact-only path (`os build` once, then `os start --artifact`) the
 * connector metadata is serialized into `dist/objectstack.json`, so the value
 * is frozen at BUILD time — set the env for the build, not just the boot.
 * (The plugin in `plugins:` is code and cannot be serialized at all, so it only
 * exists on the config-load path.)
 */

// Ambient `process` for the env reads below — the showcase tsconfig doesn't
// pull in `@types/node`, but the CLI provides the real `process` at runtime.
// Same idiom (and same reason) as the declaration in objectstack.config.ts:
// keeps `pnpm typecheck` green without widening the type surface.
declare const process: { env: Record<string, string | undefined> };

/** The listen port the CLI defaults to when neither `OS_PORT` nor `PORT` is set. */
export const SHOWCASE_DEFAULT_PORT = '3000';

/** The base URL used when nothing in the environment says otherwise. */
export const SHOWCASE_DEFAULT_SELF_URL = `http://127.0.0.1:${SHOWCASE_DEFAULT_PORT}`;

/**
 * Resolve the base URL at which this showcase instance can reach itself.
 *
 * @param env - Environment to read. Defaults to `process.env`; injectable so
 *   tests can assert each precedence rung without mutating the real process.
 */
export function resolveShowcaseSelfUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.SHOWCASE_SELF_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const port = env.OS_PORT?.trim() || env.PORT?.trim() || SHOWCASE_DEFAULT_PORT;
  return `http://127.0.0.1:${port}`;
}
