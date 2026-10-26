/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Builds a plugin package's `dist/index.css` from its `src/index.css` — the
 * shared half of the step each `packages/plugin-<name>/scripts/build-css.mjs` runs.
 *
 * ## What was wrong (objectui#4929)
 *
 * Only `@object-ui/components` and `@object-ui/fields` ever shipped a
 * stylesheet, and each scans its own `src` only. No `@object-ui/plugin-*`
 * package emitted CSS at all (`build: vite build`, no `.css` under `src`), so a
 * class used exclusively by a plugin could not appear in either published sheet
 * BY CONSTRUCTION. A published-state Vite app that installed
 * `@object-ui/plugin-grid` / `plugin-kanban` and followed the quick-start
 * rendered grid and kanban with 25 themed utilities that had no source anywhere
 * in the world — `bg-muted/10`, `bg-card/60`, `text-muted-foreground/60` and
 * friends, ordinary appearance classes — plus ~103 plain ones.
 *
 * The plain utilities a consumer could in principle regenerate by pointing
 * `@source` at the package's `dist`. The themed ones they cannot: they resolve
 * `@theme` tokens declared in `packages/components/src/index.css`, a file that
 * package does not publish. A build inside this monorepo is their only possible
 * producer. That is why the 2026-08-17 ruling chose a stylesheet per plugin over
 * a documentation note teaching consumers to hand-declare the theme and scan
 * `node_modules` — the advice objectui#4858 had just retired from the guides.
 *
 * ## The "narrow" shape, inherited from `@object-ui/fields` (objectui#4059)
 *
 * A plugin's `src/index.css` `@reference`s components' entry: theme tokens, the
 * class-based `dark` variant and the animate plugin become available for
 * resolution while emitting nothing, and only the utilities layer is imported,
 * so there is no preflight and no `:root` theme block to begin with. This module
 * then subtracts every rule components' BUILT sheet already ships.
 *
 * The subtraction is not optional tidiness. `@reference` pulls in components'
 * own `@source` line, so the raw compilation of a plugin entry carries ~1350
 * utilities the consumer already has: 172 kB for `plugin-grid` before
 * subtraction, ~8 kB after. Without this step each plugin would publish a
 * near-complete copy of the components sheet.
 *
 * ## Why this is shared code
 *
 * `packages/fields/scripts/build-css.mjs` came first and is where all of the
 * reasoning above was worked out (objectui#4059); this module is its logic
 * generalised over `packageRoot`, because the ruling that ordered the plugin
 * sheets says "the build step is the pattern any future plugin inherits" and a
 * pattern that has to be copy-pasted is not inherited. Fields was re-pointed at
 * this module in objectui#6405, against a byte-for-byte check of its published
 * `dist/index.css` — so every package that ships a supplement sheet now runs
 * THIS subtraction, and a fix here reaches all of them.
 *
 * ## Failure modes this module refuses to have
 *
 * A subtraction that drops too much would silently ship an under-styled package
 * — the exact defect being fixed, wearing a green build. Four assertions run
 * BEFORE anything is written, and each throws rather than writing a wrong sheet:
 * every rule must be accounted for, the subtraction must have removed something,
 * the sheet may not grow past a leak ceiling, and the utilities only this build
 * can produce must still be present.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The repository root — this file lives in `<root>/scripts/`. */
export const REPO_ROOT = resolve(here, '..');
export const COMPONENTS_ROOT = resolve(REPO_ROOT, 'packages/components');
/** Components' Tailwind entry. Build-time only; never published. */
export const COMPONENTS_ENTRY = resolve(COMPONENTS_ROOT, 'src/index.css');
/**
 * The stylesheet a consumer already has from `@object-ui/components/style.css`
 * — that package's real build output, not a re-derivation of it.
 */
export const COMPONENTS_SHEET = resolve(COMPONENTS_ROOT, 'dist/index.css');

/**
 * `var(--x, <fallback>)` -> `var(--x)`, at any nesting depth.
 *
 * Tailwind inlines a fallback for every theme variable whose declaration is not
 * emitted in the same sheet. A plugin's never are — that is the entire point of
 * the `@reference` entry — so `.rounded-md` compiles here to
 * `var(--radius-md, calc(var(--radius) - 2px))` and in components' sheet to
 * `var(--radius-md)`. Same rule, same computed value once the components sheet
 * is loaded, different bytes. Comparing raw text therefore finds hundreds of
 * spurious differences and keeps the whole duplicate sheet.
 *
 * Normalisation is applied ONLY to the comparison key; the emitted CSS keeps its
 * fallbacks. Hand-written rather than a regex because the fallbacks nest
 * (`calc(var(…))`, `hsl(var(…))`) and a regex cannot match balanced parentheses.
 */
export function stripVarFallbacks(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (!value.startsWith('var(', i)) {
      out += value[i];
      continue;
    }
    let depth = 0;
    let comma = -1;
    let end = -1;
    for (let j = i + 3; j < value.length; j += 1) {
      const ch = value[j];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      } else if (ch === ',' && depth === 1 && comma === -1) comma = j;
    }
    if (end === -1) {
      out += value.slice(i);
      break;
    }
    const name = value.slice(i + 4, comma === -1 ? end : comma).trim();
    out += `var(${name})`;
    i = end;
  }
  return out;
}

