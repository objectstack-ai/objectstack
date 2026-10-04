// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Resolve the optional ADR-0080 SDUI component manifest, and say what the JSX
 * page gate could and could not check because of it.
 *
 * `validateJsxPages` does full component/prop validation when a manifest is in
 * hand and falls back to parse-level checking when it is not. The resolution
 * order (project file, then the copy shipped inside `@objectstack/console`) used
 * to live inline in `validate.ts` — the only command that ran the JSX gate. Once
 * `os build` and `os lint` run it too (#4409), a rule whose STRENGTH depends on
 * how its caller resolves an input is a second drift axis waiting to open: the
 * same page could pass on one command and fail on another purely because one
 * call site forgot the console fallback. One resolver, three callers.
 *
 * ## The fallback is never silent (#20113)
 *
 * This resolver used to return `unknown` — the manifest, or `undefined` for
 * every other outcome, with no signal. So all three commands checked `kind:
 * 'html'` pages at parse level only and reported success without saying so: a
 * verifier that silently degrades, which AGENTS.md "Route & surface ownership"
 * rule 3 calls worse than no verifier, because it reports success. It now says
 * WHY it has no manifest, and {@link resolveJsxGateManifest} turns that answer
 * into what each command does:
 *
 *   - `resolved`  → full validation; nothing to say.
 *   - `absent`    → parse level, and ONE notice naming what did not run and
 *                   every place a manifest was looked for. The exit status is
 *                   untouched on every face, `--strict` included: failing here
 *                   would break every project that has no manifest of its own,
 *                   and such a project has no remedy but to author one.
 *   - `unusable`  → a manifest that is present but cannot be read, parsed, or
 *                   carries no `components` map. REFUSED (exit 1), never
 *                   degraded: its author asked for full validation, and the
 *                   `{}` shape already crashed the gate with a bare TypeError
 *                   while `{ oops` passed it silently — one rule now covers
 *                   both, with the file and the reason named. The same rule
 *                   holds for the copy `@objectstack/console` ships (below):
 *                   a damaged install is refused with that remedy, never read
 *                   as "not found".
 *
 * Both the notice and the refusal fire only when the run has a page the JSX
 * gate actually checks. With none, the manifest is read by nothing, so a
 * missing or broken one degrades nothing and silence is the true answer.
 *
 * "The run" is EVERY stack the gate is handed, not the union fold alone
 * ({@link jsxGateStacks}). The fold keeps any collection the top level already
 * carries, `pages: []` included, while the per-package pass still hands each
 * `packages[]` body to the gate with the same manifest. Counting the fold alone
 * read 0 for a top-level `pages` key beside package-carried html pages, so that
 * layout got no notice and a broken manifest passed at exit 0: the silent
 * degradation this module exists to end, one layout over (#20113 round 1).
 *
 * ## The console leg is reached through `package.json` (#19922)
 *
 * The second place looked is the copy `@objectstack/console` ships in its
 * `dist/` — objectui's public-tier registry at the pinned commit, copied in by
 * `scripts/build-console.sh`. This leg used to ask for that file by its own
 * subpath, which the console's `exports` map does not publish (it publishes
 * `./package.json` alone): the resolve threw `ERR_PACKAGE_PATH_NOT_EXPORTED`, a
 * `catch` swallowed it, and a project with no manifest of its own was checked
 * at parse level even where the console shipped the file. It now resolves the
 * console's `package.json` from the CLI's OWN location and joins the file's
 * path to it ({@link consoleSduiManifestPath}), which keeps `exports` closed.
 *
 * ## The project leg is read beside the config, not in the invoker's cwd (#20166)
 *
 * The first place looked is the project's own `sdui.manifest.json`, and the
 * project is the directory of the config the command was given. `os validate
 * path/to/objectstack.config.ts` locates everything else about that project
 * from there — the capability preflight's `projectDir`, the access-matrix
 * snapshot beside the config — so the manifest follows the same root. It used
 * to follow the invoker's working directory instead: run from anywhere else,
 * the command never read the project's own manifest, and a manifest that
 * happened to sit in the invoker's directory judged a project it does not
 * belong to. {@link resolveJsxGateManifest} therefore takes the project
 * directory as a REQUIRED argument, with no working-directory default for a
 * caller to fall into; `os validate`, `os build` and `os lint` hand it
 * `dirname()` of the config path `loadConfig` resolved. A run started in the
 * project's own directory is unchanged, because that directory is both.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import chalk from 'chalk';
import type { AuthoringFinding } from '@objectstack/lint';
import { artifactPackages, packageBodyAsStack } from './artifact-packages.js';
import { printErrorToStderr, printInfo } from './format.js';
import { authoringRuleUnionStack } from './stack-collections.js';

/** The file the project provides, looked for in the project directory: the config's own directory. */
export const PROJECT_SDUI_MANIFEST_FILE = 'sdui.manifest.json';

/**
 * The copy shipped inside `@objectstack/console` — the second place looked —
 * named as a package-relative path. ⛔ A name, not a specifier to resolve: the
 * console's `exports` map publishes `./package.json` alone, so resolving this
 * subpath throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. {@link consoleSduiManifestPath}
 * reaches the file; this spelling names it only when `@objectstack/console`
 * itself cannot be resolved.
 */
export const CONSOLE_SDUI_MANIFEST = '@objectstack/console/dist/sdui.manifest.json';

/** The one subpath the console's `exports` map publishes. */
const CONSOLE_PACKAGE_JSON = '@objectstack/console/package.json';

/** Where `scripts/build-console.sh` puts the manifest, relative to the console package root. */
const CONSOLE_MANIFEST_IN_PACKAGE = 'dist/sdui.manifest.json';

/**
 * The rule id the parse-level notice carries on every face: the `rule` of the
 * record in `os validate --json` / `os build --json` `warnings`, of the
 * `suggestion` in `os lint`'s `issues`, and the bracketed tag on the text face
 * of the first two. A stable anchor — the prose around it is not one.
 */
export const JSX_PARSE_LEVEL_ONLY_RULE = 'sdui/jsx-parse-level-only';

/** What {@link resolveSduiManifest} found. Never a bare `undefined`. */
export type SduiManifestResolution =
  | {
      readonly status: 'resolved';
      readonly manifest: unknown;
      /** The file the manifest was read from. */
      readonly path: string;
    }
  | {
      readonly status: 'absent';
      /**
       * Every place looked, in order: the project's absolute path, then the
       * console copy's — absolute when `@objectstack/console` resolves, else
       * {@link CONSOLE_SDUI_MANIFEST}.
       */
      readonly lookedAt: readonly string[];
    }
  | {
      readonly status: 'unusable';
      /** Whose file: the project's own, or the copy `@objectstack/console` ships. */
      readonly source: 'project' | 'console';
      /** The manifest file that exists but cannot be used. */
      readonly path: string;
      /** Why, as a clause: `it is not valid JSON (…)`. */
      readonly reason: string;
    };

type AnyRec = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read one manifest file. `components` is the one key `compile()` in
 * `@objectstack/sdui-parser` dereferences unconditionally (`Object.keys(
 * manifest.components)`), so it is the shape floor — deeper checking is the
 * gate's own business once it has a manifest to check against.
 */
function readManifestFile(path: string, source: 'project' | 'console'): SduiManifestResolution {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { status: 'unusable', source, path, reason: `it could not be read (${(error as Error).message})` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { status: 'unusable', source, path, reason: `it is not valid JSON (${(error as Error).message})` };
  }
  if (!isRecord(parsed) || !isRecord(parsed.components)) {
    return { status: 'unusable', source, path, reason: 'it is not a JSON object with a `components` map' };
  }
  return { status: 'resolved', manifest: parsed, path };
}

/**
 * Where `@objectstack/console` keeps the manifest it ships, as an absolute
 * path, or `undefined` when that package cannot be resolved from `origin`.
 * Whether the file exists there is the caller's question.
 *
 * Reached through the console's `package.json` plus a join — the way
 * `resolveConsolePath()` already locates this static-asset package — because
 * the file's own subpath is not in the console's `exports` (see
 * {@link CONSOLE_SDUI_MANIFEST}).
 *
 * `origin` defaults to THIS module, so the console found is the CLI's own
 * declared dependency, released in one fixed version group with it. ⛔ Not
 * `cwd`: under pnpm a project that does not itself depend on
 * `@objectstack/console` cannot resolve it from its own directory, and the
 * gate's strength would then depend on hoisting. The parameter exists for the
 * pins, which drive an installed-package layout.
 */
export function consoleSduiManifestPath(origin: string | URL = import.meta.url): string | undefined {
  let packageJson: string;
  try {
    packageJson = createRequire(origin).resolve(CONSOLE_PACKAGE_JSON);
  } catch {
    return undefined;
  }
  return join(dirname(packageJson), CONSOLE_MANIFEST_IN_PACKAGE);
}

/**
 * The manifest for the project whose directory is `cwd`, or the reason there
 * is none: the project's own file first, then the copy `@objectstack/console`
 * ships (located from `consoleOrigin`, see {@link consoleSduiManifestPath}).
 * Never throws: what an `unusable` answer costs is the caller's decision
 * ({@link resolveJsxGateManifest} refuses it; `init`'s scaffold check, which
 * reads the INVOKER's directory rather than the project's, does not).
 *
 * ⚠️ Despite its name, `cwd` is the PROJECT directory — the directory of the
 * config the command was given — whenever a command judges a project: the
 * three authoring commands pass it through {@link resolveJsxGateManifest}.
 * The working-directory default serves `init`'s scaffold check alone, whose
 * module header records that reading as its own decision. ⛔ A new caller that
 * has a config path passes that path's directory: never `process.cwd()`, and
 * never the default.
 */
export function resolveSduiManifest(
  cwd: string = process.cwd(),
  consoleOrigin: string | URL = import.meta.url,
): SduiManifestResolution {
  const projectManifest = join(cwd, PROJECT_SDUI_MANIFEST_FILE);
  if (existsSync(projectManifest)) return readManifestFile(projectManifest, 'project');

  const consoleManifest = consoleSduiManifestPath(consoleOrigin);
  if (consoleManifest !== undefined && existsSync(consoleManifest)) return readManifestFile(consoleManifest, 'console');
  return { status: 'absent', lookedAt: [projectManifest, consoleManifest ?? CONSOLE_SDUI_MANIFEST] };
}

/**
 * `os serve`'s half of the save door's page compile (#20312, ADR-0080 §5):
 * hand the deployment's manifest to the runtime once, at boot, or say once why
 * there is none.
 *
 * `register` receives the manifest when {@link resolveSduiManifest} answers
 * `resolved` — `os serve` registers it under `@objectstack/metadata-protocol`'s
 * `SDUI_MANIFEST_SERVICE`, where the save door reads it per publish and
 * compiles every html page's `source` against it. For `absent` and `unusable`
 * nothing is registered, the boot continues, and the returned line is the one
 * thing the host prints: without a manifest the save door stores an html page
 * as it always did, with its source and `requires` unjudged, and AGENTS.md
 * "Route & surface ownership" rule 3 says that absence is said once at boot,
 * naming the remedy. `undefined` when a manifest was registered.
 *
 * ⛔ An `unusable` manifest is not refused here the way the authoring commands
 * refuse it ({@link resolveJsxGateManifest}): those judge a project, and their
 * author asked for full validation; a server that refused to boot over it would
 * take the whole deployment down for one damaged file. It is named in the line
 * instead.
 *
 * `projectDir` is the directory of the config being served, as for the
 * authoring commands; `resolution` is the pins' seam.
 */
export function registerDeploymentSduiManifest(
  register: (manifest: unknown) => void,
  projectDir: string,
  resolution: SduiManifestResolution = resolveSduiManifest(projectDir),
): string | undefined {
  if (resolution.status === 'resolved') {
    register(resolution.manifest);
    return undefined;
  }
  const why =
    resolution.status === 'unusable'
      ? `${resolution.path} is not a usable SDUI component manifest: ${resolution.reason}`
      : `no SDUI component manifest at ${resolution.lookedAt.join(' or ')}`;
  return (
    `Page source and \`requires\` not validated at save: ${why}. Html pages are stored without being ` +
    `compiled against this deployment's components — add ${join(projectDir, PROJECT_SDUI_MANIFEST_FILE)} ` +
    `or install @objectstack/console with its manifest.`
  );
}

/**
 * Every stack the JSX gate is handed in one run of `os validate` / `os build` /
 * `os lint`, from the stack the command parsed: the union run's
 * `authoringRuleUnionStack()` fold, then each `packages[]` body as the
 * per-package pass judges it — read through that pass's OWN enumeration
 * (`artifactPackages` + `packageBodyAsStack`), ⛔ never a second walk of
 * `packages[]`, so the two cannot disagree about which bodies are judged.
 *
 * Handed an already-folded stack it answers the same: the fold keeps
 * `packages`, and re-folding a folded stack returns it by identity.
 */
export function jsxGateStacks(stack: AnyRec): AnyRec[] {
  return [
    authoringRuleUnionStack(stack),
    ...artifactPackages(stack).map((pkg) => packageBodyAsStack(pkg.body, stack.packages)),
  ];
}

/**
 * The pages one stack's JSX gate checks AGAINST a manifest: `kind: 'html'`
 * (and its deprecated alias `'jsx'`) with a non-empty `source`, over the
 * collection authored either as an array or as a name-keyed map — each keyed
 * by the name the gate reports it under (`page "NAME"`; a map entry's key when
 * the entry carries no `name`), or by the record itself when it has neither.
 *
 * The kind set is `validateJsxPages`'s own (`packages/lint/src/
 * validate-jsx-pages.ts`), and the empty-source pages are left out because the
 * gate refuses those with `jsx-page-empty-source` before a manifest is ever
 * consulted. `sdui-manifest.test.ts` holds the two equal by driving the real
 * rule, so a kind the gate starts or stops checking reds there.
 */
function checkedPageKeys(stack: AnyRec): unknown[] {
  const pages = stack.pages;
  const entries: Array<[string | undefined, unknown]> = Array.isArray(pages)
    ? pages.map((page): [undefined, unknown] => [undefined, page])
    : isRecord(pages)
      ? Object.entries(pages)
      : [];
  const keys: unknown[] = [];
  for (const [mapKey, page] of entries) {
    if (!isRecord(page)) continue;
    if (page.kind !== 'html' && page.kind !== 'jsx') continue;
    if (typeof page.source !== 'string' || page.source.trim() === '') continue;
    const name = typeof page.name === 'string' && page.name !== '' ? page.name : mapKey;
    keys.push(name === undefined ? page : `page:${name}`);
  }
  return keys;
}

/**
 * How many DISTINCT pages the JSX gate checks against a manifest across every
 * stack it is handed ({@link jsxGateStacks}). Distinct by page name, because a
 * page reaches the gate twice whenever both runs see it: the fold copies an
 * absent `pages` in from the bodies, and an additive artifact's top-level
 * `pages` already IS the union of them. ⚠️ So two packages each shipping a
 * page under the SAME name count once — a name collision, not a layout this
 * count is the place to judge.
 */
export function countJsxGatePages(stack: AnyRec): number {
  const seen = new Set<unknown>();
  for (const judged of jsxGateStacks(stack)) {
    for (const key of checkedPageKeys(judged)) seen.add(key);
  }
  return seen.size;
}

/**
 * A refusal already written to stderr, so each command's catch-all exits 1
 * without rendering it again (`isReportedError` reads the marker structurally)
 * and its `--json` face carries `message` as the envelope's `error`.
 *
 * ⛔ No `code` and no `httpStatus`: `errorCodeFields()` reads exactly those two
 * names off a thrown error, and adding either would mint an ADR-0112 code
 * through the back door — the same restraint `ConfigRefusalError` keeps.
 */
export class SduiManifestRefusalError extends Error {
  readonly hints: readonly string[];
  readonly reportedToStderr = true;

  constructor(message: string, hints: readonly string[]) {
    super(message);
    this.name = 'SduiManifestRefusalError';
    this.hints = hints;
  }
}

/** What the three authoring commands hand the JSX gate, and what they say about it. */
export interface JsxGateManifest {
  /** The `sduiManifest` for `runAuthoringRules` / `runPerPackageAuthoringRules` / `lintConfig`. */
  readonly sduiManifest: unknown;
  /**
   * Empty, or the ONE parse-level notice. A list so each command spreads it
   * into its existing advisory channel rather than growing a new key: the
   * `warnings` of `os validate --json` / `os build --json`, and — graded
   * `info` → `suggestion` by `os lint`'s one mapping — `os lint`'s `issues`.
   */
  readonly notices: readonly AuthoringFinding[];
}

/**
 * The one decision the three authoring commands share about the manifest,
 * made once per run. `stack` is the stack the command parsed; the pages
 * counted are those of every stack the gate is handed ({@link jsxGateStacks}),
 * so a page carried only inside `packages[]` counts whatever the top level
 * holds. Throws {@link SduiManifestRefusalError} for an `unusable` project
 * manifest when there is a page to check; see the header for the three
 * outcomes.
 *
 * `projectDir` is the directory of the config the command was given, and it
 * is required: see the header for why the project leg is read there and not
 * in the invoker's working directory (#20166). `resolution` is the pins'
 * seam — an answer already made, standing in for the resolver's over
 * `projectDir`.
 */
export function resolveJsxGateManifest(
  stack: AnyRec,
  projectDir: string,
  resolution: SduiManifestResolution = resolveSduiManifest(projectDir),
): JsxGateManifest {
  if (resolution.status === 'resolved') return { sduiManifest: resolution.manifest, notices: [] };
  const pages = countJsxGatePages(stack);
  if (pages === 0) return { sduiManifest: undefined, notices: [] };

  if (resolution.status === 'unusable') {
    const message = `${resolution.path} is not a usable SDUI component manifest: ${resolution.reason}`;
    const hints = [
      `  The JSX page gate reads this file to check the components and props of ${pages} kind:'html' ` +
        `page(s), and it does not fall back to parse-level checking while the file is present.`,
      resolution.source === 'project'
        ? '  Fix the file (a JSON object with a `components` map), or remove it to check those pages at parse level only.'
        : '  It is the copy @objectstack/console ships, so that install is damaged: reinstall @objectstack/console.',
    ];
    printErrorToStderr(message);
    console.error('');
    for (const hint of hints) console.error(chalk.dim(hint));
    throw new SduiManifestRefusalError(message, hints);
  }

  const [projectManifest, ...elsewhere] = resolution.lookedAt;
  return {
    sduiManifest: undefined,
    notices: [
      {
        severity: 'info',
        rule: JSX_PARSE_LEVEL_ONLY_RULE,
        where: 'pages',
        path: 'pages',
        message:
          `${pages} kind:'html' page(s) checked at parse level only — component and prop checking did not ` +
          `run: no SDUI component manifest at ${[projectManifest, ...elsewhere].join(' or ')}`,
        hint:
          `Add ${projectManifest} (a JSON object with a \`components\` map) to check the components and ` +
          `props those pages use.`,
      },
    ],
  };
}

/**
 * The text face of the notice for `os validate` and `os build`, printed at the
 * JSX gate's step so it shows on the failing paths too. `os lint` renders the
 * same record through its own issue printer instead.
 */
export function printJsxGateNotices(notices: readonly AuthoringFinding[]): void {
  for (const n of notices) {
    printInfo(`[${n.rule}] ${n.message}`);
    console.log(chalk.dim(`      → ${n.hint}`));
  }
}
