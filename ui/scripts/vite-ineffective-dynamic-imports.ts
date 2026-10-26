import path from 'node:path';
// Hook parameters are annotated explicitly throughout: Vite types each hook as
// `ObjectHook<Fn>` (a function-or-object union), and TypeScript cannot
// contextually infer parameters across such a union — same reason
// `scripts/vite-crypto-stub.ts` and `scripts/vite-maplibre-worker.ts` spell
// their types out.
import type { Plugin, ResolvedConfig, Rollup } from 'vite';

/**
 * Pins rolldown's `INEFFECTIVE_DYNAMIC_IMPORT` warnings to a checked ledger.
 *
 * ## The warning, and what it is telling the truth about
 *
 * Rolldown emits `INEFFECTIVE_DYNAMIC_IMPORT` when a module reached by an
 * `import()` is ALSO reached by a static `import` somewhere in the graph. The
 * module is in the eager closure regardless, so the `import()` cannot move it
 * into another chunk — the laziness is decoration:
 *
 * ```
 * [INEFFECTIVE_DYNAMIC_IMPORT] packages/fields/src/widgets/GridField.tsx is
 * dynamically imported by packages/fields/src/index.tsx but also statically
 * imported by packages/fields/src/index.tsx, dynamic import will not move
 * module into another chunk.
 * ```
 *
 * Every console `vite build` emits 43 of these, all from `packages/fields`
 * (objectui#5325). They are TRUE, and that is the problem this file solves: 43
 * true warnings that nobody can act on, scrolling past every build, is how a
 * build log stops being read at all — and the next warning, the one that IS
 * new, scrolls past with them.
 *
 * ## Why the graph is not being fixed instead
 *
 * Measured twice, on `77f846a8b` and again while writing this file. Two
 * mechanisms produce the 43, and neither is cheap to remove:
 *
 *  - **27** name `packages/fields/src/FieldEditWidget.tsx` as a second static
 *    importer. That is the grid's inline cell editor, which imports its widgets
 *    synchronously because a cell edits in place. Surgery on the barrel does
 *    not touch these at all.
 *  - **16** are defeated only by `packages/fields/src/index.tsx`'s own
 *    `export * from './widgets/*.js'` lines. Removing those is a BREAKING
 *    change to `@object-ui/fields`: it failed the console build with 16
 *    `MISSING_EXPORT` errors, and 14 widget classes are imported by name from
 *    the package across `plugin-detail`, `plugin-form`, `app-shell` and
 *    `apps/console`, never mind published consumers outside this repo.
 *
 * And removing them would buy nothing, because the laziness is defeated a
 * SECOND time one level up, by chunking. `apps/console/vite.config.ts` declares
 * an `advancedChunks` group `ui-components` whose test matches
 * `packages/(components|fields)`; group assignment overrides a module's
 * async-only reachability, so every `packages/fields` module lands in one chunk
 * — and that chunk is eager, because `packages/components` is reached
 * synchronously from the entry. This is objectui#5266's mechanism, the same one
 * `assertLazyLinterStaysLazy` in the console config exists to catch.
 *
 * The CONTROL that proves the second defeat, re-measured on this branch:
 * `packages/fields/src/widgets/MarkdownContent.tsx` has a working `React.lazy`
 * (from `widgets/richTextDisplay.tsx`), is re-exported by nothing, and has no
 * static importer anywhere in production code — so it emits NO warning and is
 * absent from the ledger below. It still lands in the eager
 * `ui-components-*.js`. Counter-probed so `EAGER` is not a stuck answer: the
 * same walk reports `lazy` for `plugin-map`, `plugin-charts` and
 * `plugin-report`. Barrel surgery therefore moves zero bytes; measured
 * directly on `77f846a8b` it moved the eager closure by **+329** bytes and left
 * the chunk count at 58.
 *
 * Maintainer ruling, 2026-08-22 (recorded on objectui#5325): take option C —
 * leave the lazy/static import structure as it is, no barrel surgery, no
 * public-surface breakage, and stop the warnings from reading as noise. Option
 * A — stop the `ui-components` group from claiming `packages/fields/**` so a
 * lazy widget can get its own chunk, THEN remove the defeating static edges —
 * is retained as an on-hold measurement, because it is the only order in which
 * the barrel work buys bytes and the group exists to prevent chunk explosion.
 *
 * ## Why this is a ledger and not a filter
 *
 * A one-line `if (code === 'INEFFECTIVE_DYNAMIC_IMPORT') return false` would
 * satisfy the letter of "stop the noise" and be strictly worse than the noise.
 * Today those warnings are the ONLY thing in the repo that says the laziness
 * does not work; deleting them keeps the defect and destroys its last witness,
 * and a 44th widget joining the list tomorrow would land in total silence.
 *
 * So the warnings are not suppressed, they are PROMOTED. Each one is matched
 * against {@link DEFEATED_LAZY_FIELD_WIDGETS}, and the build then fails on
 * either direction of drift:
 *
 *  - **unpinned** — an ineffective dynamic import this ledger does not know
 *    about. That is a NEW defect. Its original warning is printed in full,
 *    verbatim from rolldown, and the build stops.
 *  - **missing** — a pinned entry that did not fire. Either someone fixed it
 *    (record the win: delete the line, say so in the PR) or the ledger has gone
 *    blind.
 *
 * The `missing` half is the counter-probe, and it is the reason this check
 * cannot quietly become decorative. The dangerous reading here is ZERO, not
 * many: a console build that dies before chunk assignment emits no warnings at
 * all, and objectui#5325 recorded exactly that trap — a build killed by 16
 * `MISSING_EXPORT` errors reported `0` `INEFFECTIVE_DYNAMIC_IMPORT` warnings,
 * which reads identically to "fixed" if nothing demands a positive sighting.
 * With `missing` checked, a blind build fails with 43 named absences instead.
 *
 * ## Why the counter-probe stands down when the build has already failed
 *
 * `closeBundle` runs even when the build has ALREADY errored, and an error
 * thrown from it REPLACES the build's own error in `vite build`'s output — not
 * appended, not printed above it, gone. So every console build that died before
 * the warnings could be emitted reported 43 named absences instead of its own
 * cause, and the `did NOT fire` wording sends the reader straight at
 * {@link DEFEATED_LAZY_FIELD_WIDGETS}, which is the one edit that would break
 * the ledger for real (objectui#6093).
 *
 * The condition to detect is the one this file's own message already names —
 * "this build never got far enough to emit them". `closeBundle` cannot tell
 * that from "zero because they were all fixed" on its own, so the plugin
 * collects the missing input from the hooks that ARE told, and the probe stands
 * down when any of them fired. Measured on vite 8.2.1 + rolldown 1.2.3, because
 * the hooks do NOT all report a failure and the gaps decide the design:
 *
 * | build dies in    | `buildEnd(error)` | `renderError` | our `writeBundle` |
 * |------------------|-------------------|---------------|-------------------|
 * | `transform`      | ERROR             | not called    | not called        |
 * | `renderChunk`    | no argument       | called        | not called        |
 * | `generateBundle` | no argument       | not called    | not called        |
 * | `writeBundle`    | no argument       | not called    | not called        |
 * | nothing (green)  | no argument       | not called    | CALLED            |
 *
 * `buildEnd`/`renderError` alone therefore cover only the top two rows — and
 * the failure objectui#6093 was measured on is the bottom one, a `writeBundle`
 * error from `emit-eager-closure-report`. The third signal closes it: this
 * plugin's own `writeBundle` runs only when nothing before it threw, so
 * "`closeBundle` reached, `writeBundle` never ran" IS "this build did not
 * finish". It is declared `order: 'post'` so the marker does not depend on
 * where this plugin sits in the array — a plugin ordered AFTER it that throws
 * in `writeBundle` still leaves the marker unset (measured; with default order
 * it does not).
 *
 * Two things this deliberately does NOT do. It does not weaken the check on a
 * build that SUCCEEDS: output written and zero sightings still fails, with the
 * same message, which is the case the probe was written for and the control
 * that proves this change turned nothing off. And it does not swallow the
 * finding silently — a stand-down prints one line saying the ledger was not
 * checked and why, because a gate that produces no output at all on a failed
 * build is indistinguishable from a gate that passed.
 *
 * `build.write === false` is the one build that legitimately reaches
 * `closeBundle` with no `writeBundle` (measured), so the marker is only read as
 * failure evidence when this build was going to write at all. That direction is
 * chosen on purpose: an unwritten build there keeps the probe ARMED rather than
 * standing it down, since a silent probe is the failure mode with no witness.
 *
 * ## What is pinned, and what is deliberately not
 *
 * The ledger holds the DEFEATED MODULES — the `id` of each warning — and
 * nothing else. The static importers (`ids`) are read and summarised on every
 * build, but not pinned: they churn with ordinary refactors inside
 * `packages/fields`, and a gate that fires on an unrelated PR with a message
 * about somebody else's card is how a gate gets switched off. Byte regressions
 * are already covered, one layer up, by `emitEagerClosureReport` and
 * `scripts/check-eager-closure-budget.mjs`.
 */

