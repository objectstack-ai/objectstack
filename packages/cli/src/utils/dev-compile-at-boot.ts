// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Whether a development boot compiles the config into the artifact it is about
 * to serve, before the server starts (#26130). Both dev doors read this one
 * decision: `os dev` before it spawns its `serve` child, and a direct
 * `os serve --dev` before it composes the dev artifact door (#26242). Lifted
 * here from `commands/dev.ts` so the second door reads it instead of restating
 * it (`dev.ts` imports `serve.ts`, so `serve.ts` cannot import `dev.ts`).
 *
 * Yes by default whenever the boot serves an artifact it builds and there is a
 * config to build it from. The reason is the dev boot's two copies of one
 * stack. A host config's dev boot serves the stack from TWO places: the config
 * MODULE, evaluated in the serving process (the AppPlugin wrap, whose registry
 * copy is what a provider-bound connector is materialized from, so what
 * dispatch calls), and the compiled artifact (the dev artifact door, whose copy
 * is what `/api/v1/meta/<type>` serves). A config that reads the environment at
 * module evaluation, as `examples/app-showcase`'s self URL reads `OS_PORT`,
 * gives the module copy THIS boot's value and the artifact copy the value of
 * whichever environment last compiled it. Measured on the showcase with
 * `OS_PORT=41302` over an artifact built without it, on `os dev` and on
 * `os serve --dev` alike: `GET /api/v1/meta/connector/showcase_status_api`
 * served `http://127.0.0.1:3000` while the materialized connector called 41302.
 *
 * Compiling in the boot's own environment (`os dev`'s `serve` child inherits
 * the same one) makes both copies one evaluation's answer, so nothing has to
 * restate which variables a config reads or in what order. `os dev`'s watch
 * loop recompiles in that environment too, so the two stay one answer for the
 * whole session.
 *
 * `os dev --no-compile` keeps the old shortcut, booting the artifact as built
 * (and the startup staleness warning says when it is older than the sources);
 * a missing artifact is still compiled, since there is nothing else to serve.
 * A pinned artifact (`--artifact`, `OS_ARTIFACT_URL`, a remote
 * `OS_ARTIFACT_PATH`) is never rebuilt. With no config and a missing artifact
 * the answer is yes, so the caller refuses there with the one remedy line.
 */
export function devCompilesAtBoot(opts: {
  compile: boolean;
  pinned: boolean;
  configExists: boolean;
  artifactExists: boolean;
}): boolean {
  if (opts.pinned) return false;
  if (!opts.artifactExists) return true;
  return opts.compile && opts.configExists;
}