/**
 * The at-rule context a node sits in, as a stable string — `@media (…)`,
 * `@layer utilities` and so on, outermost first.
 *
 * Without it, `.lg\:max-w-5xl` inside `@media (min-width:64rem)` and a
 * hypothetical top-level rule with the same selector would collide, and the
 * subtraction could drop a responsive variant because an unrelated base rule
 * matched. Keys are compared, never parsed, so the exact spelling only has to be
 * consistent between the two compilations.
 */
export function contextOf(node) {
  const parts = [];
  for (let p = node.parent; p && p.type !== 'root'; p = p.parent) {
    parts.unshift(
      p.type === 'atrule' ? `@${p.name} ${(p.params ?? '').trim()}`.trim() : String(p.selector ?? ''),
    );
  }
  return parts.join(' > ');
}

/** A rule's declarations, normalised so formatting differences cannot matter. */
export function bodyOf(rule) {
  return rule.nodes
    .map((n) =>
      n.type === 'decl'
        ? `${n.prop}:${stripVarFallbacks(String(n.value).trim())}${n.important ? '!important' : ''}`
        : stripVarFallbacks(n.toString().replace(/\s+/g, ' ').trim()),
    )
    .join(';');
}

export const ruleKey = (rule) => `${contextOf(rule)}||${rule.selector.trim()}`;
/** Whole-node identity for at-rules that carry no selector (`@property`, `@keyframes`). */
export const atRuleKey = (at) => `${contextOf(at)}||@${at.name} ${(at.params ?? '').trim()}`.trim();
const normalise = (node) => stripVarFallbacks(node.toString().replace(/\s+/g, ' ').trim());