/** Repo root — this file lives in `scripts/`, one level below it. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/**
 * The field widgets whose `import()` is known to be ineffective in the console
 * bundle, as repo-relative POSIX paths. Measured on the console build; see the
 * header for the two mechanisms behind them and why they stand.
 *
 * Sorted, and kept sorted — `scripts/__tests__/vite-ineffective-dynamic-imports.test.ts`
 * checks that, that there are no duplicates, and that every entry still names a
 * file that exists (an entry pointing at a deleted module would otherwise fail
 * the build as a "missing" sighting, which is a confusing way to learn that a
 * widget was renamed).
 */
export const DEFEATED_LAZY_FIELD_WIDGETS: readonly string[] = Object.freeze([
  'packages/fields/src/widgets/AddressField.tsx',
  'packages/fields/src/widgets/AutoNumberField.tsx',
  'packages/fields/src/widgets/AvatarField.tsx',
  'packages/fields/src/widgets/BooleanField.tsx',
  'packages/fields/src/widgets/CheckboxesField.tsx',
  'packages/fields/src/widgets/CodeField.tsx',
  'packages/fields/src/widgets/ColorField.tsx',
  'packages/fields/src/widgets/CurrencyField.tsx',
  'packages/fields/src/widgets/EmailField.tsx',
  'packages/fields/src/widgets/FileField.tsx',
  'packages/fields/src/widgets/FilterConditionField.tsx',
  'packages/fields/src/widgets/FormulaField.tsx',
  'packages/fields/src/widgets/GeolocationField.tsx',
  'packages/fields/src/widgets/GridField.tsx',
  'packages/fields/src/widgets/ImageCropperDialog.tsx',
  'packages/fields/src/widgets/ImageField.tsx',
  'packages/fields/src/widgets/LocationField.tsx',
  'packages/fields/src/widgets/LookupField.tsx',
  'packages/fields/src/widgets/MultiSelectField.tsx',
  'packages/fields/src/widgets/NumberField.tsx',
  'packages/fields/src/widgets/ObjectField.tsx',
  'packages/fields/src/widgets/ObjectRefField.tsx',
  'packages/fields/src/widgets/PasswordField.tsx',
  'packages/fields/src/widgets/PercentField.tsx',
  'packages/fields/src/widgets/PhoneField.tsx',
  'packages/fields/src/widgets/QRCodeField.tsx',
  'packages/fields/src/widgets/RadioField.tsx',
  'packages/fields/src/widgets/RatingField.tsx',
  'packages/fields/src/widgets/RecipientPickerField.tsx',
  'packages/fields/src/widgets/RichTextField.tsx',
  'packages/fields/src/widgets/SelectField.tsx',
  'packages/fields/src/widgets/SignatureField.tsx',
  'packages/fields/src/widgets/SliderField.tsx',
  'packages/fields/src/widgets/SummaryField.tsx',
  'packages/fields/src/widgets/TagsField.tsx',
  'packages/fields/src/widgets/TextAreaField.tsx',
  'packages/fields/src/widgets/TextField.tsx',
  'packages/fields/src/widgets/TimeField.tsx',
  'packages/fields/src/widgets/UrlField.tsx',
  'packages/fields/src/widgets/UserField.tsx',
  'packages/fields/src/widgets/VectorField.tsx',
]);

