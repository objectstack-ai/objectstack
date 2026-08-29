// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cross-package-test-inputs -- the DECLARATION TABLE of which packages' tests
 * read outside their own directory, and the repo-relative globs they read.
 *
 * The table itself is documented on the export below. This header is about
 * where the table LIVES, which is a separate decision and a measured one.
 *
 * ## Why a plain module, and not the gate that acts on it (#11511)
 *
 * Three scripts read this table's consequences and two of them read the table
 * itself:
 *
 *   scripts/check-cross-package-test-inputs.mjs   the gate (Layers A and B)
 *   scripts/check-ci-filter-parity.mjs            Layer C, reads this table
 *
 * It used to live inside the first of those, exported for the second. That is
 * a gate acting as a library, and `scripts/pm/dispatch-gates.mjs` cannot follow
 * it: the derivation follows a gate's first-party imports one level, but
 * deliberately NEVER into a module that is itself a discovered gate file. So
 * the parity gate -- whose population this table literally IS -- derived
 * nothing for a card that edits it. Measured on 589758d22, as the (gate, file)
 * pairs the derivation would have named:
 *
 *   scripts/check-ci-filter-parity.mjs      1 pair  ->  3253  (+3252, honest)
 *
 * Moving the table to a module no workflow invokes makes that lead derivable
 * through the EXISTING follow, with no rule change in the derivation -- the
 * shape `scripts/workspace-enumerator.mjs` and `scripts/i18n-bundle-surface.mjs`
 * already have.
 *
 * ## ⛔ THIS MODULE DECLARES A PATH POPULATION -- KEEP PURE HELPERS OUT OF IT
 *
 * The inverse of `workspace-enumerator.mjs`'s rule, and it is the reason this
 * file and `scripts/glob-match.mjs` are two files rather than one.
 *
 * The follow appends a followed module's watch hints to EVERY importer, whole,
 * regardless of which binding the importer actually named. The globs below are
 * a population: measured on 589758d22 they cover 3253 of the repo's 6603
 * tracked files. `scripts/check-examples-live-imports.mjs` wants one string
 * predicate and nothing else -- its own subject is `examples/` -- so if the
 * predicates lived here it would inherit all 3253:
 *
 *   check:examples-live-imports          241 pairs  ->  3346  (+3105, fabricated)
 *
 * That is the exact trade dispatch-gates already refuses on provenance, rebuilt
 * one file further out by a tidy-up. A fabricated lead is pasted into every
 * dispatch prompt whose surface brushes it and the dev who runs it cannot tell
 * it from a real one, which is why it is refused even though it is cheaper than
 * the pairs this file gladly hands the parity gate. The predicates therefore
 * live in `scripts/glob-match.mjs`, which declares no population at all and
 * pins that property against its own bytes.
 *
 * The rule for the next author, in one line: a binding that is a PREDICATE goes
 * in glob-match.mjs, a binding that is a DECLARATION goes here, and neither
 * file grows the other's kind.
 *
 * ## Inert on import
 *
 * No CLI, no top-level statement that runs anything -- `check:entry-guard`'s
 * second rule, which exists because importing a gate for its exports used to
 * run the gate (#10610, and the hand-copied `globToRegExp` that defect caused).
 * A file of declarations satisfies it by construction; keep it that way.
 */

/**
 * Packages whose test suites read files outside their own directory, with the
 * repo-relative globs they really read. Keep a glob as NARROW as the evidence
 * allows and no narrower: too wide only costs cache invalidation, too narrow
 * silently restores the #7802 blind spot for that package.
 *
 * Every entry names the test that justifies it, so the next person can check
 * the radius against the code rather than trusting the glob.
 *
 * A rationale may cite a sibling path as an EXAMPLE only when that path is
 * structurally unable to change status. The mention-shape entries below all
 * reach for `check-nul-bytes.mjs`, which is load-bearing rather than habit:
 * no test has a reason to READ a gate script, so "named rather than read"
 * stays true of it for as long as the sentence exists. A path under active
 * test does not qualify -- `sync-template-versions.mjs` was cited that way
 * until #9763 taught the collector to see the split-segment read that
 * `template-version-stamps.test.ts` had been making all along, and every
 * sentence naming it went false at once, in copies that had to be retired one
 * at a time. Cite the invariant example, or name no sibling at all.
 *
 * `heldBy` is that sentence made CHECKABLE for the globs the roster cannot see
 * (#10566). Most globs are held mechanically: some path the tests name lands
 * inside them, and `globHolderVerdict()` finds it. A read whose path this
 * detector cannot NAME -- a loop variable, a `git ls-files` result, an argument
 * it cannot fold -- holds a live radius while naming nothing, so those globs
 * name the escaping test that reads them instead. The witness is checked rather
 * than prose: the named test must still be one of this package's escaping
 * tests, so a glob whose only holder stops reading outside the package fails BY
 * NAME instead of sitting declared and unheld.
 *
 * READ BY TWO GATES, never copied into either. `check-cross-package-test-inputs`
 * drives Layers A and B from it; `scripts/check-ci-filter-parity.mjs` asserts
 * for Layer C that every glob declared here is reachable by ci.yml's `filter`
 * job. Both import THIS table rather than hold a copy -- a second copy of the
 * declarations would be the very defect those gates exist to close, one file
 * further out. Importing this module runs nothing; see the header.
 */
export const CROSS_PACKAGE_TEST_INPUTS = {
  '@objectstack/spec': {
    globs: [
      // api-methods-batch-conformance.test.ts + system/constants/platform-object-names.test.ts
      'packages/**/*.object.ts',
      // src/identity/position-delegatable-enforcer.pin.test.ts reads the lint rule sources
      'packages/lint/src/**',
      // scripts/root-index.test.ts reads the index; scripts/category-title.test.ts and
      // scripts/file-description.test.ts walk the whole references tree by category.
      'content/docs/references/**',
      // scripts/dist-freshness.test.ts stages a fixture around the root scripts dir
      'scripts/**',
      // `serve.ts` is named in a comment rather than read, the same shape as
      // `check-nul-bytes.mjs` / the realtime protocol page below, and settled
      // the same way: the literal collector takes quoted paths without parsing,
      // so a mention forces a declaration, and declaring the file is cheaper
      // than rewording prose to dodge the scanner.
      // scripts/publish-smoke-port-collision.test.ts cites it for the
      // measurement that justifies its whole existence — `serve.ts` auto-shifts
      // off a busy port whenever `flags.dev` is set, which is the only reason
      // publish-smoke.sh cannot trust the port it asked for. One file, not the
      // commands tree: the test reads publish-smoke.sh and nothing else.
      'packages/cli/src/commands/serve.ts',
      // scripts/liveness/evidence.test.ts resolves the evidence paths the
      // liveness ledgers cite, so those files' existence is a spec input.
      'packages/runtime/src/**',
      'packages/objectql/src/validation/**',
      'packages/metadata-protocol/src/**',
      'packages/plugins/plugin-audit/src/**',
      // Both of these were read all along and declared by nobody -- they are
      // what #9763's reconstruction found the first time it ran, not radii this
      // package grew. Each is spelled ascent-relative, which is exactly the
      // spelling the flat literal regex below cannot start a match on:
      //   src/api/error-catalog-docs.test.ts reads the error-catalog page as
      //     `resolve(__dirname, '../../../../content/docs/api/error-catalog.mdx')`
      //     and asserts it documents every `StandardErrorCode`. Per-page rather
      //     than `content/docs/**` for the reason the @objectstack/cli entry
      //     gives: docs are edited far more often than any package here.
      //   scripts/strictness-ledger.test.ts reads the audit ledger as
      //     `resolve(SPEC, '../../docs/audits/...')` and ratchets it against the
      //     schema files it inventories, so the ledger IS an input to the ratchet.
      'content/docs/api/error-catalog.mdx',
      'docs/audits/2026-07-unknown-key-strictness-ledger.md',
      // src/shared/retired-key-migrate-sentence.test.ts judges the ONE
      // governed markdown file its population was widened by (#10848,
      // maintainer-ruled): the retirement playbook that teaches authors the
      // prescription sentence the pin holds. One file, not `.claude/**`.
      '.claude/skills/spec-property-retirement/SKILL.md',
      // scripts/export-list.test.ts ends in a corpus gate over the PUBLISHED
      // skill references — it enumerates `skills/` and reads every
      // `<skill>/references/_index.md`, asserting none of their `Exports:` rows
      // names a machine constant (#12201). The artifacts are what a customer
      // agent actually loads, so they are the population that gate must judge;
      // checking the generator's output in memory instead would re-assert the
      // rule and see nothing about what is checked in.
      //
      // The whole subtree rather than `skills/*/references/_index.md`: the test
      // reads the DIRECTORY too (a new skill dir changes its verdict), and a
      // glob that names only files does not cover a directory listing —
      // `coversDirectory` is the check, and it is why the narrower spelling was
      // tried first and rejected by this gate.
      'skills/**',
    ],
    heldBy: {
      // The two repo-wide `*.object.ts` walkers. Each seeds a recognised
      // expression and then descends with `readdirSync(dir)` on a LOOP
      // VARIABLE, so the escape verdict resolves and the NAME does not -- the
      // trade `pathExpression` documents. Measured: no path on this package's
      // roster matches this glob, so these two tests are all that hold it.
      'packages/**/*.object.ts': [
        'packages/spec/src/data/api-methods-batch-conformance.test.ts',
        'packages/spec/src/system/constants/platform-object-names.test.ts',
      ],
    },
  },
  '@objectstack/core': {
    // src/security/operation-private-keys.pin.test.ts walks `git ls-files` over
    // the whole repo and reads every matching source file.
    globs: ['packages/**/*.ts'],
  },
  '@objectstack/cli': {
    // src/commands/serve-verify-security-parity.contract.test.ts diffs
    // cli's serve.ts against verify's harness.ts.
    // It also pins plugin-security's permission-set test as a third witness.
    //
    // src/commands/serve-multi-node-cap-advisory.pin.test.ts reads the
    // multi-node gate's own `ResolvedMultiNodeVerdict` declaration: serve.ts
    // mirrors that shape by hand (the CLI has no static dependency on the
    // cluster package), and the pin exists to fail when the two drift. It only
    // does that if a producer-only change re-runs cli's tests, which is exactly
    // what this declaration buys.
    //
    // The `examples/` globs are the showcase modules two i18n tests import LIVE
    // across the workspace boundary, each named per file because the two read
    // DIFFERENT namespaces and are not interchangeable:
    //   test/i18n-section-coverage.test.ts dynamically imports `contact.view`
    //     and `semantic-zoo.object` and asserts `toEqual` over an exhaustive
    //     hardcoded `_sections` key list, so any newly NAMED section in either
    //     module goes red -- this is what PR #8742 broke in queue build
    //     31825946401, where the merge queue was the first signal.
    //   test/i18n-tab-coverage.test.ts dynamically imports `task-triage.page`
    //     and asserts the same way over `_tabs`, so it moves with that page's
    //     filter-only presets and is untouched by `_sections` edits.
    // Per-file rather than `examples/app-showcase/**`: the modules above have no
    // relative imports of their own, so the read set IS the file set, and the
    // wider glob would put cli's suite on every showcase edit. Adding a live
    // import outside these paths fails `check:examples-live-imports`, which
    // matches each coupling target against these globs -- so narrowing here
    // cannot quietly reopen the blind spot.
    //
    // The `content/docs` globs are hand-written prose three e2e tests pin, to
    // enforce the #6730 ruling that the NDJSON exception "stays declared, not just
    // implemented" -- the declaration has to be findable in the page a script
    // author actually meets, so the page IS an input. All three were invisible to
    // this gate until #8995 taught the detector their seed spelling, and the miss
    // is not theoretical: PR #8983 reworded `deployment/index.mdx` to "one compact
    // JSON document per line", which every fact survived but the literal
    // `/one\s+per\s+line/i` pin did not. Undeclared, cli was outside the affected
    // set, so PR CI was green and the merge queue was the first signal -- it
    // dequeued the PR and took two unrelated PRs down as batch collateral.
    //   test/cloud-login-json-ndjson.e2e.test.ts reads deployment/cli.mdx and
    //     deployment/index.mdx.
    //   test/login-json-ndjson.e2e.test.ts reads deployment/cli.mdx and
    //     permissions/authentication.mdx (the page describing the device flow).
    //   test/login-json-noninteractive.e2e.test.ts reads deployment/cli.mdx.
    // Per-page rather than `content/docs/**`: docs are edited far more often than
    // any package here, and a subtree glob would put cli's e2e suite on every
    // documentation PR.
    //
    // `connector-mcp-plugin.ts` is read by test/serve-capability-identity.test.ts,
    // which pins that the connector still registers the name the #7652 repro uses
    // rather than importing the class. It surfaced with the three above and has the
    // same shape of blind spot. The gate could not name it until #9763: the test
    // spells the path ASCENT-RELATIVE (`resolve(HERE, '../../connectors/...')`),
    // which the flat literal regex cannot start a match on. The collector now
    // reconstructs it, so this glob is held by the read rather than by this
    // comment — it was the one entry that already documented the hole, as a fact
    // about itself rather than as the general gap it turned out to be.
    //
    // `check-nul-bytes.mjs` is the one entry no test READS -- it is named in a
    // comment in login-json-noninteractive.e2e.test.ts. The literal collector takes
    // quoted paths without parsing, so a mention forces a declaration; that is the
    // designed trade (over-collection can only widen a radius, never narrow one),
    // and declaring one rarely-touched file is cheaper than teaching the scanner to
    // tell prose from code, or than rewording a comment to dodge a scanner.
    //
    // `js-comment-mask.mjs` is the first entry declared for an IMPORT rather than
    // a file read, and it now has TWO importers:
    // src/commands/serve-verify-security-parity.contract.test.ts (#10453,
    // adopting #9367's conversion) and
    // src/commands/serve-audit-registration.contract.test.ts (#9863) both import
    // `maskComments` from it to separate code from prose in the boot paths they
    // scan. This gate did NOT demand the declaration WHEN THIS ENTRY WAS
    // WRITTEN -- its literal collector recognised path-shaped reads, and a
    // relative import specifier that escapes the package was not one of the
    // spellings it knew. It IS one now: #10452 taught the collector to read
    // escaping relative specifiers and to RESOLVE them, so this pair is a
    // declaration the gate DEMANDS, not a hand-maintained courtesy. Measured on
    // the four entries #12932 added below -- one escaping import each and
    // nothing else that escapes -- this gate went red on every one of them
    // until the pair was declared, naming the repo-relative path the specifier
    // resolves to and the test that imports it. Declared by hand FIRST because
    // the coupling is real whatever the collector saw: those scans' verdicts are
    // a function of this module's masking behaviour, so a change to it has to
    // re-run cli's suite. The undetected-import spelling is filed separately as
    // #10452; widening a radius by hand is never the reason not to file it.
    //
    // Its `.d.mts` sibling is declared for BOTH reasons this roster records. It
    // is named in that test's prose, and the literal collector takes quoted
    // paths without parsing, so a mention forces a declaration (the
    // `check-nul-bytes.mjs` entry above settles that trade the same way:
    // declaring the file beats rewording a comment to dodge a scanner). It is
    // also a real input rather than only a mention -- it is what gives
    // `maskComments` its type, so cli's `tsc --noEmit` verdict is a function of
    // it. Measured, not assumed: this file arriving on main is exactly what
    // turned that test's `@ts-expect-error` into a TS2578 and took the
    // typecheck lanes red on a branch that never touched it.
    globs: [
      'packages/verify/src/**',
      'packages/plugins/plugin-security/src/**',
      'packages/services/service-cluster/src/**',
      'packages/connectors/connector-mcp/src/connector-mcp-plugin.ts',
      'examples/app-showcase/src/ui/views/contact.view.ts',
      'examples/app-showcase/src/data/objects/semantic-zoo.object.ts',
      'examples/app-showcase/src/ui/pages/task-triage.page.ts',
      'content/docs/deployment/cli.mdx',
      'content/docs/deployment/index.mdx',
      'content/docs/permissions/authentication.mdx',
      'scripts/check-nul-bytes.mjs',
      // This gate's OWN script, the third entry of the mention shape on this
      // package: test/scaffold-workspace-consistency.test.ts quotes it while
      // explaining where its cross-package read is declared. Settled the way
      // check-nul-bytes.mjs above is — the literal collector takes quoted paths
      // without parsing, so a mention forces a declaration, and declaring one
      // rarely-touched file is cheaper than rewording prose to dodge a scanner.
      'scripts/check-cross-package-test-inputs.mjs',
      'scripts/js-comment-mask.mjs',
      'scripts/js-comment-mask.d.mts',
      // The #12964 trio, the second import-shaped coupling on this package.
      // test/unbuilt-workspace-lead.test.ts imports `unbuiltWorkspaceLines`
      // from `cli-unbuilt-workspace-lead.mjs` -- the decision `bin/run-dev.js`
      // makes when oclif's "command not found" is really a workspace package
      // with no build output -- and asserts the exact two lines it renders, so
      // that module's behaviour IS this suite's verdict.
      //
      // All three entries, for three distinct reasons this roster records:
      //   - the `.mjs` is the import, and the only one this gate demanded;
      //   - the `.d.mts` is a real input to the typecheck verdict, exactly as
      //     the js-comment-mask sibling above is. Measured on this card rather
      //     than assumed: without it that test is TS7016 ("Could not find a
      //     declaration file"), which lands in @objectstack/cli's ledgered
      //     hidden test layer, whose note says the first new error in it must
      //     go red rather than be absorbed;
      //   - `cli-build-prerequisite.mjs` is what the `.mjs` delegates BOTH
      //     halves of its answer to -- `looksLikeStaleWorkspaceDist` decides
      //     whether to speak at all, and `workspaceBuildFix` renders the remedy
      //     that test pins CHARACTER FOR CHARACTER. A change there moves this
      //     suite's verdict without touching either file above it.
      'scripts/cli-unbuilt-workspace-lead.mjs',
      'scripts/cli-unbuilt-workspace-lead.d.mts',
      'scripts/cli-build-prerequisite.mjs',
      // And THIS file, for the mention shape a fourth time on this package: the
      // test above names it while saying where its three cross-package inputs
      // are declared. Settled the way `check-nul-bytes.mjs` is — the literal
      // collector takes quoted paths without parsing, so a mention forces a
      // declaration, and declaring one rarely-touched file is cheaper than
      // rewording prose to dodge a scanner.
      'scripts/cross-package-test-inputs.mjs',
      // `translation.zod.ts` is the second entry no test READS -- named in a
      // comment in test/i18n-section-coverage.test.ts, which describes it as the
      // DECLARATION face of the schema that test asserts against. It appears
      // here only now because that file had no `fs` read at all, so it never
      // reached the scan before #10452 relaxed the pre-filter to admit
      // import-only escapes; the flat literal collector then took the quoted
      // path exactly as it always has. Settled the same way as
      // `check-nul-bytes.mjs` above -- declaring one file beats teaching the
      // scanner to tell prose from code, and this one costs nothing in practice:
      // `@objectstack/spec` is a real dependency of this package, so the graph
      // already re-runs these tests on any spec change.
      'packages/spec/src/system/translation.zod.ts',
      // The blank template's rendered `pnpm-workspace.yaml`, READ by
      // test/scaffold-workspace-consistency.test.ts (#10499). Two scaffold
      // paths write that file into a new user's project — this package's
      // `renderPnpmWorkspaceYaml()` and create-objectstack's literal
      // template — and each package's own ratchets are package-local, so
      // neither could ever fail for the other's regression. The consistency
      // test compares the two RENDERED outputs, which makes the template file
      // a real input to this package's verdict: a template-only diff changes
      // what that test measures. Without this declaration such a diff reaches
      // neither layer — `turbo ls --affected` would still pick cli up (it
      // depends on create-objectstack for the shared `created-summary`
      // renderer), but `@objectstack/cli#test` would hash the same and replay
      // a cached green over the divergence, which is #7802's Layer B exactly.
      // One file, not `packages/create-objectstack/**`: the test reads that
      // template and nothing else across the boundary.
      'packages/create-objectstack/src/templates/blank/pnpm-workspace.yaml',
    ],
  },
  '@objectstack/client': {
    // The first entry this gate DERIVED from import specifiers rather than from
    // a path-shaped read (#10452), and the reason that half was worth building:
    // six tests here import six sibling packages' route ledgers directly by
    // relative specifier, and nothing had ever declared any of them.
    //   src/client-url-conformance.test.ts and src/route-ledger-response-schema.test.ts
    //     import runtime, rest, service-storage, service-i18n and plugin-auth;
    //   src/route-ledger-coverage.test.ts imports runtime;
    //   src/rest-route-ledger-coverage.test.ts imports rest;
    //   src/service-route-ledger-coverage.test.ts imports the three services,
    //     service-datasource among them;
    //   src/auth-route-ledger-coverage.test.ts imports plugin-auth (#11359) —
    //     the sixth ledger's client half, added last and reading a file the
    //     five globs below already carried, so it widened no radius.
    // Each asserts this client's URL builders still agree with the ledger the
    // server side publishes, so a ledger edit changes the verdict by design.
    //
    // The graph does not carry it and cannot be made to: of the six, only
    // `@objectstack/runtime` appears in this package's manifest at all (a
    // devDependency) -- `@objectstack/rest`, the three services and
    // `plugin-auth` are not dependencies in any form, which is why
    // `turbo ls --affected` could not reach client from a ledger-only diff and
    // `client#test` hashed the same before and after one. #7802's shape exactly,
    // reached by the other spelling.
    //
    // Per-file rather than `packages/**/src/**`: a ledger is one file per
    // package and these tests read nothing else across the boundary, so the
    // radius stays the six files the imports name. The roster holds it -- an
    // import added outside them fails this gate by name.
    globs: [
      'packages/runtime/src/route-ledger.ts',
      'packages/rest/src/rest-route-ledger.ts',
      'packages/services/service-storage/src/storage-route-ledger.ts',
      'packages/services/service-i18n/src/i18n-route-ledger.ts',
      'packages/services/service-datasource/src/datasource-route-ledger.ts',
      'packages/plugins/plugin-auth/src/auth-route-ledger.ts',
      // Below this line: paths these tests NAME in prose rather than read. Each
      // docblock cross-references the sibling conformance test it mirrors, or
      // the script that records the envelope shape, and the flat literal
      // collector takes quoted paths without parsing. Same designed trade as the
      // `check-nul-bytes.mjs` entry on `@objectstack/cli` -- over-collection can
      // only widen a radius, never narrow one, and declaring the file beats
      // rewording a comment to dodge a scanner. Not claimed as real inputs: a
      // sibling package's TEST file cannot change this package's verdict. The
      // six globs above are the ones the imports hold.
      'packages/runtime/src/route-ledger.conformance.test.ts',
      'packages/rest/src/rest-route-ledger.conformance.test.ts',
      'packages/services/service-storage/src/storage-route-ledger.conformance.test.ts',
      'packages/services/service-i18n/src/i18n-route-ledger.conformance.test.ts',
      'packages/services/service-datasource/src/datasource-route-ledger.conformance.test.ts',
      'packages/plugins/plugin-auth/src/auth-route-ledger.conformance.test.ts',
      'scripts/check-route-envelope.mjs',
    ],
  },
  '@objectstack/lint': {
    // authoring-rule-wiring / validate-rule-compilability /
    // lint-startup-registry-verdict.corpus read each authoring rule's source
    // by repo-relative path, plus the CLI commands dir and the runtime gate.
    //
    // The `examples/` globs are the showcase modules two validator tests import
    // LIVE across the workspace boundary. Both assert the SHIPPED app is clean
    // rather than pinning a fixed shape -- #8515 lifted the pinned-shape cases
    // onto the frozen `showcase-shape.fixtures.ts` snapshot, so what survives
    // live are the cases that must keep resolving against the real app:
    //   src/validate-translatable-sections.test.ts imports `Contact`,
    //     `ContactViews` and `ShowcaseTranslationBundle`; a section introduced
    //     WITHOUT a name moves it, a correctly named one does not.
    //   src/validate-translation-references.test.ts imports `Contact` and
    //     `ContactViews` and asserts every translation key still resolves, so
    //     renaming or removing a Contact field, view, section or action moves
    //     it while adding one generally does not.
    // Per-file for the same reason as `@objectstack/cli` above: these modules
    // have no relative imports of their own, and a live import added outside
    // them fails `check:examples-live-imports` by name.
    globs: [
      'packages/cli/src/commands/**',
      'packages/metadata-protocol/src/**',
      'packages/objectql/src/validation/**',
      'packages/services/service-automation/src/**',
      'examples/app-showcase/src/data/objects/contact.object.ts',
      'examples/app-showcase/src/system/translations/index.ts',
      'examples/app-showcase/src/ui/views/contact.view.ts',
    ],
    heldBy: {
      // `const commandsDir = join(repoRoot, 'packages/cli/src/commands')`
      // resolves, but every read off it is `readFileSync(join(commandsDir,
      // file))` with `file` a variable: the roster gets the DIRECTORY, which a
      // file-position read cannot put on it, and never one of the files.
      'packages/cli/src/commands/**': ['packages/lint/src/authoring-rule-wiring.test.ts'],
    },
  },
  '@objectstack/cloud-connection': {
    // src/canonical-expression-envelopes.test.ts (#12267) imports `maskComments`
    // from `js-comment-mask.mjs` to decide which text in this package's `src/` is
    // a comment and which is a `Page` declaration — the same conversion #9367
    // made for six gates. The coupling is real: that gate's POPULATION is a
    // function of the module's masking behaviour, so a change to it has to re-run
    // this package's suite. The `.d.mts` sibling is declared alongside it because
    // it is what gives `maskComments` its type, so this package's typecheck
    // verdict is a function of it too — the reason the `@objectstack/cli` entry
    // above declares the pair rather than the module alone.
    globs: [
      'scripts/js-comment-mask.mjs',
      'scripts/js-comment-mask.d.mts',
    ],
  },
  '@objectstack/plugin-email': {
    // src/transports/smtp-port-contract.test.ts (#12993) imports `maskComments`
    // from `js-comment-mask.mjs` to decide which text in this package's `src/` is
    // a comment and which is a DECLARATION of the SMTP port bound — the single
    // question that gate exists to answer, since the whole point of the card is
    // that `smtp.ts` still explains the range in prose while declaring it
    // nowhere. The coupling is real: that guard's zero, and the masking control
    // that makes the zero a measurement rather than a grep that ran, are both a
    // function of the module's masking behaviour, so a change to it has to
    // re-run this package's suite. The `.d.mts` sibling is declared alongside it
    // because it is what gives `maskComments` its type, so this package's
    // typecheck verdict is a function of it too — the reason the
    // `@objectstack/cli` entry above declares the pair rather than the module
    // alone.
    globs: [
      'scripts/js-comment-mask.mjs',
      'scripts/js-comment-mask.d.mts',
    ],
  },
  '@objectstack/platform-objects': {
    // src/managed-api-method-affordance-sweep.test.ts (#7934) imports every
    // `*.object.ts` in the monorepo and runs `validateManagedApiMethods` over
    // it — the population `os lint` never walks, because these objects ship as
    // code rather than in an authored stack.
    //
    // `js-comment-mask.mjs` and its `.d.mts` sibling are read by
    // src/pages/canonical-expression-envelopes.test.ts (#12267), which imports
    // `maskComments` to decide which text in this package's `src/` is a comment
    // and which is a `Page` declaration. Declared for both reasons the
    // `@objectstack/cli` entry above records: the import is a real coupling —
    // that gate's POPULATION is a function of the module's masking behaviour, so
    // a change to it has to re-run this package's suite — and the `.d.mts` is
    // what gives `maskComments` its type, so this package's `tsc --noEmit`
    // verdict is a function of it too.
    //
    // `page-envelope-audit.test.ts` and `cloud-connection-ui.ts` are named in
    // that same file's prose and read by nothing. The literal collector takes
    // quoted paths without parsing, so a mention forces a declaration; the
    // `check-nul-bytes.mjs` entry above settles that trade — declaring the file
    // beats rewording a comment to dodge a scanner, and over-collection can only
    // widen a radius, never narrow one.
    globs: [
      'packages/**/*.object.ts',
      'scripts/js-comment-mask.mjs',
      'scripts/js-comment-mask.d.mts',
      'packages/lint/src/page-envelope-audit.test.ts',
      'packages/cloud-connection/src/cloud-connection-ui.ts',
    ],
  },
  '@objectstack/mcp': {
    // src/canonical-expression-envelopes.test.ts (#12269) imports `maskComments`
    // from `js-comment-mask.mjs` to decide which text in this package's `src/` is
    // a comment and which is a `Page` declaration — the third package to carry
    // this gate, and declared for the same two reasons the two entries above
    // record. The import is a real coupling: that gate's POPULATION is a
    // function of the module's masking behaviour, so a change to it has to
    // re-run this package's suite. The `.d.mts` sibling is what gives
    // `maskComments` its type, so this package's typecheck verdict is a
    // function of it too.
    globs: [
      'scripts/js-comment-mask.mjs',
      'scripts/js-comment-mask.d.mts',
    ],
  },
  '@objectstack/metadata': {
    // src/metadata-route-ledger.conformance.test.ts (#12398) imports
    // `stripComments` from `js-comment-mask.mjs` to decide which text in this
    // package's `src/` is prose and which is a mount or a host-app reach — the
    // conversion off its own private scanner, whose row in
    // `check-comment-mask-adoption.mjs` was deleted in the same PR. The
    // coupling is real: every one of that guard's verdicts, including an
    // IDENTITY over the package's whole source population, is a function of the
    // module's stripping behaviour, so a change to it has to re-run this
    // package's suite. The `.d.mts` sibling is declared alongside it because it
    // is what gives `stripComments` its type, so this package's `tsc --noEmit`
    // verdict is a function of it too — the reason the `@objectstack/cli` entry
    // above declares the pair rather than the module alone.
    globs: [
      'scripts/js-comment-mask.mjs',
      'scripts/js-comment-mask.d.mts',
    ],
  },
  '@objectstack/trigger-api': {
    // src/trigger-api-route-ledger.conformance.test.ts (#12398) imports
    // `stripComments` from `js-comment-mask.mjs` for the same reason and in the
    // same conversion as the `@objectstack/metadata` entry above: the guard's
    // path-literal census and its host-app-reach IDENTITY are both functions of
    // the module's stripping behaviour, and the `.d.mts` is what types the
    // import for this package's typecheck.
    globs: [
      'scripts/js-comment-mask.mjs',
      'scripts/js-comment-mask.d.mts',
    ],
  },
  '@objectstack/plugin-auth': {
    // src/managed-extension-fields.test.ts walks every `*.object.ts`, and pins
    // core's api-key source alongside it.
    globs: [
      'packages/**/*.object.ts',
      'packages/core/src/security/**',
      // src/rate-limit-storage-isolation.test.ts (#6040) walks BOTH consumer
      // packages of the `./rate-limit-storage` subpath by directory, checking
      // that neither reaches the counter through the package ROOT — which would
      // silently reinstate the whole better-auth load for them. The diff that
      // breaks that invariant is a diff in one of these two directories, so
      // without them declared the affected-subset filter never adds plugin-auth
      // and turbo replays a cached green over the scan (#10029, the #7802
      // shape). Measured: before this entry, `@objectstack/plugin-auth#test`
      // hashed to `1bf3935543ab055b` both before and after a change under
      // `packages/runtime/src`, and the re-run was `>>> FULL TURBO` in 135ms
      // while the invariant was live-broken in the tree.
      'packages/runtime/src/**',
      'packages/services/service-sms/src/**',
      // The three below are NAMED in that test's prose rather than read by it —
      // the same shape as `check-nul-bytes.mjs` on the @objectstack/cli entry
      // above, and settled the same way: the literal collector takes quoted
      // paths without parsing, so a mention forces a declaration, and declaring
      // the file is cheaper than rewording prose to dodge the scanner. All
      // three are low-churn, so the added cache invalidation is nominal next to
      // the two directories above.
      'scripts/check-published-files.mjs',
      'scripts/check-cross-package-test-inputs.mjs',
      'packages/types/src/node-isolation.test.ts',
      // That same test imports `stripComments` from `js-comment-mask.mjs` to
      // separate code from prose in the 423 sources it walks -- the conversion
      // #12398 began. Unlike the three mentions above this is a real coupling
      // rather than a scanner artefact: the import refs the scan extracts, and
      // therefore its reachability verdict, are a function of the module's
      // scanning behaviour. The `.d.mts` sibling is declared alongside it
      // because it is what gives `stripComments` its type, so this package's
      // typecheck verdict is a function of it too.
      'scripts/js-comment-mask.mjs',
      'scripts/js-comment-mask.d.mts',
    ],
    heldBy: {
      // The pair #10566 was measured on. That test's walk of `PACKAGES_DIR`
      // descends on a loop variable, so no `*.object.ts` path reaches this
      // package's roster and this glob has no mechanical holder. Since #10161
      // gave plugin-auth a SECOND escaping test, losing the walk no longer
      // empties the package either -- the entry stays, the glob goes unheld,
      // and before this witness existed nothing reported it.
      'packages/**/*.object.ts': ['packages/plugins/plugin-auth/src/managed-extension-fields.test.ts'],
    },
  },
  '@objectstack/plugin-security': {
    // src/audience-anchor-set-claims.pin.test.ts pins against spec's
    // high-privilege table, and cross-checks spec's own delegatable pin.
    globs: ['packages/spec/src/security/**', 'packages/spec/src/identity/**'],
  },
  '@objectstack/trigger-record-change': {
    // [#11081] src/record-change-integration.test.ts imports
    // `@objectstack/runtime`'s shared expected-noise capture so its 84 expected
    // authz/organization read refusals are WITHHELD-AND-ASSERTED rather than
    // blanket-muted by `logger: { level: 'silent' }`.
    //
    // ONE file, not `packages/runtime/src/**` (which is the radius
    // `plugin-auth` and `dogfood` carry): the helper has no imports of its own,
    // so that single path IS the whole escaping read. The narrow radius keeps
    // this package's suite off every runtime diff while still moving the
    // `#test` hash when the predicate it depends on changes.
    //
    // The three below are NAMED in this package's prose rather than read by it
    // — `slot-lookup-baseline.json` and `kernel.ts` by comments that predate
    // this entry, `check-cross-package-test-inputs.mjs` by the import comment
    // added with it. Same shape as `check-nul-bytes.mjs` on the
    // `@objectstack/cli` entry above, and settled the same way: the literal
    // collector takes quoted paths without parsing, so a mention forces a
    // declaration, and declaring the file is cheaper than rewording prose to
    // dodge the scanner. (They were invisible until now only because a package
    // with NO escaping test is never rostered at all.)
    globs: [
      'packages/runtime/src/expected-read-refusal-noise.ts',
      'scripts/check-cross-package-test-inputs.mjs',
      'scripts/slot-lookup-baseline.json',
      'packages/core/src/kernel.ts',
    ],
  },
  '@objectstack/plugin-approvals': {
    // [#11081] src/status-mirror-cascade.integration.test.ts imports the same
    // capture for its 25 expected refusals (the six authz tables plus
    // `sys_approval_delegation`). Same one-file radius, same reason — plus this
    // gate's own path, named in that file's import comment (see the note on the
    // sibling entry above for why a mention is declared rather than reworded).
    //
    // [#11286] src/manager-org-screen-parity.contract.test.ts imports
    // `managerIsProvablyOutsideOrg` from plugin-sharing's `team-graph.ts` BY
    // RELATIVE SOURCE PATH — the only way in, since that screen is deliberately
    // not exported from plugin-sharing's index and the package publishes no
    // subpath. The test pins the two independent screens over
    // `sys_user.manager_id` to the same verdicts, so the sharing screen is a
    // real input to it: without this glob a change THERE would never re-run the
    // pin HERE, which is the exact blind spot this gate exists for. One file,
    // not `plugin-sharing/src/**` — nothing else in that package is read.
    globs: [
      'packages/runtime/src/expected-read-refusal-noise.ts',
      'scripts/check-cross-package-test-inputs.mjs',
      'packages/plugins/plugin-sharing/src/team-graph.ts',
    ],
  },
  '@objectstack/dogfood': {
    // test/*-conformance.test.ts read a fixed roster of probe files across
    // runtime, rest, plugins and services by repo-relative path. Narrow to the
    // roster rather than `packages/**/src/**`: the literal-coverage check below
    // fails the moment a probe is added outside these, so narrowing here cannot
    // quietly reopen the blind spot.
    globs: [
      'packages/client/src/**',
      'packages/mcp/src/**',
      'packages/plugins/plugin-hono-server/src/**',
      'packages/rest/src/**',
      'packages/runtime/src/**',
      'packages/services/service-realtime/src/**',
      // The three ledgers test/route-ledger-live-mount-parity.dogfood.test.ts
      // IMPORTS, which no read named and nothing declared until #10452 taught
      // this gate specifiers. That test mounts the live app and asserts every
      // ledger entry is really routed, so each ledger is an input by
      // construction. Per-file, matching what the imports name: the rest of
      // these services' `src/**` is not read here.
      'packages/services/service-storage/src/storage-route-ledger.ts',
      'packages/services/service-i18n/src/i18n-route-ledger.ts',
      'packages/services/service-settings/src/settings-route-ledger.ts',
      // flow-trigger / validation conformance pin spec's zod schemas.
      'packages/spec/src/automation/**',
      'packages/spec/src/data/**',
      // showcase-declarative-*.dogfood.test.ts chdir into the showcase app and
      // compile it, so the app IS an input, and they assert on the artifact the
      // compile pipeline and the metadata plugin produce.
      'examples/app-showcase/**',
      'packages/cli/src/commands/**',
      'packages/metadata/src/**',
      // `realtime-protocol.mdx` is named in a comment rather than read, the
      // same shape as `check-nul-bytes.mjs` on the @objectstack/cli entry
      // above and settled the same way: a mention forces a declaration, and
      // declaring the file is cheaper than rewording prose to dodge the
      // scanner. Here the coupling is real on top of being cheap — that page
      // is what documents the PLANNED realtime transports (`/ws`, SSE
      // `/api/v1/stream`), and the #2992 transport tripwires in
      // authz-conformance.test.ts are only correct for as long as they cover
      // those spellings. A third transport added to the page is exactly the
      // change that reopens the #9084 blind spot, so it must re-run this test.
      'content/docs/protocol/kernel/realtime-protocol.mdx',
    ],
  },
  '@objectstack/formula': {
    // src/rls-predicate.test.ts pins spec's RLS zod source against the
    // predicate compiler; src/skill-catalog-sync.test.ts pins the published
    // formula skill's stdlib table against the implementation.
    globs: ['packages/spec/src/security/rls.zod.ts', 'skills/objectstack-formula/**'],
  },
  '@objectstack/rest': {
    // src/meta-state-route-doc-spelling.test.ts reads the two published prose
    // sites that teach the `meta.getLegalNextStates` route and asserts each
    // spells it the way this package's REST_ROUTE_LEDGER row does, so the
    // ledger row and the prose can no longer drift apart in silence (#10178).
    // Per-file rather than `content/docs/**` or `skills/**` for the reason the
    // @objectstack/spec entry gives: those roots are edited far more often than
    // anything this radius really depends on.
    globs: [
      'content/docs/protocol/objectql/state-machine.mdx',
      'skills/objectstack-automation/SKILL.md',
    ],
  },
  '@objectstack/metadata-protocol': {
    // src/sys-metadata-repository.draft-drain.test.ts reads the durability
    // log-level gate's own source to pin that the repository stays inside it.
    globs: ['scripts/check-durability-degradation-log-level.mjs'],
  },
  '@objectstack/downstream-contract': {
    // test/source-resolution.pin.test.ts resolves every spec specifier a
    // downstream consumer can import, against spec's real source tree and the
    // `exports` map in its package.json.
    globs: ['packages/spec/src/**', 'packages/spec/package.json'],
    heldBy: {
      // `SPEC_SRC` resolves, but the files under it are reached as
      // `existsSync(target)` where `target` was computed out of the `exports`
      // map, so the roster holds `packages/spec/package.json` and nothing at
      // all under `src`.
      'packages/spec/src/**': ['packages/qa/downstream-contract/test/source-resolution.pin.test.ts'],
    },
  },
  '@objectstack/runtime': {
    // src/error-envelope.conformance.test.ts imports `stripComments` from
    // `js-comment-mask.mjs` to decide which text in the ten dispatcher modules
    // it scans is a comment and which emits an error body -- the conversion
    // #12398 began. The coupling is real: the four per-module counts that guard
    // reports are a function of the module's scanning behaviour, so a change to
    // it has to re-run this package's suite. The `.d.mts` sibling is declared
    // alongside it because it is what gives `stripComments` its type, so this
    // package's typecheck verdict is a function of it too.
    globs: [
      'scripts/js-comment-mask.mjs',
      'scripts/js-comment-mask.d.mts',
    ],
  },
  '@objectstack/driver-sql': {
    // src/live-dialect-matrix.isolation.test.ts imports `stripComments` from
    // `js-comment-mask.mjs` to decide which text in this package's 152 test
    // sources is a comment and which is a direct `OS_TEST_*_URL` read -- the
    // conversion #12398 began. The coupling is real: that guard's offender set
    // is a function of the module's scanning behaviour, so a change to it has to
    // re-run this package's suite. The `.d.mts` sibling is declared alongside it
    // because it is what gives `stripComments` its type, so this package's
    // typecheck verdict is a function of it too.
    globs: [
      'scripts/js-comment-mask.mjs',
      'scripts/js-comment-mask.d.mts',
    ],
  },
  '@objectstack/example-showcase': {
    // test/inert-wirings.test.ts imports `stripComments` from
    // `js-comment-mask.mjs` to decide which text under this app's `src/` is a
    // comment and which is an authored wiring -- the same conversion #12398
    // made for the route-ledger guards. The coupling is real: that guard's
    // offender set is a function of the module's scanning behaviour, so a
    // change to it has to re-run this package's suite. The `.d.mts` sibling is
    // declared alongside it because it is what gives `stripComments` its type,
    // so this package's typecheck verdict is a function of it too -- the reason
    // the `@objectstack/cli` entry above declares the pair rather than the
    // module alone.
    globs: [
      'scripts/js-comment-mask.mjs',
      'scripts/js-comment-mask.d.mts',
    ],
  },
  'create-objectstack': {
    // src/template-consistency.test.ts reads doc frontmatter by repo-relative
    // path to decide which templates are internal.
    //
    // `sync-template-versions.mjs` is a real cross-package READ. Since #9648,
    // src/template-version-stamps.test.ts loads the script by URL to assert its
    // declaration surface (`stampedPaths()`, `findTemplateDirs()`, the
    // `TEXT_STAMPS` table) and runs it with `execFileSync` over a two-template
    // fixture (#9554). It was a mention before that test existed, which is what
    // the rationale here used to say.
    //
    // The glob does not rest on that one test, so deleting it would not make
    // this declaration wrong — only smaller. The script STAMPS the three
    // per-template version surfaces (`package.json` @objectstack/* ranges,
    // `objectstack.config.ts` `engines.protocol`, `objectstack.manifest.json`
    // `specVersion`) that template-consistency.test.ts ratchets, so a change to
    // the stamper is exactly the change those ratchets exist to catch (#9264).
    //
    // What FORCES the glob is now the read itself. Both tests spell the path as
    // `join(repoRoot, 'scripts', 'sync-template-versions.mjs')`, which the flat
    // literal collector below cannot see — it only matches a whole repo-relative
    // path inside ONE quoted string — so until #9763 what actually held this
    // declaration was the quoted MENTION in each test's header comment, and
    // rewording either one into unquoted prose unforced a live radius.
    // Measured on 06f9848f9, before the fix: drop the glob and unquote both
    // mentions and the gate printed `OK ... exit 0`. Measured after: the same
    // ablation fails naming template-version-stamps.test.ts, the file that
    // really reads. The mentions are ordinary prose again — free to reword.
    //
    // `.github/workflows/scaffold-e2e.yml` is READ, not merely mentioned:
    // src/scaffold-e2e-boot-probe.test.ts extracts the three boot-and-probe
    // `run:` scripts out of that file and EXECUTES them, so the workflow is
    // literally the code under test. It is the workflow that gates this package
    // (its `paths:` filter is `packages/create-objectstack/**`), which is why
    // the test lives here rather than beside a shell script in spec (#9779).
    //
    // Three of the remaining four are NAMED in a test's header rather than
    // read, the same shape as `check-nul-bytes.mjs` above and settled the
    // same way: the literal collector takes quoted paths without parsing, so
    // a mention forces a declaration, and declaring a rarely-touched file is
    // cheaper than rewording prose to dodge a scanner. `serve.ts` earns it on
    // the merits too — its `flags.dev || NODE_ENV === 'development'`
    // port-shift gate is the single fact that decides which fix those
    // workflow blocks need, so a change to that branch is exactly the change
    // the test's premise would need re-measuring against. The two sibling
    // scripts are cited for the contrast that keeps the fixes from being
    // copied between them.
    //
    // `packages/cli/src/commands/init.ts` is the fourth of that shape (#10322):
    // scaffold-next-steps-pm.test.ts's header quotes it in backticks while
    // explaining that `init.ts`'s own "Next steps" output already threads its
    // detected `chosenPm` the same way this package's scaffolder now does —
    // it is cited for the contrast, never read. The test execs
    // `create-objectstack`'s own CLI via `tsx`, not `init.ts`.
    globs: [
      'content/**',
      'scripts/sync-template-versions.mjs',
      // The stamper's own import closure, and a live input for the same reason
      // the stamper is: template-version-stamps.test.ts copies the script into
      // a fixture and both IMPORTS and SPAWNS it there, so the copy needs every
      // relative import the script makes. That fixture derives the closure
      // rather than naming files, so this path appears in NO quoted string the
      // flat literal collector can see — but a change to it really does break
      // that test (measured: drop the closure walk and the same 3 cases fail
      // with ERR_MODULE_NOT_FOUND), which is exactly the trigger radius this
      // declaration exists to keep honest.
      'scripts/invoked-as.mjs',
      '.github/workflows/scaffold-e2e.yml',
      'packages/cli/src/commands/serve.ts',
      'scripts/gen-sdui-manifest.sh',
      'scripts/publish-smoke.sh',
      'packages/cli/src/commands/init.ts',
    ],
    heldBy: {
      // Read through `git grep -- content/docs` and `git ls-files`, so the
      // paths are process OUTPUT rather than literals: the pathspec itself is
      // the only quoted thing, and a directory in file position never reaches
      // the roster.
      'content/**': ['packages/create-objectstack/src/template-consistency.test.ts'],
      // The glob whose own rationale above already states the shape this
      // witness records: the fixture derives the stamper's import closure
      // instead of naming it, so this path "appears in NO quoted string the
      // flat literal collector can see" while a change to it really does break
      // that test (measured there).
      'scripts/invoked-as.mjs': ['packages/create-objectstack/src/template-version-stamps.test.ts'],
    },
  },
};