/** Class names a selector targets, with CSS escapes resolved (`.bg-muted\/10` -> `bg-muted/10`). */
export function classesIn(selector) {
  const found = [];
  const re = /\.((?:\\.|[^\s.,>+~()[\]:#*'"\\])+)/g;
  let m;
  while ((m = re.exec(selector))) {
    found.push(
      m[1]
        .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/\\(.)/g, '$1'),
    );
  }
  return found;
}

/** Every class the sheet targets. */
export function classesOf(root) {
  const classes = new Set();
  root.walkRules((rule) => {
    for (const sel of rule.selectors) for (const cls of classesIn(sel)) classes.add(cls);
  });
  return classes;
}

/** Everything the components sheet already provides, indexed for lookup. */
export function indexSheet(rootNode) {
  const rules = new Map();
  const atRules = new Map();
  rootNode.walkRules((rule) => {
    const key = ruleKey(rule);
    if (!rules.has(key)) rules.set(key, new Set());
    rules.get(key).add(bodyOf(rule));
  });
  rootNode.walkAtRules((at) => {
    // Container at-rules are represented by the rules inside them, via contextOf.
    if (at.nodes?.some((n) => n.type === 'rule')) return;
    const key = atRuleKey(at);
    if (!atRules.has(key)) atRules.set(key, new Set());
    atRules.get(key).add(normalise(at));
  });
  return { rules, atRules };
}

/**
 * The banner every generated sheet opens with.
 *
 * A caller may replace it wholesale with `build({ header })` — the documented
 * per-package hook, and the reason one exists at all: `@object-ui/fields` ships
 * its sheet to consumers and carried its own wording before this module did, so
 * those exact bytes are part of a published artifact (objectui#6405). Wording
 * that would be an improvement everywhere else is a diff in a published file
 * there. A package with no such history passes no `header` and inherits this.
 *
 * Exported (objectui#7044) so `scripts/__tests__/plugin-published-stylesheet.test.ts`
 * can pin the emitted banner against the real default instead of a second,
 * hand-spelled copy that would be free to drift from it while staying green.
 */
export function defaultHeader(packageName) {
  return [
    `/*! ${packageName} — utilities this package adds on top of @object-ui/components.`,
    ' *',
    ' * IMPORT AFTER the components sheet; this is a supplement, not a standalone stylesheet:',
    ' *',
    " *   @import '@object-ui/components/style.css';",
    ` *   @import '${packageName}/style.css';`,
    ' *',
    ' * Preflight, the theme tokens and every utility this package shares with',
    ' * @object-ui/components live in that sheet and are deliberately not repeated here.',
    ' * Generated by scripts/build-css.mjs — do not edit.',
    ' */',
  ].join('\n');
}

/**
 * Binds the builder to the caller's `postcss` and `@tailwindcss/postcss`.
 *
 * They are injected rather than imported because this file sits at the
 * repository root, outside every package, and pnpm's isolated `node_modules`
 * resolves a bare specifier against the IMPORTING FILE's location. Each plugin
 * package declares and imports the two itself, which is also the honest
 * declaration: they are that package's build dependencies, not the repo's.
 */
export function createPluginStylesheetBuilder({ postcss, tailwind }) {
  /**
   * Compile a Tailwind entry.
   *
   * `base` pins Tailwind's automatic source detection, which otherwise resolves
   * against the process cwd. A plugin entry also carries `source(none)`, so the
   * two together make the output independent of the working directory — the
   * property `scripts/__tests__/plugin-published-stylesheet.test.ts` asserts.
   */
  async function compile(entryFile, base) {
    const css = await readFile(entryFile, 'utf8');
    const result = await postcss([tailwind({ base })]).process(css, { from: entryFile });
    return postcss.parse(result.css, { from: entryFile });
  }

  /**
   * Components' sheet compiled from ITS OWN SOURCE, pinned to its directory.
   *
   * The build below deliberately reads that package's built artifact instead —
   * it is by definition "what the consumer already has". This entry point exists
   * for the test suite, which runs on an unbuilt worktree in CI and so has no
   * `dist` to read. Byte-identical to compiling from `packages/components` as
   * that package's own build does, because `base` removes the cwd sensitivity.
   */
  const compileComponentsEntry = () => compile(COMPONENTS_ENTRY, COMPONENTS_ROOT);

  async function readComponentsSheet() {
    try {
      return await readFile(COMPONENTS_SHEET, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      throw new Error(
        [
          `@object-ui/components has not been built: ${COMPONENTS_SHEET} does not exist.`,
          '',
          'This build subtracts the utilities that package already ships, so it needs that sheet',
          'to exist before it can decide what is left over. `turbo run build` orders this',
          "correctly via the `build` task's `dependsOn: [\"^build\"]`; a bare single-package",
          'build does not.',
          '',
          '  turbo run build --filter=@object-ui/components',
        ].join('\n'),
      );
    }
  }

  /**
   * Compile `<packageRoot>/src/index.css`, subtract what components' sheet
   * already ships, verify, and (unless `write` is false) write `dist/index.css`.
   */
  async function build({
    packageRoot,
    packageName,
    mustSurvive,
    classCeiling,
    componentsSheetCss,
    // Defaulted here, not at the use site, so the inferred type of this options
    // object keeps `header` OPTIONAL — `pnpm type-check:scripts` reads these
    // types through `scripts/__tests__/plugin-published-stylesheet.test.ts` and
    // reported every existing caller broken when it had no default.
    header = defaultHeader(packageName),
    write = true,
  }) {
    const entry = resolve(packageRoot, 'src/index.css');
    const output = resolve(packageRoot, 'dist/index.css');

    const sheet = await compile(entry, packageRoot);
    const shipped = indexSheet(
      postcss.parse(componentsSheetCss ?? (await readComponentsSheet()), { from: COMPONENTS_SHEET }),
    );

    // Snapshot the full compilation BEFORE mutating it, so the verification
    // below has something independent to check the survivors against.
    const fullRules = [];
    sheet.walkRules((rule) =>
      fullRules.push({ key: ruleKey(rule), body: bodyOf(rule), selector: rule.selector.trim() }),
    );

    let droppedRules = 0;
    let droppedAtRules = 0;

    sheet.walkRules((rule) => {
      if (shipped.rules.get(ruleKey(rule))?.has(bodyOf(rule))) {
        rule.remove();
        droppedRules += 1;
      }
    });

    sheet.walkAtRules((at) => {
      if (at.nodes?.some((n) => n.type === 'rule')) return;
      if (shipped.atRules.get(atRuleKey(at))?.has(normalise(at))) {
        at.remove();
        droppedAtRules += 1;
      }
    });

    // Drop at-rule shells the subtraction emptied out (`@media` wrappers whose
    // every rule was already shipped), innermost first.
    let pruned = true;
    while (pruned) {
      pruned = false;
      sheet.walkAtRules((at) => {
        if (at.nodes && at.nodes.length === 0) {
          at.remove();
          pruned = true;
        }
      });
    }

    // -----------------------------------------------------------------------
    // Verification: nothing may go missing.
    // -----------------------------------------------------------------------
    const survivors = new Set();
    sheet.walkRules((rule) => survivors.add(`${ruleKey(rule)}||${bodyOf(rule)}`));

    const lost = fullRules.filter(
      (r) => !survivors.has(`${r.key}||${r.body}`) && !shipped.rules.get(r.key)?.has(r.body),
    );
    if (lost.length > 0) {
      throw new Error(
        [
          `${lost.length} rule(s) vanished in the components-sheet subtraction and are in neither output.`,
          `Shipping this file would under-style ${packageName} — the exact defect objectui#4059`,
          'and objectui#4929 fixed.',
          '',
          ...lost.slice(0, 20).map((r) => `  ${r.selector}  [${r.key}]`),
        ].join('\n'),
      );
    }

    // A subtraction that removed nothing means the two compilations stopped
    // sharing a key shape (a Tailwind upgrade changing layer names, say). The
    // output would still be CORRECT — merely the ~170 kB duplicate this shape
    // exists to avoid — so this is a loud failure rather than a silent
    // regression to the wide sheet.
    if (droppedRules === 0) {
      throw new Error(
        `The components sheet subtracted nothing at all from ${packageName}. Expected ~1350 shared ` +
          'utilities to be removed; the two sheets are no longer producing comparable keys, so this ' +
          'build would ship a near-complete copy of the components sheet (objectui#4059, objectui#4929).',
      );
    }

    const survivingClasses = classesOf(sheet);

    /**
     * The opposite failure to over-subtraction: a sheet that swallowed
     * utilities belonging to OTHER packages. `src/index.css` pins its inputs
     * with `source(none)` precisely so this cannot happen; the ceiling asserts
     * the pin is still doing its job, because the symptom is otherwise
     * invisible — the build succeeds, every check above passes, and the package
     * quietly publishes a stylesheet an order of magnitude too big.
     *
     * A leak detector, not a budget: it sits far above the measured value on
     * purpose, because a number that needed re-tuning every time a widget
     * gained a class would be edited into uselessness.
     */
    if (survivingClasses.size > classCeiling) {
      throw new Error(
        [
          `${packageName}'s sheet carries ${survivingClasses.size} classes; anything over ${classCeiling} means it is no longer just this package's.`,
          '',
          "Tailwind's automatic source detection resolves against a base directory that defaults to",
          "the process cwd, so a lost `source(none)` in src/index.css lets the candidate set expand",
          "to the whole workspace — which builds a valid, much larger stylesheet full of other",
          'packages\u2019 utilities rather than failing (objectui#4059, objectui#4929).',
        ].join('\n'),
      );
    }

    const vanished = mustSurvive.filter((cls) => !survivingClasses.has(cls));
    if (vanished.length > 0) {
      throw new Error(
        [
          `The subtraction removed ${vanished.length} utility(ies) that only this build can produce:`,
          ...vanished.map((c) => `  .${c}`),
          '',
          'That is over-subtraction, and it ships as an under-styled package with a green build —',
          'the defect restored (objectui#4059, objectui#4929). Check that the components sheet being',
          "subtracted is that package's own build output and has not been widened to include this",
          "package's classes.",
        ].join('\n'),
      );
    }

    const css = `${header}\n${sheet.toString()}\n`;
    if (write) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, css, 'utf8');
    }

    return { css, output, survivors, survivingClasses, droppedRules, droppedAtRules };
  }

  return { compile, compileComponentsEntry, readComponentsSheet, build };
}