/**
 * Normalise a rolldown module id to a repo-relative POSIX path.
 *
 * Ids arrive absolute and may carry Vite's query suffixes (`?used`, `?v=…`) or
 * a virtual-module `\0` prefix; both are stripped so the ledger can be written
 * as ordinary source paths. An id from outside the repo is returned unchanged,
 * so it can never be mistaken for a ledger entry.
 */
export function toRepoRelativeModuleId(id: string, repoRoot: string = REPO_ROOT): string {
  const bare = id.replace(/^\0/, '').split('?')[0] ?? id;
  if (!path.isAbsolute(bare)) return bare.split(path.sep).join('/');
  const rel = path.relative(repoRoot, bare);
  if (rel.startsWith('..')) return bare.split(path.sep).join('/');
  return rel.split(path.sep).join('/');
}

/** The two directions of drift a build can show against the ledger. */
export interface IneffectiveDynamicImportDiff {
  /** Ineffective dynamic imports the ledger does not know about — new defects. */
  readonly unpinned: readonly string[];
  /** Pinned entries that did not fire — fixed, renamed, or a blind build. */
  readonly missing: readonly string[];
}

/**
 * Compare one build's sightings against the ledger. Pure, so the policy is
 * unit-testable away from a five-minute console build.
 */
export function diffIneffectiveDynamicImports(
  seen: Iterable<string>,
  pinned: readonly string[] = DEFEATED_LAZY_FIELD_WIDGETS,
): IneffectiveDynamicImportDiff {
  const pinnedSet = new Set(pinned);
  const seenSet = new Set(seen);
  return {
    unpinned: [...seenSet].filter((id) => !pinnedSet.has(id)).sort(),
    missing: [...pinnedSet].filter((id) => !seenSet.has(id)).sort(),
  };
}

