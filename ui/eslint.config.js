/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import objectUi from './eslint-rules/index.js'

export default tseslint.config({
  ignores: [
    '**/dist',
    '**/.next',
    '**/node_modules',
    '**/public',
    // fumadocs-mdx codegen for apps/site (gitignored — see apps/site/.gitignore).
    // Linting generated output only reports on the generator's choices.
    '**/.source',
    // objectui#8592 — the three remaining build artefacts that `eslint .`
    // still walked. Same principle as `**/.source` and `**/dist` directly
    // above: linting generated output only reports on the generator's
    // choices, and the report names a file:line nobody wrote. Measured on
    // 290de3724 after a full `turbo run build`:
    // `apps/console/plugin.d.ts` reported 1 warning
    // (`@typescript-eslint/no-explicit-any` at 41:17) while the other two
    // reported 0 in the same invocation — the two zeros are what make the 1
    // a reading rather than a broken invocation.
    //
    // Why three literal paths and not a `.gitignore` import: the claim this
    // change has to keep true is that ONLY git-ignored build output leaves
    // the linted population and not one source file does. A literal path is
    // auditable one entry at a time against `git check-ignore` /
    // `git ls-files`; a gitignore-derived ignore set is not, because it
    // cannot see tracking — git stops ignoring a path the moment it is
    // tracked, and a pattern-only reader would keep dropping it, silently
    // removing a source file from the gate. Each entry below is a git-ignored,
    // untracked, generated-by-build path, verified that way.
    //
    // These mirror the declarations that already exist:
    //   - `apps/console/plugin.{js,d.ts}` — emitted by
    //     `tsc -p tsconfig.plugin.json` (apps/console `build:plugin`),
    //     git-ignored at `apps/console/.gitignore` under "Compiled plugin
    //     output".
    //   - `apps/site/next-env.d.ts` — minted by Next's build/typegen,
    //     git-ignored at `apps/site/.gitignore`.
    // ⛔ Not a suppression at the report's site: the files are regenerated on
    // every build, so an inline disable would vanish and the finding return.
    'apps/console/plugin.js',
    'apps/console/plugin.d.ts',
    'apps/site/next-env.d.ts',
  ],
}, {
  // objectui#4853 — a stale `eslint-disable` is an ERROR, not a warning.
  //
  // ESLint's own default for this option is already `'warn'`, so every stale
  // directive was reported on every CI run before this block existed; it was
  // inert only because `.github/workflows/lint.yml` deliberately sets no
  // `--max-warnings` (see the note at `lint.yml:20`, which this change does
  // NOT touch — the threshold question is a separate card). So this is a
  // severity change on a check already running, 1 -> 2, not a new check.
  //
  // Why it earns the ratchet: 49 stale directives had accumulated by #4833
  // (PR #4849 cleared them), and 2 more appeared in the 21 days after that
  // (PR #7909 cleared those) with nobody touching those lines. A stale
  // directive is a silent suppression of a rule that no longer fires there,
  // so it hides the next real finding at that site. The red names the exact
  // file:line, which makes the remedy mechanical: delete the directive.
  //
  // This object deliberately carries ONLY `linterOptions` and NO `files` key,
  // which is what makes it apply to every linted path. The rule-bearing
  // objects below are all scoped `**/*.{ts,tsx}` or narrower, so a
  // `linterOptions` placed on any of them would leave the `.js/.mjs/.cjs`
  // family — everything `pnpm lint:root` walks — uncovered.
  linterOptions: {
    reportUnusedDisableDirectives: 'error',
  },
}, {
  extends: [js.configs.recommended, ...tseslint.configs.recommended],
  files: ['**/*.{ts,tsx}'],
  languageOptions: {
    ecmaVersion: 2020,
    globals: globals.browser,
  },
  plugins: {
    'react-hooks': reactHooks,
    'react-refresh': reactRefresh,
    'object-ui': objectUi,
  },
  rules: {
    ...reactHooks.configs.recommended.rules,
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    // objectui#4835 — this repo already writes a leading `_` to mean "declared
    // on purpose, deliberately unused", but only `argsIgnorePattern` was set,
    // so the rule honoured that convention for FUNCTION PARAMETERS and for
    // nothing else. Measured on origin/main @ 378dc920b (#4806, re-measured in
    // this PR): 822 no-unused-vars warnings, 613 of them (74.6%) on names the
    // author had already marked `_`. The two dominant populations are
    // legitimate constructs rather than dead code — 442 type-level assertions
    // in tests (`type _NotAny = Assert< ... >`, erased before anything runs, so
    // "unused" is what a passing pin looks like) and the deliberate-omit
    // destructuring idiom. `caughtErrors` defaults to `'all'` in
    // typescript-eslint v8, so `catch (_e)` was reported too. The two patterns
    // added below close that gap; they do not weaken the rule, and severity
    // stays `warn` — `.github/workflows/lint.yml` sets no `--max-warnings`, so
    // this rule could not fail CI before and cannot now (errors 0 -> 0,
    // no-unused-vars 822 -> 209).
    //
    // `ignoreRestSiblings` is deliberately LEFT at its `false` default, so
    // `const { a, ...rest }` still reports `a`. It is a different mechanism
    // from the `_` convention, not an extension of it: it exempts every
    // rest-sibling by SYNTAX whatever it is named, so a property someone simply
    // forgot to use is silenced with nothing declared at the site. Measured:
    // 194 findings sit next to a rest element and 155 of them (80%) are ALREADY
    // spelled `_` — that idiom is what this codebase actually uses (see
    // packages/plugin-view/src/ObjectView.tsx and
    // packages/components/src/renderers/action/action-bar.tsx), and the
    // patterns below already cover all 155. The 39 left over carry no `_`, and
    // 20 of those are function PARAMETERS — exempting them by syntax would open
    // a second, undeclared path around the `argsIgnorePattern` convention this
    // very config states. Turning it on is a separate decision with its own
    // trade-off; see objectui#4835.
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],
    // objectui#4806 R2 (#6467) ratchet — the IMPORT subclass of the rule
    // directly above, at `error`. The rule above keeps every other subclass at
    // `warn`, unchanged: unused locals, parameters, caught errors and
    // destructured elements are all still warnings at exactly the severity
    // they had, and this line adds no new population to the gate.
    //
    // The split is what the #4806 measurement asks for. Of the 209 findings
    // left after the `_`-convention patterns above closed 613 of 822, the
    // import subclass is the one with no legitimate construct behind it. The
    // other subclasses have several — a type-level assertion in a test
    // (`type _NotAny = Assert< … >`) is "unused" precisely when the pin
    // passes, the deliberate-omit destructuring idiom needs the name it drops,
    // a positional parameter has to exist to reach the one after it — which is
    // why promoting the WHOLE rule would gate constructs the codebase writes
    // on purpose. An unused import is dead weight in the module graph every
    // time. Re-measured for #6467 on origin/main @ dd5b01b59: 108 sites in 82
    // files, all removal-only, all cleared in the same PR, so this lints clean
    // today with no allowlist.
    //
    // Two things worth knowing before editing this pair:
    //
    //   1. THE OPTIONS OBJECT IS DELIBERATELY IDENTICAL to the one above.
    //      `object-ui/no-unused-imports` runs `@typescript-eslint/no-unused-vars`
    //      itself and filters its reports down to import bindings, so the two
    //      lines are one analysis at two severities. Change an ignore pattern
    //      in one and not the other and they become two different opinions of
    //      the word "unused" — the exact drift the delegating implementation
    //      exists to prevent. (`argsIgnorePattern` and
    //      `caughtErrorsIgnorePattern` cannot match an import binding; they are
    //      copied so the two objects can be compared by eye.)
    //
    //   2. AN UNUSED IMPORT IS REPORTED TWICE — once as a warning here, once
    //      as an error below. That is not a bug to fix by deleting one of
    //      them: `no-unused-vars` has no option that skips imports (its
    //      options narrow by NAME and by declaration KIND, never by origin),
    //      so the only way to silence the warning half is to replace the base
    //      rule with a fork of it, which #6467 explicitly does not do.
    //      `.github/workflows/lint.yml` sets no `--max-warnings`, so the
    //      warning half is inert in CI and only this line can fail a build.
    'object-ui/no-unused-imports': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],
    // objectui#4029 — importing a package must not write noise to the
    // consumer's console. House convention (measured, not invented): the
    // one known leak used `console.log`, while every deliberate diagnostic
    // already used `warn`/`error` (packages/plugin-map/src/ObjectMap.tsx,
    // packages/core/src/registry/Registry.ts). Error so a new module/
    // function-scope `console.log`/`info`/`debug` fails CI instead of
    // waiting for a human read; `warn`/`error` stay allowed for intentional
    // diagnostics. See the override block below for the carve-outs a blanket
    // rule needs (CLI stdout, per-package examples, deliberate debug/logger
    // infrastructure) and eslint.config.js's own PR history for the full
    // hit-census accounting behind each one.
    'no-console': ['error', { allow: ['warn', 'error'] }],
    // Downgrade new React Compiler rules to warnings (codebase predates these rules)
    'react-hooks/refs': 'warn',
    'react-hooks/immutability': 'warn',
    'react-hooks/set-state-in-effect': 'warn',
    'react-hooks/preserve-manual-memoization': 'warn',
    'react-hooks/use-memo': 'warn',
    // ADR-0054 Phase 5 ratchet — ban synthetic-event triggers (C1). Error so a
    // new violation fails CI; the existing surfaces were converted to direct
    // idempotent commands first, so this lints clean today.
    'object-ui/no-synthetic-event-trigger': 'error',
    // objectui#2879 ratchet — a hook called inside try/catch desyncs hook order
    // when the catch swallows a throw. #2595/#2596 fixed this in the canonical
    // createSafeTranslation; nine plugin-local copies kept it until #2879.
    // Error so a tenth copy fails CI; all known sites were converted first, so
    // this lints clean today.
    'object-ui/no-try-catch-around-hook': 'error',
    // objectui#4734 ratchet — `find(obj, { options: { $top: 100 } })`. The
    // paging/filter keys are declared at the TOP level of `QueryParams`, no
    // adapter reads `params.options`, and `QueryParams`'s deliberate
    // `[key: string]: any` means the misplaced spelling type-checks exactly as
    // well as the correct one — so nothing rejected it. Two blocks shipped it
    // (object-timeline, objectui#4009/objectstack#7137; object-kanban,
    // objectui#4025) and each fetched every row the server would return, a
    // symptom that reads as a data problem rather than a code problem. Error so
    // the next one fails at write time; the repo is at zero live instances, so
    // this lints clean today with no allowlist. Unscoped on purpose: the
    // signature needs no exemptions — 47 legitimate `options` objects exist
    // repo-wide and not one carries a `$`-prefixed key.
    'object-ui/no-query-params-under-options': 'error',
    // objectui#5458 ratchet — the other half of the same class:
    // `find(obj, { top: 200 })`, the query option spelled without its `$` at
    // the TOP level. `convertQueryParams` copies exactly the `$`-prefixed keys
    // `QueryParams` declares, so the bare spelling is dropped with no throw and
    // no warning, and the same `[key: string]: any` makes it type-check. Three
    // live sites, and the app-shell one INVERTED rather than widened:
    // `find(name, { limit: 0 })` fetched the footer's record count by reading
    // every row in the object, on every mount of every list view, because
    // `$top: 0` is honoured end to end as "no records" and `limit` reached
    // nothing. A sibling rule rather than a second predicate on the one above:
    // that rule's signature (`$`-key under `options`) is unmistakable in any
    // object literal, while every name on this one's list is an ordinary key
    // outside a finder call, so the two need different anchors — and one
    // `eslint-disable` must not silence both halves. Error so the next one
    // fails at write time; all three sites were converted first, so this lints
    // clean today with no allowlist.
    'object-ui/no-unprefixed-query-params': 'error',
    // objectui#3090 tripwire — the spec's FormField/FormFieldSchema are the
    // form-VIEW vocabulary (`field` = object-field reference), a DIFFERENT
    // layer from objectui's runtime form-field contract (`name` = data path);
    // the translation point is `normalizeSectionField` in @object-ui/
    // plugin-form. Worse, the spec's FormField TYPE erases to `any` in its
    // dist (objectstack#4171), so importing it here silently deletes type
    // safety — tsc says nothing. Error so the misimport fails at write time,
    // with this message as the correction.
    'no-restricted-imports': ['error', {
      paths: [{
        name: '@objectstack/spec/ui',
        importNames: ['FormField', 'FormFieldSchema'],
        message:
          'This is the spec form-VIEW vocabulary (field = object-field reference), and its type erases to ' +
          '`any` (objectstack#4171) — importing it silently deletes type safety. The runtime form-field ' +
          'contract is `FormField`/`FormFieldSchema` from @object-ui/types; the two layers meet only in ' +
          '`normalizeSectionField` (@object-ui/plugin-form). See objectui#3090.',
      }],
    }],
  },
}, {
  // objectui#4029 — no-console exemption zones. None of these are "a
  // package's console" from a consumer's perspective:
  //  - root scripts/** is repo tooling that runs standalone, never as part
  //    of a published package's import graph.
  //  - examples/** at ANY depth (root AND per-package, hence **/ prefix —
  //    measured objectui#4029: packages/types/examples/*.ts alone carried 18
  //    hits the root-anchored examples/** glob never reached) is
  //    documentation code, not a runtime import surface.
  //  - test files assert against console output themselves (spying on it)
  //    rather than leaking it to a real consumer.
  //  - packages/cli and packages/create-plugin are CLI tools whose entire
  //    job is terminal stdout/stderr — running a bin is not "importing a
  //    package and getting noise you didn't ask for". @object-ui/cli's
  //    index.ts does re-export a couple of commands for programmatic use,
  //    but their console output is the documented behavior of calling them,
  //    not an accidental module-scope leak — the #7139 bug class this rule
  //    exists to net.
  files: [
    'scripts/**/*.{ts,tsx}',
    '**/examples/**/*.{ts,tsx}',
    '**/*.test.{ts,tsx}',
    '**/__tests__/**/*.{ts,tsx}',
    'packages/cli/src/**/*.{ts,tsx}',
    'packages/create-plugin/src/**/*.{ts,tsx}',
  ],
  rules: {
    'no-console': 'off',
  },
}, {
  // objectui#3010/#3021 ratchet — a module loaded inside beforeAll/beforeEach
  // bills its cold Vite transform to `hookTimeout`, so the test passes or fails
  // on machine load. Raising the timeout is the intuitive fix and it does not
  // work: all 37 files found this way already had a raised timeout, escalating
  // 15s -> 30s -> 60s, and plugin-kanban blew its raised 15s anyway at 15021ms.
  // Scoped to test files — a dynamic import in app code is normal code
  // splitting. Error so a new one fails CI; every existing site was converted
  // first, so this lints clean today.
  files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
  plugins: { 'object-ui': objectUi },
  rules: {
    'object-ui/no-dynamic-import-in-test-hook': 'error',
  },
}, {
  // objectui#8047 ratchet — a `File.tsx:123` line address inside a test NAME is
  // read by nothing: it is not an assertion, no gate parses it, the cited file
  // is never opened. So it cannot fail, and it rots the first time a line is
  // inserted above what it cites. objectui#7853 ruled the class (cite by
  // CONTENT, not by line address) and five per-instance repairs followed it
  // — #6548, #6998, #7289, #7913, #8045 — without closing it. Scoped to test
  // files, because the property is "nothing reads a test name"; a line address
  // in a comment, in an assertion message, or in data a test asserts ON is a
  // human-read citation and is deliberately out of the population (the rule's
  // own header carries the boundary and its measured false-positive cost).
  // Error so a new one fails CI; the whole live population was converted in the
  // same change, so this lints clean today.
  files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
  plugins: { 'object-ui': objectUi },
  rules: {
    'object-ui/no-line-address-in-test-name': 'error',
  },
}, {
  // objectui#4045 ratchet — a `<button>` with no `type` is `type="submit"` per
  // HTML, so it submits any <form> it is composed into instead of running its
  // own handler. In an SDUI renderer that composition is a JSON metadata
  // decision made far from the button's own file, so "not in a form today" is
  // the dormancy, not a defence. Three per-instance rounds (objectui#3344,
  // objectstack#5236, objectstack#6952) each fixed the sites in view and left
  // the rest; nothing rejected the next one at write time, because `type` is
  // optional in React's ButtonHTMLAttributes. Error so the next one fails CI;
  // the whole population was converted first, so this lints clean today.
  //
  // Ignores mirror the population's counting rules exactly (objectui#4045):
  //  - `src/ui/**` is the upstream Shadcn zone, overwritten by the sync script
  //    and never hand-edited (AGENTS.md #7) — enforcing there would demand an
  //    edit the repo forbids.
  //  - test files render buttons into a test DOM, never into a product form,
  //    and their fixtures are deliberately minimal.
  files: ['**/*.tsx'],
  ignores: ['**/src/ui/**', '**/*.test.tsx', '**/__tests__/**'],
  plugins: { 'object-ui': objectUi },
  rules: {
    'object-ui/button-has-type': 'error',
  },
}, {
  // Type-discipline ratchet, scoped to the canonical view-schema file: a
  // spec-backed view-config field must reference its @objectstack/spec type,
  // never redefine it inline (a hand mirror silently drifts from the spec →
  // "shipped-but-inert" metadata). Scoped here to avoid false positives on
  // unrelated `selection`/`pagination`/… fields elsewhere. Error so a new
  // inline mirror fails CI; the covered fields were converted first, so this
  // lints clean today.
  files: ['packages/types/src/objectql.ts'],
  plugins: { 'object-ui': objectUi },
  rules: {
    'object-ui/no-inline-spec-config': 'error',
  },
}, {
  // objectui#8316 ratchet — no type assertion in the registry's meta seam.
  //
  // The objectui#6950 ruling made removing the `as ComponentMeta` cast from
  // `withElementDataSourceInput` a deliverable, on the ground that a cast at
  // the one place `binding` is written is exactly what hides the next drift
  // between `ELEMENT_DATA_SOURCE_INPUT` and its type. PR objectui#8297 removed
  // it. Nothing the compiler runs can hold that removal: an assertion is
  // invisible to `tsc` by construction, and it was measured — re-adding
  // `as ComponentMeta` to the return leaves `packages/core`'s `tsc --noEmit`
  // at exit 0, as does the `<ComponentMeta>{…}` spelling. (Control taken in
  // the same run: a real type error on the line above, `const injected:
  // InjectedComponentInput = 42`, does fail it — TS2322 at Registry.ts.)
  //
  // So the removal was pinned by reading the file's source text, in
  // `packages/types/src/__tests__/injected-component-input-6950.test.ts`. That
  // pin worked for the spelling it was written against and for nothing else:
  // measured on 4dc80d0fc, re-adding `as ComponentMeta` turned it red, and
  // re-adding `<ComponentMeta>{…}` — the same assertion, other spelling — left
  // it green at 9 passed. A regex over source is also moved by a reflow and
  // asserts an ABSENCE, which is what a broken pattern returns too. This rule
  // replaces those two `not.toMatch` lines; the pin's positive half (the local
  // is annotated `InjectedComponentInput`) is a different claim and stays.
  //
  // AST-level, so both spellings are one report and formatting cannot move it,
  // and it fails at `Lint`, a gate the repo already runs over this file.
  //
  // ⛔ Scoped to the ONE file the ruling is about, deliberately. A repo-wide
  // `assertionStyle: 'never'` is a much larger decision with its own decision
  // box and is NOT this ratchet (objectui#8316); so is the pre-existing
  // sibling `as unknown as RegistryConfigLike[]` in
  // `packages/sdui-parser/scripts/gen-manifest.ts`, which this scope does not
  // reach. `Registry.ts` carries zero type assertions today, so this lints
  // clean with no allowlist.
  files: ['packages/core/src/registry/Registry.ts'],
  rules: {
    '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
  },
}, {
  // objectui#5191 ratchet — `getBadgeColorClasses(color, value)` returns a
  // class string and therefore cannot carry an author-declared hex: it
  // quantizes the declared colour onto one of nine palette families. The
  // correct answer is `getBadgeHexAppearance(color)`, whose `className` reads
  // CSS custom properties that only its `style` half supplies. A class-only
  // call compiles, renders, and looks right for family-name declarations (the
  // common case), so it fails only for authors who declared a hex — and it
  // fails by rendering a plausible NEIGHBOURING colour rather than by breaking.
  // objectui#5141 fixed that in the cell renderer and objectui#5183 fixed four
  // more sites; both rounds were per-site, because nothing rejected the
  // class-only call at write time. Error so the fifth badge surface fails CI
  // instead of shipping a quietly wrong colour — `.github/workflows/lint.yml`
  // sets no `--max-warnings`, so a `warn` here could not fail anything. Every
  // live call site pairs the two helpers already (plugin-grid ObjectGrid group
  // header + compact card, plugin-kanban card badges), so this lints clean
  // today with no allowlist.
  //
  // `packages/fields` is ignored because it OWNS both helpers: it defines them,
  // its own badge renderer pairs them anyway, and
  // `src/__tests__/badge-hex-fidelity-5141.test.tsx` deliberately exercises
  // each half in isolation — that is the helper's own coverage, not a badge
  // surface. Everywhere else, including tests, is in scope: outside `fields` a
  // call to this helper IS a badge surface, and the repo is at zero unpaired
  // instances today.
  files: ['**/*.{ts,tsx}'],
  ignores: ['packages/fields/**'],
  plugins: { 'object-ui': objectUi },
  rules: {
    'object-ui/no-unpaired-badge-color-classes': 'error',
  },
}, {
  // objectui#9162 ratchet — a `SchemaNode` slot may never guard itself.
  //
  // `{schema.footer && <CardFooter>…</CardFooter>}` does not evaluate to
  // `false` when the slot is falsy: it evaluates to the SLOT, and React renders
  // numbers. A node slot's published zod face carries a `z.number()` arm
  // (`nodeUnionOptions`, `packages/types/src/zod/base.zod.ts`), so `footer: 0`
  // is legal authored input that paints a stray "0" into the DOM. Worse, `&&`
  // short-circuits, so `renderChildren`'s own `isEmptyNodeSlot` first leg is
  // never reached — the objectui#8908 bridge repair cannot help either.
  //
  // Why it earns the ratchet: the class was patched ONE INSTANCE AT A TIME
  // three times — objectui#8331 (`DataTableSchema.emptyAction`), objectui#9033
  // (`header-bar`'s `rightContent`), and then objectui#9162's census found
  // ELEVEN more, because objectui#9033's grep was keyed on the spelling of the
  // RIGHT operand while the trap depends only on the LEFT one. Eleven ternaries
  // would have left the error-permitting construct in the tree for the twelfth
  // slot. Nothing else rejects it: it type-checks, it renders, and it is
  // correct for every value except a falsy number.
  //
  // The rule derives its slot set PER FILE from the file's own text — an
  // expression is a node slot here if this file hands it to `renderChildren`,
  // `renderNodeSlot`, `toRenderableSchema` or `<SchemaRenderer schema={…}>`.
  // ⛔ Deliberately NOT a list of slot names: a list would answer for today's
  // names and go quiet on the twelfth, which is the objectui#9033 mistake one
  // level up.
  //
  // `**/src/ui/**` is the upstream Shadcn zone, overwritten by the sync script
  // and never hand-edited (AGENTS.md #7) — enforcing there would demand an edit
  // the repo forbids. It reports zero today in any case. Tests are IN scope: a
  // fixture that writes the construct is modelling the defect, and a deliberate
  // reproduction can say so with a disable directive.
  //
  // Measured on 7d6439c4b: 19 reports across 8 files (the eleven sites
  // objectui#9162 probed, plus `page:card`'s `body`/`footer`, `plugin-detail`'s
  // `header`/`footer`, `plugin-report`'s `section.content` and
  // `plugin-timeline`'s two `item.content`). `header-bar.tsx` — objectui#9033's
  // ternary, already fixed — was NOT reported, which is the control that the
  // instrument separates fixed from unfixed. All 19 are repaired in the same
  // change, so this lints clean with no allowlist.
  files: ['**/*.tsx'],
  ignores: ['**/src/ui/**'],
  plugins: { 'object-ui': objectUi },
  rules: {
    'object-ui/no-bare-node-slot-guard': 'error',
  },
});
