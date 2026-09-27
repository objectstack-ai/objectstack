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
 *   - `unusable`  → a manifest the PROJECT put in place that cannot be read,
 *                   parsed, or carries no `components` map. REFUSED (exit 1),
 *                   never degraded: its author asked for full validation, and
 *                   the `{}` shape already crashed the gate with a bare
 *                   TypeError while `{ oops` passed it silently — one rule now
 *                   covers both, with the file and the reason named.
 *
 * Both the notice and the refusal fire only when the stack has a page the JSX
 * gate actually checks. With none, the manifest is read by nothing, so a
 * missing or broken one degrades nothing and silence is the true answer.
 *
 * ⛔ The console leg's FAILURE semantics are deliberately unchanged: the
 * specifier below resolves to nothing today (the console's `exports` map does
 * not publish that subpath), and whatever makes it reachable owns what a broken
 * shipped copy should do. Until then a failure there reads as "not found", and
 * the `absent` notice names the location, so it is not silent either.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import chalk from 'chalk';
import type { AuthoringFinding } from '@objectstack/lint';
import { printErrorToStderr, printInfo } from './format.js';

/** The file the project provides, looked for in the working directory. */
export const PROJECT_SDUI_MANIFEST_FILE = 'sdui.manifest.json';

/** The copy shipped inside `@objectstack/console` — the second place looked. */
export const CONSOLE_SDUI_MANIFEST_SPECIFIER = '@objectstack/console/dist/sdui.manifest.json';

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
      /** Every place looked, in order: an absolute path, then a package specifier. */
      readonly lookedAt: readonly string[];
    }
  | {
      readonly status: 'unusable';
      /** The project manifest that exists but cannot be used. */
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
function readManifestFile(path: string): SduiManifestResolution {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { status: 'unusable', path, reason: `it could not be read (${(error as Error).message})` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { status: 'unusable', path, reason: `it is not valid JSON (${(error as Error).message})` };
  }
  if (!isRecord(parsed) || !isRecord(parsed.components)) {
    return { status: 'unusable', path, reason: 'it is not a JSON object with a `components` map' };
  }
  return { status: 'resolved', manifest: parsed, path };
}

/**
 * The manifest for the project in `cwd`, or the reason there is none. Never
 * throws: what an `unusable` answer costs is the caller's decision
 * ({@link resolveJsxGateManifest} refuses it; `init`'s scaffold check, which
 * reads the INVOKER's directory rather than the project's, does not).
 */
export function resolveSduiManifest(cwd: string = process.cwd()): SduiManifestResolution {
  const projectManifest = join(cwd, PROJECT_SDUI_MANIFEST_FILE);
  if (existsSync(projectManifest)) return readManifestFile(projectManifest);

  // Fall back to the manifest shipped inside @objectstack/console (built from
  // objectui's public-tier registry; the CLI already depends on it). See the
  // header: this leg's failure semantics are not this module's to change.
  try {
    const consoleManifest = createRequire(import.meta.url).resolve(CONSOLE_SDUI_MANIFEST_SPECIFIER);
    if (existsSync(consoleManifest)) {
      const fromConsole = readManifestFile(consoleManifest);
      if (fromConsole.status === 'resolved') return fromConsole;
    }
  } catch {
    /* not found — reported below as a place looked */
  }
  return { status: 'absent', lookedAt: [projectManifest, CONSOLE_SDUI_MANIFEST_SPECIFIER] };
}

/**
 * How many pages the JSX gate checks AGAINST a manifest: `kind: 'html'` (and
 * its deprecated alias `'jsx'`) with a non-empty `source`, over the collection
 * authored either as an array or as a name-keyed map.
 *
 * The kind set is `validateJsxPages`'s own (`packages/lint/src/
 * validate-jsx-pages.ts`), and the empty-source pages are left out because the
 * gate refuses those with `jsx-page-empty-source` before a manifest is ever
 * consulted. `sdui-manifest.test.ts` holds the two equal by driving the real
 * rule, so a kind the gate starts or stops checking reds there.
 *
 * Hand it the stack the gate judges — the `authoringRuleUnionStack()` fold —
 * so a page that lives only in `packages[]` is counted.
 */
export function countJsxGatePages(stack: AnyRec): number {
  const pages = stack.pages;
  const entries: unknown[] = Array.isArray(pages) ? pages : isRecord(pages) ? Object.values(pages) : [];
  let count = 0;
  for (const page of entries) {
    if (!isRecord(page)) continue;
    if (page.kind !== 'html' && page.kind !== 'jsx') continue;
    if (typeof page.source !== 'string' || page.source.trim() === '') continue;
    count++;
  }
  return count;
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
 * made once per run over the stack the JSX gate judges. Throws
 * {@link SduiManifestRefusalError} for an `unusable` project manifest when
 * there is a page to check; see the header for the three outcomes.
 */
export function resolveJsxGateManifest(
  stack: AnyRec,
  resolution: SduiManifestResolution = resolveSduiManifest(),
): JsxGateManifest {
  if (resolution.status === 'resolved') return { sduiManifest: resolution.manifest, notices: [] };
  const pages = countJsxGatePages(stack);
  if (pages === 0) return { sduiManifest: undefined, notices: [] };

  if (resolution.status === 'unusable') {
    const message = `${resolution.path} is not a usable SDUI component manifest: ${resolution.reason}`;
    const hints = [
      `  The JSX page gate reads this file to check the components and props of ${pages} kind:'html' ` +
        `page(s), and it does not fall back to parse-level checking while the file is present.`,
      '  Fix the file (a JSON object with a `components` map), or remove it to check those pages at parse level only.',
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