/**
 * Build the failure text for a non-empty diff. Separate from the plugin so the
 * wording — which is the whole user interface of this gate — is asserted by the
 * unit test rather than by whoever next reads a red build.
 */
export function formatIneffectiveDynamicImportFailure(
  diff: IneffectiveDynamicImportDiff,
): string {
  const lines: string[] = [];
  if (diff.unpinned.length > 0) {
    lines.push(
      `${diff.unpinned.length} NEW ineffective dynamic import(s) — an \`import()\` that ` +
        'cannot move its module out of the eager chunk, because something also imports ' +
        'it statically. Rolldown printed the original warning(s) above.',
      ...diff.unpinned.map((id) => `  + ${id}`),
      'Remove the defeating static edge, or add the module to ' +
        '`DEFEATED_LAZY_FIELD_WIDGETS` in `scripts/vite-ineffective-dynamic-imports.ts` ' +
        'and say in the PR why the laziness cannot be honoured.',
    );
  }
  if (diff.missing.length > 0) {
    lines.push(
      `${diff.missing.length} pinned ineffective dynamic import(s) did NOT fire. Either ` +
        'they were fixed — delete them from `DEFEATED_LAZY_FIELD_WIDGETS` in ' +
        '`scripts/vite-ineffective-dynamic-imports.ts` and record the win in the PR — or ' +
        'this build never got far enough to emit them, in which case the number to ' +
        'distrust is the zero, not the list.',
      ...diff.missing.map((id) => `  - ${id}`),
    );
  }
  return lines.join('\n');
}

/**
 * Build the ONE line a stand-down prints. Separate from the plugin for the same
 * reason the failure text is: this sentence is what a developer reads when the
 * gate did not run, and "no output at all" would read as "the gate passed".
 *
 * It is deliberately a single line and deliberately does not repeat the module
 * list — the whole point of objectui#6093 is that 45 lines of field widgets
 * above a real build error are worse than no lines at all.
 */
export function formatIneffectiveDynamicImportStandDown(
  diff: IneffectiveDynamicImportDiff,
): string {
  return (
    'ineffective-dynamic-import ledger NOT checked: this build failed before its output ' +
    `was written, so its sightings are not a measurement (${diff.unpinned.length} unpinned, ` +
    `${diff.missing.length} did not fire). Standing down instead of reporting that drift, ` +
    'because an error thrown from `closeBundle` REPLACES the build\'s own error and would ' +
    'hide the real failure in this log (objectui#6093). Fix that failure and rebuild — the ' +
    'ledger is checked again then, and a genuine drift still fails the build.'
  );
}

/**
 * The Vite plugin. Collects `INEFFECTIVE_DYNAMIC_IMPORT` warnings, keeps the
 * pinned ones off the console, prints one summary line in their place, and
 * fails the build on drift in either direction — unless the build has already
 * failed, in which case it stands down rather than replacing that failure's
 * error with its own (see the header section on the stand-down).
 */
