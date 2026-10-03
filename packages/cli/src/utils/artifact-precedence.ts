// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE artifact precedence for the CLI's boot doors — written once, here.
 *
 *   `--artifact`  >  `OS_ARTIFACT_URL`  >  `OS_ARTIFACT_PATH`
 *     >  `<cwd>/dist/objectstack.json`  >  `<home>/dist/objectstack.json` (`os start` only)
 *     >  a cwd `objectstack.config.ts` (compiled to `<cwd>/dist/objectstack.json`)
 *
 * This is the order `content/docs/deployment/cli.mdx` already publishes for
 * `os start` ("Resolution priority (artifact)"). Each rung is consulted only
 * when every rung above it resolved nothing: the FIRST source that answers is
 * the stack this boot serves, and nothing below it takes part — EXCEPT that a
 * cwd config joins the boot when the resolved artifact is its own compiled
 * output ({@link cwdConfigJoinsBoot}). That is the triage ruling's amendment
 * for a host config, whose code plugins its compiled output cannot carry.
 *
 * ## Why one module, and who asks it
 *
 * `os start` and `os dev` each used to carry their own copy of this order, and
 * the copies had drifted: `dev`'s had no `OS_ARTIFACT_URL` rung at all, so
 * `OS_ARTIFACT_URL=<other> os dev -a X` booted `<other>` — the flag lost to the
 * environment. Worse, the `serve` child both supervisors spawn decided for
 * itself whether to read the supervisor's answer, and read it only when the cwd
 * held no `objectstack.config.ts`. So `os dev -a X` and `os start --artifact X`,
 * run from a project directory, printed `Artifact: X` and served the cwd
 * config's stack (`<cwd>/dist/objectstack.json`, or the config itself) — the
 * flag lost to the working directory, silently.
 *
 * Every door now asks this module:
 *
 *   - {@link resolveArtifactBootSource} — the supervisors (`os start`,
 *     `os dev`) resolve the boot's artifact through it, and print and hand
 *     down exactly its answer;
 *   - {@link cwdConfigJoinsBoot} — the last rung, asked by BOTH ends: the
 *     supervisors (for their `Config:` row) and the `serve` child (for whether
 *     it loads the cwd config at all), so the two cannot disagree about it.
 *
 * ⛔ No second copy of the order belongs anywhere in this package. A door that
 * needs to know which source wins asks this module; a comment that needs to
 * state the order points here.
 *
 * ## What stays outside, on purpose
 *
 * `@objectstack/runtime`'s `resolveDefaultArtifactPath` and the standalone
 * stack's own path input are the RUNTIME's fallback for a caller that names no
 * artifact — a direct `os serve`, or a library host. Every CLI boot that has a
 * supervisor's answer hands it to them explicitly, so their fallback never
 * decides a supervised boot.
 */

import fs from 'fs';
import path from 'path';

/**
 * Where a project's compiled artifact lives by convention, relative to the
 * directory that holds its `objectstack.config.ts` — the path `os build`,
 * `os start` and `os dev` compile to. Rung 3 reads it relative to the cwd.
 */
export const CONVENTIONAL_ARTIFACT_RELATIVE_PATH = path.join('dist', 'objectstack.json');

/** Which rung of the precedence produced a local (or `http(s)://`) artifact. */
export type ArtifactRung = 'flag' | 'env-path' | 'cwd-dist' | 'home-dist';

/**
 * What the precedence answered for one boot.
 *
 * - `resolved` — a rung named an artifact. `path` is absolute (or an
 *   `http(s)://` URL, passed through verbatim); `display` is the banner form.
 *   A rung that NAMES an artifact (`flag`, `env-path`) is not existence-checked
 *   here: a named artifact that is missing is a loud refusal in the child,
 *   never a silent fall-through to the rung below.
 * - `reference` — `OS_ARTIFACT_URL` drives the boot. The supervisor resolves
 *   nothing: the `serve` child owns the fetch, the `#sha256=` verification and
 *   the refusal. `url` is the operator's raw value (credentials and all) — print
 *   it only through a redactor.
 * - `unresolved` — no artifact rung answered. What is left is the last rung,
 *   the cwd config (which a supervisor compiles to the conventional path), or
 *   nothing at all.
 */
export type ArtifactBootSource =
  | { kind: 'resolved'; rung: ArtifactRung; path: string; display: string }
  | { kind: 'reference'; url: string }
  | { kind: 'unresolved' };

/**
 * An `http(s)://` artifact source — fetched by the loader, never a local file.
 * Exported so a door that must not treat a URL as a path (compile into it, stat
 * it, watch it) asks the same test the precedence does.
 */
export function isRemoteArtifact(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Resolve the boot's artifact through THE precedence (module docblock).
 *
 * @param opts.flag    the command's `--artifact` value, if any
 * @param opts.env     the supervisor's OWN environment (the operator's values)
 * @param opts.cwd     the directory relative rungs anchor on
 * @param opts.homeDir the `os start` home — enables rung 4. `os dev` passes
 *                     none: its home is per-run state, never an artifact source.
 */
