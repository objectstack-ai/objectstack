// An honest exit code for the declaration half of a `vite build`.
//
// ## The defect (objectui#5370)
//
// `vite-plugin-dts` builds a full TypeScript program to emit `dist/**/*.d.ts`,
// computes that program's diagnostics, PRINTS them — and then lets the build
// finish green:
//
// fixture-address: a QUOTED TRANSCRIPT of the build output this file exists to fail on
//     src/AppSchemaRenderer.tsx:581:5 - error TS2353: Object literal may only
//       specify known properties, and 'logo' does not exist in type
//       'AppShellBranding'.
//     [unplugin:dts] Declaration files built in 4349ms.
//     ✓ built in 4.62s
//     BUILD_EXIT=0            <- ${PIPESTATUS[0]}, i.e. pnpm's own exit code
//
// Measured on `@object-ui/layout` at `origin/main` `478ec54ce` with one
// deliberate in-source type error. The diagnostic is right there in the log,
// and the exit code — the thing scripts, `turbo`, CI steps and agents actually
// branch on — says success.
//
// ## Why this is worth a hook rather than a shrug
//
// CI is not blind: `type-check` is a separate task and it goes red, so broken
// source does not reach `main` through this. The exposure is to whoever judges
// a package from `build` alone, which is a normal thing to do mid-task: change
// a shared type, rebuild the package so consumers resolve the fresh `.d.ts`,
// see `✓ built` and `EXIT=0`, conclude the package is clean. It is not — and a
// `| tail` or a `grep` for the summary line scrolls the one honest line out of
// view. A build that has already computed the diagnostic and chosen to print it
// is one flag away from also refusing to exit 0.
//
// That is the whole of this module: it does not compute anything new, it does
// not duplicate `type-check`, and it must never become a second, weaker copy of
// it. It converts a diagnostic the build ALREADY HAS into the exit code the
// build already implies.
//
// ## Three properties held on purpose
//
// - **Errors only.** `category === ts.DiagnosticCategory.Error`. Warnings,
//   suggestions and messages stay non-fatal; a gate that fails on a suggestion
//   is a gate someone disables, and disabling it takes the errors with it.
// - **The message carries the diagnostics.** The plugin logged them once, at
//   program creation, hundreds of lines above the failure. Repeating them in
//   the thrown error is not noise — the scrolled-away log line is precisely the
//   defect this module is about, so the failure has to be readable on its own.
// - **One hook, no overlap.** This factory returns `afterDiagnostic` and
//   nothing else, so it can be spread beside
//   `scripts/vite-dts-explicit-extensions.ts` (`beforeWriteFile` + `afterBuild`)
//   without either silently overwriting the other. A duplicate key in an object
//   literal keeps the last one and says nothing.
//   `scripts/__tests__/vite-dts-fail-on-type-errors.test.ts` pins that
//   disjointness so a later hook added here cannot quietly break a call site.
//
// ## What this does NOT reach
//
// `afterDiagnostic` runs at `writeBundle`, before the declaration emit, and is
// handed the diagnostics the plugin computed when it created the program
// (declaration + semantic + syntactic). Diagnostics raised BY the emit itself —
// the `emitSkipped` path inside the plugin's runtime — are appended after this
// hook has run and are therefore outside its reach; the plugin still prints
// them, and the emitted-output assertions in
// `scripts/vite-dts-explicit-extensions.ts` catch the shape where that path
// produces no declarations at all. Widening to that path needs a post-emit
// hook, which collides with `afterBuild` and is deliberately not done here.
//
// Because the throw happens before the emit, a package with type errors also
// stops writing NEW typings — `noEmitOnError` semantics for the declaration
// leg. On a healthy tree (measured: all 22 `vite-plugin-dts` packages on
// `478ec54ce` emit zero diagnostics) nothing changes at all.

import ts from 'typescript';

/** How many diagnostics the failure message quotes before it truncates. */
const DEFAULT_MAX_QUOTED = 10;

export interface DtsFailOnTypeErrorsOptions {
  /**
   * Absolute path of the package root, used to name the package in the failure
   * message and to print diagnostic paths relative to it.
   */
  packageDir: string;
  /** How many diagnostics to quote in the failure message. Defaults to 10. */
  maxQuoted?: number;
}

/** The single `vite-plugin-dts` hook that carries the fix. */
export interface DtsFailOnTypeErrorsHooks {
  afterDiagnostic: (diagnostics: readonly ts.Diagnostic[]) => void;
}

/**
 * The diagnostics that make a build wrong, out of everything the type program
 * reported.
 *
 * Split out from the hook so the predicate can be pinned directly: the
 * difference between "fails on errors" and "fails on anything TypeScript felt
 * like mentioning" is not visible in a passing build.
 */
export function selectFatalDiagnostics(
  diagnostics: readonly ts.Diagnostic[]
): ts.Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
}

/** One diagnostic as `relative/file.ts(line,col): error TS1234: message`. */
export function formatDiagnostic(diagnostic: ts.Diagnostic, packageDir: string): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  const code = `error TS${diagnostic.code}`;

  if (!diagnostic.file || diagnostic.start === undefined) {
    return `${code}: ${message}`;
  }

  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  // `path.relative` is deliberately not used: the diagnostic's file name is
  // already normalized to forward slashes by the plugin, and a relative path is
  // only cosmetic here — a prefix strip cannot fail the way a path computation
  // against the wrong root can.
  const file = diagnostic.file.fileName.startsWith(`${packageDir}/`)
    ? diagnostic.file.fileName.slice(packageDir.length + 1)
    : diagnostic.file.fileName;

  return `${file}(${line + 1},${character + 1}): ${code}: ${message}`;
}

/**
 * The failure message for a set of fatal diagnostics, or `null` when there are
 * none.
 *
 * Exported so the wording — the half of this module a human actually reads when
 * it fires — is pinned by a test rather than by nobody.
 */
export function describeFatalDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  options: DtsFailOnTypeErrorsOptions
): string | null {
  const fatal = selectFatalDiagnostics(diagnostics);
  if (fatal.length === 0) return null;

  const packageDir = options.packageDir.replace(/\\/g, '/').replace(/\/$/, '');
  const maxQuoted = options.maxQuoted ?? DEFAULT_MAX_QUOTED;
  const quoted = fatal.slice(0, maxQuoted).map((d) => `  ${formatDiagnostic(d, packageDir)}`);
  const elided = fatal.length - quoted.length;

  return (
    `[dts-fail-on-type-errors] the declaration build of \`${packageDir}\` reported ` +
    `${fatal.length} type error${fatal.length === 1 ? '' : 's'}, so it must not exit 0:\n` +
    quoted.join('\n') +
    (elided > 0 ? `\n  ... and ${elided} more` : '') +
    `\n\nThe declaration emit was not attempted. Fix the errors, or run ` +
    `\`pnpm --filter <package> type-check\` for the full report.`
  );
}

/**
 * Wire fail-on-type-errors into a `vite-plugin-dts` invocation.
 *
 * ```ts
 * dts({
 *   ...existing,
 *   ...createDtsFailOnTypeErrors({ packageDir: __dirname }),
 * })
 * ```
 */
export function createDtsFailOnTypeErrors(
  options: DtsFailOnTypeErrorsOptions
): DtsFailOnTypeErrorsHooks {
  return {
    afterDiagnostic(diagnostics) {
      const failure = describeFatalDiagnostics(diagnostics, options);
      if (failure !== null) throw new Error(failure);
    },
  };
}