export function viteIneffectiveDynamicImports(
  pinned: readonly string[] = DEFEATED_LAZY_FIELD_WIDGETS,
): Plugin {
  /** module id -> its static importers, both repo-relative. */
  const seen = new Map<string, string[]>();

  // The three inputs `closeBundle` is missing. See the header section on the
  // stand-down for the measured table behind each one.
  /** A hook was handed this build's error, so the build is already failing. */
  let buildFailed = false;
  /** This build writes output at all — `build.write !== false`. */
  let writesOutput = true;
  /** Our own `writeBundle` ran, so output generation got past every plugin. */
  let outputWritten = false;

  /**
   * "Did this build finish?" — the input `closeBundle` cannot derive alone.
   * The `writesOutput` guard keeps a legitimate `write: false` build from
   * reading as a failure and silently disarming the probe.
   */
  const buildDidNotFinish = (): boolean => buildFailed || (writesOutput && !outputWritten);

  return {
    name: 'ineffective-dynamic-import-ledger',
    // Build only. A dev server does no chunk assignment, so it never emits
    // this warning, and `closeBundle` never runs there anyway.
    apply: 'build',

    configResolved(config: ResolvedConfig): void {
      // `write: false` never calls `writeBundle`, so without this the marker
      // below would read a perfectly healthy generate-only build as a failure.
      writesOutput = config.build.write !== false;
    },

    // Only the BUILD phase hands its error to a hook; the render/generate/write
    // phases do not (measured — see the header table), which is why this flag
    // is not the whole answer on its own.
    buildEnd(error?: Error): void {
      if (error) buildFailed = true;
    },

    renderError(): void {
      buildFailed = true;
    },

    // The marker for "output generation completed". `order: 'post'` is
    // load-bearing: with the default order this hook runs before a later
    // plugin's `writeBundle`, so that plugin's failure would leave the marker
    // SET and the probe would mask it exactly as objectui#6093 describes.
    writeBundle: {
      order: 'post' as const,
      handler(): void {
        outputWritten = true;
      },
    },

    onLog(level: Rollup.LogLevel, log: Rollup.RollupLog): false | undefined {
      if (log.code !== 'INEFFECTIVE_DYNAMIC_IMPORT') return undefined;
      const id = toRepoRelativeModuleId(log.id ?? '');
      const importers = [...new Set((log.ids ?? []).map((i) => toRepoRelativeModuleId(i)))]
        .filter((i) => i !== id)
        .sort();
      seen.set(id, importers);
      // An unpinned sighting keeps its original warning: the human debugging a
      // NEW ineffective import needs rolldown's own text, naming the importers,
      // not this plugin's summary of it. `undefined` hands the log on.
      if (!pinned.includes(id)) return undefined;
      return false;
    },

    closeBundle() {
      const diff = diffIneffectiveDynamicImports(seen.keys(), pinned);
      const drifted = diff.unpinned.length > 0 || diff.missing.length > 0;

      // Stand down BEFORE anything is thrown or summarised. `closeBundle` runs
      // on a failed build too, and whatever it throws replaces that build's own
      // error, so on a build that did not finish there is no reading of `seen`
      // worth reporting — including an `unpinned` one, whose original rolldown
      // warning was passed through to this log already and which fires again on
      // the next build anyway.
      if (buildDidNotFinish()) {
        if (drifted) this.info(formatIneffectiveDynamicImportStandDown(diff));
        return;
      }

      if (drifted) {
        this.error(formatIneffectiveDynamicImportFailure(diff));
      }
      // `FieldEditWidget.tsx` is the inline cell editor; its static imports are
      // the mechanism behind the larger half of the ledger, so the split is
      // worth one number. Computed from THIS build's importers, never pinned,
      // so it cannot drift into a comfortable lie.
      const inlineEditor = [...seen.values()].filter((importers) =>
        importers.some((i) => i.endsWith('packages/fields/src/FieldEditWidget.tsx')),
      ).length;
      this.info(
        `${seen.size} ineffective dynamic imports, all pinned (objectui#5325): ` +
          `${inlineEditor} via FieldEditWidget.tsx (the inline cell editor), ` +
          `${seen.size - inlineEditor} via the @object-ui/fields barrel. ` +
          'Ledger + why they stand: scripts/vite-ineffective-dynamic-imports.ts',
      );
    },
  };
}