export function resolveArtifactBootSource(opts: {
  flag?: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  homeDir?: string;
}): ArtifactBootSource {
  const { flag, env, cwd, homeDir } = opts;

  // Rung 1 — the explicit flag, including an http(s):// URL. It outranks the
  // reference too: a supervisor holding a flag hands the child that artifact
  // and removes `OS_ARTIFACT_URL` from the child env (`childEnvWithResolvedArtifact`).
  if (flag) {
    if (isRemoteArtifact(flag)) return { kind: 'resolved', rung: 'flag', path: flag, display: flag };
    const abs = path.resolve(cwd, flag);
    return { kind: 'resolved', rung: 'flag', path: abs, display: path.relative(cwd, abs) };
  }

  // Rung 2a — the published reference. Blank reads as unset, as `serve` reads it.
  const url = env.OS_ARTIFACT_URL?.trim();
  if (url) return { kind: 'reference', url };

  // Rung 2b — the operator's path. Resolved here and handed down on the CLI's
  // internal channel; the variable itself is inherited by the child untouched.
  const envPath = env.OS_ARTIFACT_PATH;
  if (envPath) {
    if (isRemoteArtifact(envPath)) return { kind: 'resolved', rung: 'env-path', path: envPath, display: envPath };
    const abs = path.resolve(cwd, envPath);
    return { kind: 'resolved', rung: 'env-path', path: abs, display: path.relative(cwd, abs) };
  }

  // Rungs 3 and 4 — the conventional locations, which only count when present.
  const cwdCandidate = path.resolve(cwd, CONVENTIONAL_ARTIFACT_RELATIVE_PATH);
  if (fs.existsSync(cwdCandidate)) {
    return { kind: 'resolved', rung: 'cwd-dist', path: cwdCandidate, display: path.relative(cwd, cwdCandidate) };
  }
  if (homeDir) {
    const homeCandidate = path.resolve(homeDir, CONVENTIONAL_ARTIFACT_RELATIVE_PATH);
    if (fs.existsSync(homeCandidate)) {
      return { kind: 'resolved', rung: 'home-dist', path: homeCandidate, display: homeCandidate };
    }
  }

  return { kind: 'unresolved' };
}

/**
 * Is `artifactPath` the compiled output of the config at `configPath`?
 *
 * Two places hold a config's own compiled output, and either one counts:
 *
 * - the conventional `<config dir>/dist/objectstack.json`, where `os build`,
 *   `os start` and a bare `os dev` compile it;
 * - `compiledTo`, the path the supervising command ITSELF compiles the config
 *   to, when that is somewhere else. `os dev` with the operator's local
 *   `OS_ARTIFACT_PATH` compiles the cwd config INTO that path, watches it and
 *   rebuilds it, so the file there is the config's compiled output too, and a
 *   config recognised only at the conventional path would boot as a stranger
 *   to its own build (a host config's code plugins dropped). The command
 *   declares it, never this predicate: the child is told where the parent
 *   compiled the config (`OS_INTERNAL_CONFIG_OUTPUT_PATH`).
 *
 * Compared as resolved absolute paths. A URL is never a config's compiled
 * output. A second spelling of the same file (a symlink) answers `false`, which
 * is the safe direction: that boot serves the named artifact alone, and its
 * bytes are the same file either way.
 */
export function isConfigCompiledArtifact(artifactPath: string, configPath: string, compiledTo?: string): boolean {
  if (isRemoteArtifact(artifactPath)) return false;
  const artifact = path.resolve(artifactPath);
  if (artifact === path.resolve(path.dirname(configPath), CONVENTIONAL_ARTIFACT_RELATIVE_PATH)) return true;
  return compiledTo !== undefined && !isRemoteArtifact(compiledTo) && artifact === path.resolve(compiledTo);
}

/**
 * The last rung, decided once for both ends of a supervised boot: does the cwd
 * `objectstack.config.ts` take part in this boot at all?
 *
 * The config is the LOWEST source, so it joins only when nothing above it named
 * a DIFFERENT stack — the order as triage amended it: a cwd config joins the
 * boot when the resolved artifact is its own compiled output.
 *
 * - `reference` — `OS_ARTIFACT_URL` drives the boot → the config does not join.
 * - `path` — a rung named an artifact → the config joins only when that
 *   artifact IS its own compiled output ({@link isConfigCompiledArtifact}, with
 *   `configCompiledTo` the command's own compile path when it has one): the
 *   config boot then serves that very file as its app bundle (the caller hands
 *   it over explicitly), which is the path `os dev`, a bare `os start` in a
 *   project, and the documented `os start --artifact ./dist/objectstack.json`
 *   all take. For a HOST config (its `plugins` hold code), its own compiled
 *   output cannot carry that code, so the config itself is what boots. Any
 *   other artifact boots ALONE — exactly as it boots from a directory with no
 *   config, never mixed with whatever source tree the process happens to stand
 *   in.
 * - `none` — no artifact rung answered → the config is what boots.
 */
export function cwdConfigJoinsBoot(opts: {
  configExists: boolean;
  configPath: string;
  artifact:
    | { kind: 'none' }
    | { kind: 'reference' }
    | { kind: 'path'; path: string; configCompiledTo?: string };
}): boolean {
  if (!opts.configExists) return false;
  switch (opts.artifact.kind) {
    case 'reference':
      return false;
    case 'path':
      return isConfigCompiledArtifact(opts.artifact.path, opts.configPath, opts.artifact.configCompiledTo);
    case 'none':
      return true;
  }
}
