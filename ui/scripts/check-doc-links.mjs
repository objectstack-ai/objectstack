#!/usr/bin/env node
/**
 * Rejects internal documentation links that point nowhere, across the scan
 * surfaces listed in `SCAN_ROOTS` below.
 *
 * Run:  node scripts/check-doc-links.mjs   (also `pnpm docs:check-links`)
 * Exit: 0 = every internal link resolves, 1 = at least one does not
 *
 * ## Why this file changed (objectui#3479)
 *
 * The check used to look at exactly one kind of href: the absolute site route
 * `/docs/...`. Its `routeExists()` opened with
 *
 *     if (!cleanHref.startsWith('/docs')) return true;
 *
 * so every *relative* link (`./foo.md`, `../plugins/bar.mdx`) was waved through
 * without being resolved at all. Nothing else gated them either — the site build
 * does not fail on an unresolvable link, it just renders one — so they accrued
 * silently: 33 references to 16 non-existent targets by the time anyone ran
 * `lychee --offline` over the tree.
 *
 * The information needed to check them was already here. The scan walks every
 * file, so it knows the path each href was written in; a relative href is just
 * that directory plus the href.
 *
 * ## The two link forms, and why they are checked differently
 *
 * This is not a style preference — the site resolves the two forms through
 * different machinery, and each is only correct in its own shape.
 *
 * **Relative hrefs name a FILE, extension included.** `apps/site/app/docs/
 * [[...slug]]/page.tsx` renders MDX anchors through fumadocs'
 * `createRelativeLink(source, page)`, which calls `source.resolveHref(href,
 * page)`. That function only acts on hrefs starting with `./` or `../`: it joins
 * them onto `dirname(page.path)` and looks the result up in the page indexer —
 * and the indexer is keyed by **source file path including the extension**
 * (`createPageIndexer.scan()` stores `pathToPage.set(filePath, page)`). So
 * `../plugins/plugin-charts.mdx` resolves to the real page URL
 * `/docs/plugins/plugin-charts`, while `../plugins/plugin-charts.md` misses the
 * index, falls through unresolved, and reaches the browser verbatim as
 * `/docs/plugins/plugin-charts.md` — a 404, because `next.config.mjs` rewrites
 * only the `.mdx` suffix (to the raw-markdown `llms.mdx` route). That mismatch
 * — link says `.md`, file is `.mdx` — is what all 13 A-class links in #3479 were.
 *
 * An extensionless relative href (`../concepts/lazy-loading`) misses the indexer
 * too, and is *accidentally* right whenever browser URL-relative resolution
 * happens to land on the correct route. It is accepted below (it is not a broken
 * link, and rejecting a working form would be this gate over-reaching), but it
 * is the fragile spelling: it stops working the moment the target page moves,
 * with no resolver to notice.
 *
 * **Absolute hrefs name a ROUTE, extensionless.** `resolveHref` ignores them
 * entirely, so `/docs/guide/plugins` goes to the browser as written. All 297
 * absolute `/docs/...` links in the tree are extensionless, and that branch is
 * therefore kept strict: `/docs/guide/plugins.md` is NOT accepted just because
 * `guide/plugins.md` exists on disk, because that URL 404s on the site.
 *
 * ## Why this file changed again (objectui#3490)
 *
 * The paragraph that used to sit here said non-`/docs` absolute hrefs
 * (`/spec/...`, `/api/...`, `/img/...`) were "waved through: they are routes
 * outside this collection and cannot be resolved from `content/docs` alone",
 * and that a relative href was checked purely as a path on disk. Both waivers
 * were load-bearing, and both were wrong in the same way: they made the gate's
 * question "does a file exist?" when the only question that matters to a reader
 * is "does the site serve this URL?". 18 live 404s had collected behind them —
 * 17 absolute (`/spec/*`, `/protocol/*`, `/api/core`, `/api/react`,
 * `/examples/*`) plus one relative link that resolved out of the collection
 * entirely. `lychee --offline` scores all 18 green for the same reason.
 *
 * **The trade-off this makes explicit.** Answering "does the site serve it?"
 * means the script can no longer read only `content/docs`: it now also reads
 * `apps/site` — the App-Router segment tree under `apps/site/app` and the static
 * files under `apps/site/public` — as its truth source for what URLs exist. That
 * widens the script's responsibility (and couples a `content/` gate to an
 * `apps/` layout), and it is a deliberate purchase, not an accident:
 *
 *   - Without it there is no gate at all on this class. #3479 is the evidence
 *     that "no gate" means "it accumulates": 33 dead references before anyone
 *     looked. The 18 here accumulated behind exactly the waiver being removed.
 *   - The coupling is to *structure*, not to content. `apps/site/app` is
 *     enumerated, never imported or executed, so a routing change is picked up
 *     automatically — the truth source cannot drift from the router the way a
 *     hand-maintained allowlist of prefixes would.
 *   - The cost is real and worth naming: adding a route to the site is now the
 *     thing that makes a docs link legal, so a docs PR can go red because
 *     `apps/site` moved under it. That failure is *correct* (the link really
 *     would 404), but it does mean the two trees are no longer independent.
 *
 * (The paragraph that stood here listed two things #3490 deliberately did not
 * buy: the scan surface staying at `content/docs`, and `examples/**` + the root
 * `README.md` remaining unscanned. objectui#3536 bought both — see the next
 * section. What is still not modelled is `next.config.mjs`
 * rewrites/redirects; the one rewrite, `/docs/:path*.mdx`, sits under the
 * stricter `/docs` branch above and never reaches the site-route branch.)
 *
 * **Relative hrefs may not leave the collection.** `../../../packages/foo/
 * README.md` resolves on disk, so the pre-#3490 check passed it, but
 * `source.resolveHref` can only look inside the docs page index; `packages/**`
 * is not in it, so the href reaches the browser verbatim and the browser
 * resolves it against the *page URL* — `/docs/guide/data-source` +
 * `../../../packages/...` lands on `/packages/...`, which is not a route. Such a
 * link is rejected with a pointer to the fix the repo already uses everywhere
 * else: an absolute `https://github.com/objectstack-ai/objectui/blob/main/...`
 * URL (the "Package README" form in `content/docs/plugins/*.mdx`).
 *
 * ## Why this file changed again (objectui#3536)
 *
 * Two extensions, in the two directions the paragraph above had left open.
 *
 * ### 1. The scan surface: `examples/**` and the root `README.md`
 *
 * Both had been caught carrying dead links twice, by eye and never by a gate:
 * `examples/hello-world/README.md` pointed at `../crm/` and `../todo/` after
 * those examples were deleted (#3486 / PR #3495), and the root `README.md`
 * listed four dead example entries (PR #3485). `examples/console-starter`'s 14
 * relative links (PR #3524) were checked by a throwaway script its author wrote
 * by hand, because nothing in CI would.
 *
 * **These files do not have docs semantics, and forcing them onto it would be
 * wrong.** They are read on GitHub, whose renderer resolves a relative href
 * against the file's own directory *in the repository* — so the href names a
 * path on DISK, not a fumadocs route. Three consequences, all encoded in the
 * `disk` rule below:
 *
 *   - **Existence is the whole question.** A directory is a fine target
 *     (`./packages/core` renders as a directory listing), and so is a file with
 *     no extension at all (`./LICENSE`) or one that is not markdown
 *     (`./src/App.tsx`, `./vite.config.ts`). The docs rule's
 *     `routeCandidates()` spellings are meaningless here and are not tried.
 *   - **There is no collection to escape.** `examples/console-starter/README.md`
 *     links `../../packages/app-shell/src/console/ConsoleShell.tsx` and
 *     `../../content/docs/fields/lookup.mdx`; both render correctly on GitHub.
 *     The `escapes-collection` rule that is right for `content/docs` would
 *     reject them, so it is not applied. The only containment rule is the repo
 *     boundary: a path resolving above `<repoRoot>` cannot be rendered at all.
 *   - **An extensionless spelling of a markdown file is a dead link, not a
 *     fragile one.** `../plugins/plugin-charts` is accepted under the docs rule
 *     (a browser may resolve it); on GitHub it is a 404, because there is no
 *     file by that name. The disk rule therefore does not accept it.
 *
 * **Absolute `/...` hrefs in these files: rejected** (`example-absolute`).
 * There are none today — the decision is preventive, and it is the one the
 * renderer forces. GitHub does not rewrite a leading `/`; it resolves it
 * against `github.com` itself, so `[core](/packages/core)` in the root README
 * links to `https://github.com/packages/core`, not to this repo's directory.
 * The hint names both repairs, because the rare deliberate case (a real
 * github.com path) is real: write the repo path relative, or write the
 * github.com URL in full. Waving the shape through instead would be the same
 * silent waiver #3490 spent 18 live 404s removing.
 *
 * ### 2. A decidable href shape: this repo's own GitHub blob/tree URLs
 *
 * `https://github.com/objectstack-ai/objectui/(blob|tree)/main/<path>` is an
 * in-repo reference wearing an external URL's clothes, and it fell between the
 * two gates (#3507): this script skipped it by scheme, and lychee — the only
 * thing that would resolve it — is a `schedule` + `workflow_dispatch` workflow
 * with no PR trigger, so it blocks nobody. (It is `fail: true`, not a
 * soft-failing job: what keeps it off pull requests is the absent trigger, not
 * a tolerated failure. #3213 ruling B says keep it that way — uncommenting
 * `pull_request:` would turn it into a hard gate over the network.) Two such
 * links stayed dead for about three months. The backlog was cleared to zero by
 * PR #3509 (25 distinct targets swept, exactly the 2 dead), and PR #3506 then
 * introduced 8 more of the shape with nothing checking them. This closes that:
 * `<path>` must exist in the working tree.
 *
 * It applies to **every** surface, `content/docs` included — the shape is
 * decidable wherever it is written, and the `escapes-collection` hint above
 * actively recommends it, so leaving it unchecked would recommend an unchecked
 * form as the fix for a checked one.
 *
 * Deliberately narrow, because the rest is not decidable offline:
 *
 *   - **Only `main`.** `blob/v1.2.0/...` or `blob/<sha>/...` names a different
 *     ref; the working tree cannot answer for it.
 *   - **Only this repo.** Other repos' GitHub URLs stay external (lychee's job).
 *   - **Only the path** — WAS. Anchors were out of scope when this bullet was
 *     written, "because resolving an anchor means parsing the target, which is
 *     a different gate". objectui#7644 built that gate, so a `#fragment` on one
 *     of these URLs IS resolved now, whenever the path names a markdown file in
 *     this tree; a `#L42` line reference still is not. See that card's section.
 *   - **Only `blob|tree`.** `https://github.com/objectstack-ai/objectui/issues`
 *     and the `workflows/<name>/badge.svg` badge URLs in the root README are
 *     github.com web routes, not paths in this tree, and stay skipped.
 *
 * ## Why this file changed again (objectui#3572)
 *
 * The section that stood here, "Still not bought", named the next surface and
 * its entry price: `CONTRIBUTING.md`, `ROADMAP.md` and the internal `docs/`
 * tree were unscanned, and adding them was "one `SCAN_ROOTS` row each — plus
 * fixing what that turns red". Both halves came due, in that order.
 *
 * The red was paid first and separately (#3545 / PR #3571): three dead links,
 * two in `CONTRIBUTING.md` and one in `ROADMAP.md`. So this change is the three
 * rows and nothing else — measured at 70 links across the three surfaces, of
 * which 52 are decidable here, and **zero** dead the day it landed. That is the
 * shape an extension should have; contrast #3479 (16 dead targets) and #3490
 * (18), where the gate and its own backlog arrived together.
 *
 * `docs/**` is the one of the three nothing had ever measured. Lychee's scope
 * does list it, but that workflow is `schedule` + `workflow_dispatch` only —
 * `push` and `pull_request` are commented out on purpose (#3213 ruling B: an
 * external link check goes over the network and would redden PRs their authors
 * cannot fix), so it blocks nobody. 47 of its 49 links had therefore never been
 * resolved by anything that could fail a build.
 *
 * All three take the `disk` rule, and correctly: they are read on GitHub, like
 * `examples/**` and the root `README.md`. No new rule class, no new reason
 * string, no new hint.
 *
 * ### The boundary this does NOT cover: links inside code fences
 *
 * Stated because the alternative is implying total coverage. `stripCode()`
 * blanks fenced blocks and inline spans before the scan (see the section below
 * — it is what makes the relative-link check safe at all), so **a link written
 * inside a fence is invisible to this gate, dead or not**.
 *
 * That is not hypothetical on the very surface being added. `CONTRIBUTING.md`
 * carries 25 markdown links; 10 sit inside fences, and this gate judges exactly
 * **one** of the remaining 15 (the other 14 are `#anchors` and external URLs).
 * Those 10 are objectui#3570's instance class — a fenced block illustrating
 * docs-link conventions whose "correct example" routes (`/guide/quick-start`,
 * `/api/core`, `/spec/component`, …) are themselves dead. A reader copies them;
 * this script never sees them. Fixing that text is #3570's job; noticing that
 * no gate can reach it is this comment's.
 *
 * Widening `stripCode()` is not the repair, and the two false positives it was
 * built for are why: fenced code legitimately contains `[…](…)` that is not a
 * link. A gate for prose *about* links inside fences would need to tell an
 * illustrative route from an executable one, which is a different gate.
 *
 * (A "Still not bought" list closed this section, naming `QUICK_REFERENCE.md`,
 * `AGENTS.md`, `CLAUDE.md` and `CHANGELOG.md`. It moved to the end of the
 * objectui#3622 section below, and objectui#4148 bought all four — the current
 * list of what is still unscanned is at the end of that card's section.)
 *
 * ## Why this file changed again (objectui#3603)
 *
 * A second scheme-bearing shape that is decidable here, and the exact mirror of
 * the self-repo blob URLs above: **this site's own absolute URLs**.
 *
 * `judgeHref()` skipped every href carrying a scheme (`EXTERNAL_HREF_RE`), with
 * `SELF_REPO_BLOB_RE` as the single exception. So
 * `https://www.objectui.org/docs/guide/plugins` — a route on the very site this
 * repo publishes, whose whole route table is already enumerated above to serve
 * the `/docs/...` and `/...` branches — was never resolved, while the identical
 * route written `/docs/guide/plugins` was checked strictly. The origin is the
 * only difference between the two, and it is the one part of a URL this script
 * can be certain about.
 *
 * **Not a package-README special case, and deliberately not written as one.**
 * The blind spot lives in `judgeHref()`, so it was never confined to any
 * surface: `content/docs` carries 6 site-absolute URLs of its own and the root
 * `README.md` 5, and all 11 were unchecked until now. Stripping the origin and
 * handing the rest to `routeExists()` fixes the class everywhere at once, which
 * is also why it needs no new rule and no new scan root.
 *
 * Both host spellings are live in this tree (`www.objectui.org` and bare
 * `objectui.org`), so both are accepted; every other origin stays external and
 * remains lychee's problem. Because what survives the strip is an ordinary
 * absolute site path, it inherits BOTH branches of `routeExists()` unchanged —
 * `/docs` strictness included. `https://www.objectui.org/docs/guide/plugins.md`
 * is rejected for precisely the reason `/docs/guide/plugins.md` is.
 *
 * Measured before landing: 11 site-absolute URLs across today's surfaces, zero
 * dead. The #3572 shape again — the check arrives green, its backlog already
 * paid.
 *
 * ## Why this file changed again (objectui#3622): the package READMEs, bought
 *
 * The section that stood here was headed "Measured and NOT bought". It recorded
 * the price of objectui#3603's other half — growing the scan surface by the 38
 * package READMEs, which is where the 9 dead links that prompted that card lived
 * — and refused to add the row until that price was paid, per this file's rule
 * from #3572. It is paid, so the row is in the table above.
 *
 * (Note kept for whoever edits that row: a glob naming each package README
 * cannot be spelled inside this block comment, because the star-slash in it
 * closes the comment. It is described in prose here and written out only in the
 * table below, which is code.)
 *
 * The price was **11 more** dead links, none of them among #3603's 9. They sit
 * in seven packages: five that card never opened, plus two where it had already
 * fixed a different line. `/api/core`, `/api/react` and `/api/components` (no
 * such routes — the class #3490 swept); `/docs/core`, `/docs/fields` and
 * `/docs/layout`, twice (real directories with no index page, so no route);
 * `/docs/types` and `/examples` (neither exists); and two disk paths that were
 * simply absent (a `docs/SHADCN_SYNC.md` that has never existed, and a
 * per-package `LICENSE` that `packages/vscode-extension` does not have).
 *
 * All eleven were repointed at a page or path that does exist, in the same PR as
 * this row — none had to be dropped, unlike #3603's 9, where 6 assumed a whole
 * `/docs/packages/...` namespace that was never written. So the row arrives on a
 * green tree, the #3572 shape.
 *
 * Three of those deserve naming, because objectui#3603's own verification
 * script scored them GREEN: it accepted a bare DIRECTORY as a fumadocs
 * candidate. This gate does not, and is right not to — `routeCandidates()` has
 * no such spelling, and the pinned test "rejects a relative link to a directory
 * that has no index page" is that decision. `content/docs/core/` really has no
 * index page, so `/docs/core` really does 404. The class was 20 links, not 9.
 *
 * **The rule is `disk`, and that is not a coin toss.** A package README is read
 * on npm and on GitHub, never served by the site, so its relative hrefs are
 * paths on disk exactly like `examples/`, the root `README.md`,
 * `CONTRIBUTING.md`, `ROADMAP.md` and `docs/`: `./CHANGELOG.md` is a file next
 * to it, not a route. The same reading forbids the origin-less `/docs/...`
 * spelling this file prefers inside `content/docs` — GitHub and npm resolve a
 * leading `/` against their own host — which is why the site links repaired
 * above all keep the `https://[www.]objectui.org/...` origin, and are still
 * checked as strictly as the origin-less form (see the section above).
 *
 * The one thing the row does need is a wildcard segment in the scan-root path,
 * since the surface is one file per package directory rather than a tree.
 * `expandWildcard()` is that, and no more than that.
 *
 * ### Still not bought
 *
 * The list that stood here named `QUICK_REFERENCE.md`, `AGENTS.md`, `CLAUDE.md`
 * and `CHANGELOG.md`, alongside the non-README markdown inside packages. All
 * four were bought by objectui#4148 — see the next section, which also carries
 * the current version of this list.
 *
 * ## Why this file changed again (objectui#4148): apps and the repo root
 *
 * Two rows, landed together because they are one fact: both surfaces were ones
 * THIS HEADER named as unscanned, and in the months each spent on that list the
 * only thing that ever noticed a dead link on either was a person reading the
 * page. A gap a gate documents about itself is still a gap.
 *
 * ### 1. The app READMEs
 *
 * `apps/console/README.md` linked twice to `./CONSOLE_ROADMAP.md`. That file left
 * the directory in `c988277ff` (renamed to a root `ROADMAP_CONSOLE.md`) and was
 * folded into the root `ROADMAP.md` by `3e814e07a` a week later. Both links then
 * sat dead for about six months while `pnpm docs:check-links` reported green on
 * every push — `apps/` was in no scan root, so `apps/console/README.md` and
 * `apps/site/README.md` alike were unlinted. objectui#4148 is that report, filed
 * out of objectui#4143.
 *
 * The row is objectui#3622's purchase one directory over, and takes the `disk`
 * rule for a stronger version of the same reason: `@object-ui/console` is a
 * PUBLISHED package (its manifest declares no `private`), so its README is read
 * on npm and on GitHub exactly like a package README, and is never served by the
 * site. It is a wildcard row for the same reason as the package one — the surface
 * is one file per directory rather than a tree — which also means the next app to
 * land under `apps/` is scanned on arrival, with no row for anyone to remember.
 *
 * Only the READMEs: the `CHANGELOG.md` beside each stays out, with the
 * package-internal markdown below, so there is one unbought class here and not
 * two.
 *
 * Price: **2** dead links, both halves of the `CONSOLE_ROADMAP.md` pair, repointed
 * at the root `ROADMAP.md` in the same PR. The filing had assumed that content was
 * deleted and so had no successor; the history above says it was moved, which is
 * what makes repointing an answer rather than a guess.
 *
 * ### 2. The root-level markdown files
 *
 * `AGENTS.md`, `CHANGELOG.md`, `CLAUDE.md`, `LICENSE-THIRD-PARTY.md` and
 * `QUICK_REFERENCE.md` — one row each, joining the root `README.md`,
 * `CONTRIBUTING.md` and `ROADMAP.md` already in the table. Per-file rows rather
 * than a glob, because the root is a fixed short list rather than a directory
 * that grows, and because `expandWildcard()` deliberately expands only a whole
 * path SEGMENT: `*.md` is not a spelling this table has, and would throw.
 *
 * That completes the surface, and completeness is the point — every tracked
 * markdown file at the top level of this repo is now scanned, which is an
 * invariant a test can hold rather than a list that goes stale. It does hold one:
 * a new root-level page with no row turns `check-doc-links.test.ts` red, so this
 * particular hole cannot silently reopen.
 *
 * `LICENSE-THIRD-PARTY.md` was never on the header's list and is bought anyway,
 * precisely to make that invariant statable. "These four named files" is a claim
 * that decays; "all of them" is one that a test can keep true.
 *
 * Price: **zero** dead links — the objectui#3572 shape, a check arriving with its
 * backlog already paid. Measured before landing: 11 links across the five files,
 * 9 of them decidable here. objectui#4149 had already resolved
 * `QUICK_REFERENCE.md`'s eight inside its own pin test, explicitly as a stopgap
 * for one file "to be deleted when a SCAN_ROOTS row makes it redundant". This is
 * that row, and that block goes with it — a second implementation of a check is
 * worse than no second implementation, because only one of them gets maintained.
 *
 * Two of the five carry nothing for this gate to judge today, and are bought
 * without argument anyway: `AGENTS.md` has no markdown links at all (its paths
 * are code spans, which `stripCode()` blanks), and both of `CHANGELOG.md`'s are
 * external. A row over a file with no decidable links is not vacuous — it is the
 * row that judges the FIRST dead link written into that file, which is the exact
 * failure this file exists to prevent. Buying a surface while it is empty is the
 * cheapest this ever gets.
 *
 * ### Still not bought
 *
 * The list that stood here — each `CHANGELOG.md`, `TESTING.md`, `MIGRATION.md`,
 * and the per-package `docs/` trees — is bought, minus `CHANGELOG.md`, by
 * objectui#4938 below.
 *
 * ## Why this file changed again (objectui#4938): the rest of each package/app
 *
 * The surface named above, priced. `packages/*` and `apps/*` walk everything
 * under each package/app directory that the `README.md` rows above do not
 * already cover — `TESTING.md`, `MIGRATION.md`, a `docs/` tree, a nested
 * component doc, whatever markdown a package happens to carry — with two
 * filenames left out:
 *
 *   - **`CHANGELOG.md`.** Changesets output, not authored prose; the root one
 *     already has its own row (objectui#4148) for the same reason every other
 *     root file does, but a *per-package* changelog is generated fresh on
 *     every release and carries no link a person wrote on purpose. Buying it
 *     would gate machine output, not documentation.
 *   - **`README.md`, at every depth.** Not only the top-level file the row
 *     above already scans — a NESTED `README.md`
 *     (`packages/core/src/adapters/README.md`,
 *     `packages/plugin-gantt/docs/verification/README.md`,
 *     `packages/components/src/__tests__/README.md`,
 *     `packages/types/src/zod/README.md`, four found while measuring this row)
 *     is excluded too, on purpose: it IS a README by name, so it falls outside
 *     what objectui#4938 measured and priced ("non-README markdown"), even
 *     though nothing scans it either. That is a real, still-open gap — filed
 *     as its own card rather than folded in here uninvited, per this file's
 *     own one-expansion-one-card practice (objectui#3536 → #3572 → #3603/#3622
 *     → #4148, each its own PR against its own measured price).
 *
 * `exclude` on a `SCAN_ROOTS` row (see `collectFiles()`) is the mechanism: a
 * set of basenames `walk()` leaves out at every depth, so the row can sit on
 * top of an existing single-file row without re-judging that file, and without
 * pulling in the nested-README class above.
 *
 * **Price: 15 files, 4 decidable relative markdown links, 1 dead** —
 * `packages/components/src/renderers/complex/TIMELINE.md:349`, pointing at
 * `../../examples/prototype/src/App.tsx`. That example app was deleted whole in
 * `3aa84cee0` with no successor at the same path; the link sat dead with no
 * gate able to see it. Repointed, in the same PR as this row, at the live
 * interactive demo the docs site now serves for the same three timeline
 * variants the prose describes (`https://www.objectui.org/docs/plugins/
 * plugin-timeline`) — a page, not a path, because `TESTING.md` and its
 * siblings are `disk`-rule files read on GitHub, the same reason every other
 * disk-rule row here links the docs site by its full origin rather than a
 * root-relative `/docs/...` spelling.
 *
 * Rule: `disk`, for the same reason as every row above it back to
 * objectui#3536 — these files are read on GitHub (and, for a published
 * package, on npm), never served by the site.
 *
 * ## Why this file changed again (objectui#6026): the nested READMEs
 *
 * The gap the section above names, closed. `exclude` leaves a basename out at
 * EVERY depth, so `README.md` on the `packages/*` / `apps/*` rows hid four
 * files nothing else could reach either — the rows above them are exact
 * top-level globs, and a nested README is not at that path:
 *
 *     packages/components/src/__tests__/README.md
 *     packages/core/src/adapters/README.md
 *     packages/plugin-gantt/docs/verification/README.md
 *     packages/types/src/zod/README.md
 *
 * **Price: 4 files, 97 markdown links, 96 of them decidable here, 0 dead** —
 * objectui#3572's shape, the one an extension should have: the row arrives at
 * a surface already green rather than towing its own backlog (contrast
 * objectui#3479's 16 dead targets and objectui#3490's 18). Nearly all of that
 * is one file: `packages/plugin-gantt/docs/verification/README.md` carries 94
 * of the 97, a verification log of relative links to sibling scripts, source
 * files and its own screenshots. The other three carry 3 links between them,
 * one of which is external.
 *
 * Because the price is zero, a passing run proves nothing on its own — so the
 * tests pin the SURFACE (these files are opened, each by exactly one row) and
 * not only the verdict.
 *
 * ### The mechanism: `collect`, and a row rooted one directory down
 *
 * `collect` is `exclude`'s inverse — the ONLY basenames `walk()` keeps, again
 * at every depth. The two new rows add a second wildcard segment to
 * `packages/*` and `apps/*` (the table below carries the literal paths; a
 * block comment cannot, because the two characters that close a wildcard
 * segment also close a comment). `expandWildcard()` turns each segment into
 * the directories at that level, so these rows are rooted at the SUBdirectories
 * of each package/app — and a package's own top-level `README.md` is not
 * inside any of them, so it cannot be reached from here at all.
 *
 * That is the whole no-double-parse guarantee, and it is structural rather
 * than a filter someone has to keep in sync: nothing in these rows mentions
 * "top level", and `walk()` still has no notion of depth. The alternative
 * considered — narrowing the `exclude` on `packages/*` to the top-level README
 * only — needed exactly that notion, and it would then have been load-bearing
 * for every future row rather than for this one.
 *
 * Together the three package rows partition the surface: the exact top-level
 * `README.md`, every nested `README.md`, and everything that is neither a
 * README nor a `CHANGELOG.md`. Every file is opened by exactly one row —
 * asserted over the real tree, not left to reading.
 *
 * `CHANGELOG.md` stays excluded at every depth, unchanged. There is no nested
 * one today; the exclusion is about what the name means (changesets output,
 * never authored prose), not about where the file sits.
 *
 * ## Why this file changed again (objectui#7644): the `#fragment`, at last
 *
 * Everything above resolves the DOCUMENT an href names. Nothing resolved the
 * ANCHOR inside it. `hrefPath()` and `routeExists()` both opened by cutting the
 * href at its `#`, and `EXTERNAL_HREF_RE` waved a pure `#anchor` through by
 * shape, so `[label](#some-heading)` was never judged by anything at all.
 *
 * The consequence is the failure this whole file exists to prevent, one level
 * in: rename a heading and every cross-reference to it is orphaned silently,
 * with this gate green. It is not a projection — objectui#7643 renamed
 * `### KanbanSchema` to `### DeclarativeKanbanSchema` and the
 * `[…](#kanbanschema)` one screen away had to be corrected BY HAND, because no
 * gate in the farm could see it.
 *
 * objectui#7644 measured the hole as a two-arm control on one file, and the
 * control arm is what makes the zero a reading rather than a dead instrument:
 * the SAME invocation, on the SAME file, exited 1 on a broken file path
 * (`Relative links must name the target FILE`) and 0 on a broken in-page
 * anchor. Reproduced on this branch before the fix, with each mutation proved
 * on disk by anchored count plus `git hash-object` off the HEAD blob.
 *
 * ### The slug rule is the renderers', and it is COPIED rather than re-derived
 *
 * An anchor set is only as good as the slug function that builds it — a rule
 * that disagrees with the renderer is a false red on a correct link, which is
 * worse than the hole. Both renderers this repository publishes through use
 * `github-slugger`, one instance per document, walked over the headings in
 * order so a repeated heading's `-1`/`-2` suffix lines up:
 *
 *   - `content/docs` (`docs` rule) is fumadocs, whose `remarkHeading` slugs
 *     `flattenNode(heading)` and additionally honours an explicit
 *     `## Heading [#custom-id]` override on the heading's last text node. No
 *     file in this tree uses that syntax today; it is implemented anyway,
 *     because the first author who does would otherwise get a false red.
 *   - every `disk` surface is GitHub, which is what `github-slugger` exists to
 *     reproduce, and which has no `[#custom-id]` syntax — so that branch is
 *     applied to the `docs` rule only.
 *
 * `scripts/github-slug.mjs` holds the rule, vendored, and its own header says
 * why a copy rather than an import: this gate runs BEFORE `pnpm install` (see
 * `scripts/check-pre-install-import-graph.mjs --list`), so a package import
 * would stop it running on exactly the markdown-only pull requests it exists
 * for. The equivalence is not asserted by reading — the pin test compares this
 * file's anchor sets against the REAL fumadocs `remarkHeading` and the REAL
 * `github-slugger`, over every file in the scan surface. Measured when this
 * landed: 273 files, 184 `docs` and 89 `disk`, ZERO disagreements. That corpus
 * check is the thing that keeps the copy honest, and it is why the inline
 * flattener's one non-obvious rule — a `*`/`_` run is emphasis only when it is
 * NOT intraword — is written the way it is rather than the obvious way. The
 * obvious way (strip them all) disagreed with mdast on two real headings here,
 * `NON_GRID_ROW_CEILING` and a `new_window` in `ROADMAP.md`.
 *
 * ### What is decided, and what is left alone
 *
 * A fragment is judged when, and only when, the document it names is a markdown
 * file in this tree — same page, another page, or a package README reached
 * through this repo's own blob URL. That last one retires a waiver written four
 * sections up: the objectui#3536 bullet said a self-repo blob URL's `#fragment`
 * was "out of scope … resolving an anchor means parsing the target, which is a
 * different gate". This is that gate, so the bullet no longer holds and has
 * been corrected in place. Three such links exist today and all three resolve;
 * a `#L42`-shaped line reference is still skipped, because it names a line in
 * the raw view rather than a heading.
 *
 * Left undecidable, deliberately: a fragment on a site route outside the docs
 * collection (`apps/site/app` is TSX, not headings), on a non-markdown target,
 * and on any other origin (lychee's problem). Those return "no opinion", never
 * a pass dressed as one.
 *
 * ### The backlog: counted, and it was one
 *
 * Turning a check on usually means paying its accumulated red first, and the
 * card was dispatched expecting a shrink-only baseline. Counted from the tree
 * rather than assumed: 143 hrefs carry a non-empty fragment, 142 of them
 * decidable here, and exactly ONE was dead — a `#q3-the-5127-judgement-surface`
 * in `docs/audits/2026-08-zod-to-json-schema-fidelity.md` whose heading reads
 * `## Q3: the objectui#5127 judgement surface` and therefore slugs to
 * `q3-the-objectui5127-judgement-surface`. It is repaired in the same commit,
 * so this check lands FULLY STRICT with no baseline row — the objectui#3572
 * shape, and the better outcome of the two the card's ruling allowed for. A
 * baseline is a ratchet, not a prize; there was nothing to ratchet.
 *
 * ## Code spans are stripped before scanning
 *
 * Required, not tidiness. Extending the scan to relative hrefs turns markdown's
 * own link syntax, quoted inside code, into false positives — `main` carries two
 * today:
 *
 *   - `content/docs/guide/notifications.md:54` — inside a ```tsx fence,
 *     `toast[n.severity](n.title, { description: n.message })` matches the link
 *     regex with an "href" of `n.title, { description: n.message }`.
 *   - `content/docs/fields/rich-text.mdx:47` — the inline code span
 *     `` `[text](url)` `` documents the syntax itself.
 *
 * Neither renders as an anchor, so neither is this gate's business. Blanking
 * fenced blocks and inline spans (padding with spaces, so reported line numbers
 * stay true) is what makes the relative-link check safe to turn on.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import { GithubSlugger } from './github-slug.mjs';

const DOCS_ROUTE_PREFIX = '/docs';
const MARKDOWN_LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;
/** A fence line: optional indent, 3+ backticks or tildes, optional info string. */
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
/** An inline code span on a single line: `like this`, ``or this``. */
const INLINE_CODE_RE = /(`+)[^`\n]*\1/g;
/** Any URI scheme (`https:`, `mailto:`, `tel:`) — not ours to resolve. */
const EXTERNAL_HREF_RE = /^(?:#|[a-zA-Z][a-zA-Z0-9+.-]*:)/;
/** Files that turn an App-Router directory into a servable URL. */
const ROUTE_ENTRY_RE = /^(?:page|route)\.(?:js|jsx|ts|tsx|md|mdx)$/;
/**
 * This repo's own GitHub URLs, in the one shape that is decidable offline: a
 * `main` blob/tree path (objectui#3536). Case-insensitive because github.com
 * treats owner and repo that way; the captured path is used as written.
 */
const SELF_REPO_BLOB_RE = /^https:\/\/github\.com\/objectstack-ai\/objectui\/(?:blob|tree)\/main\/(.+)$/i;
/**
 * This site's own origin — the second decidable scheme-bearing shape
 * (objectui#3603). Both host spellings are in use in this tree, and the site
 * serves the same routes under each. Anchored at both ends so a lookalike host
 * (`objectui.org.example.com`) cannot match; the captured group is the absolute
 * site path, which `routeExists()` then judges exactly as if it had been
 * written without the origin.
 */
const SITE_ORIGIN_RE = /^https?:\/\/(?:www\.)?objectui\.org(\/[^\s]*)?$/i;
/** Never markdown sources of ours, and huge — walking them wastes the scan. */
const UNSCANNED_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', '.git']);
/** Shared empty exclude set — a fresh `Set()` per call would work identically, this just avoids allocating one on every `walk()`/`collectFiles()` call that has no row-level `exclude`. */
const EMPTY_EXCLUDE = new Set();
/**
 * Collecting BY basename and excluding BY basename are opposite readings of
 * one list, so a row carrying both has no defensible meaning — and what it
 * would produce is the silent failure this file refuses everywhere else, a
 * surface quietly narrowed to nothing. Same stance as `expandWildcard()`:
 * throw rather than guess (objectui#6026).
 */
const BOTH_FILTERS = 'A SCAN_ROOTS row may set `exclude` OR `collect`, never both';

/**
 * The scan surfaces, and the link semantics each one actually has.
 *
 * `docs` — the fumadocs collection: an href names a site ROUTE, resolved
 *          through the page index and the `apps/site` router.
 * `disk` — files read on GitHub: an href names a PATH in this repository.
 *
 * The split is the point (objectui#3536). See the header for why applying the
 * docs rules to the second group would reject links that render perfectly well:
 * over today's `disk` surface it would reject 198 links that all render — 112 on
 * the surfaces that predate objectui#3622, 76 in the package READMEs it added,
 * and 10 in the app READMEs and root-level files objectui#4148 added. (The first
 * two figures were 111 and 75 when #3622 measured them; the +1 each is ordinary
 * link churn on those pages since, remeasured here rather than carried forward.)
 *
 * Adding a surface is one row. Adding one that is read on GitHub needs no new
 * rule class at all — which is why objectui#3572 could take the last three for
 * the price of the table entry, objectui#3622 the package READMEs, and
 * objectui#4148 the app READMEs and the rest of the repo root.
 *
 * A row's `path` is a directory to walk, a single markdown file, or a pattern
 * whose wildcard SEGMENTS each stand for every directory at that level — see
 * `expandWildcard()` below, which is all the glob syntax this table has.
 *
 * A directory row may narrow what the walk keeps, by basename, at every depth:
 * `exclude` names what to leave out, `collect` names the only names to take.
 * They are opposite readings of one list, and a row may carry at most one.
 */
export const SCAN_ROOTS = [
  { path: 'content/docs', rule: 'docs' },
  { path: 'examples', rule: 'disk' },
  { path: 'README.md', rule: 'disk' },
  { path: 'CONTRIBUTING.md', rule: 'disk' },
  { path: 'ROADMAP.md', rule: 'disk' },
  { path: 'docs', rule: 'disk' },
  { path: 'packages/*/README.md', rule: 'disk' },
  { path: 'apps/*/README.md', rule: 'disk' },
  // The rest of each package/app directory tree, minus the two rows already
  // above it and the one filename that is never authored prose (objectui#4938).
  // See "Why this file changed again (objectui#4938)" in the header.
  { path: 'packages/*', rule: 'disk', exclude: ['README.md', 'CHANGELOG.md'] },
  { path: 'apps/*', rule: 'disk', exclude: ['README.md', 'CHANGELOG.md'] },
  // The nested `README.md` files: left out of the two rows above by their
  // every-depth `exclude`, and never in range of the exact top-level globs
  // above those, so nothing had ever opened them (objectui#6026). The SECOND
  // wildcard segment is what keeps the top-level README out of these rows —
  // they are rooted at each package/app's subdirectories, and the file the
  // earlier row already scans is not inside any of them. See that card's
  // section in the header.
  { path: 'packages/*/*', rule: 'disk', collect: ['README.md'] },
  { path: 'apps/*/*', rule: 'disk', collect: ['README.md'] },
  // The rest of the root-level markdown, completing that surface (objectui#4148).
  // `README.md`, `CONTRIBUTING.md` and `ROADMAP.md` are already above, in the
  // positions the rows that bought them left them in.
  { path: 'AGENTS.md', rule: 'disk' },
  { path: 'CHANGELOG.md', rule: 'disk' },
  { path: 'CLAUDE.md', rule: 'disk' },
  { path: 'LICENSE-THIRD-PARTY.md', rule: 'disk' },
  { path: 'QUICK_REFERENCE.md', rule: 'disk' },
];

const blank = (text) => text.replace(/[^\n]/g, ' ');

/**
 * Every markdown file under `dir`, at any depth, minus the directory names
 * nothing of ours is ever the source of.
 *
 * The two basename filters are alternatives, and both apply at EVERY depth —
 * `walk()` does not know how deep it has recursed, and deliberately still does
 * not (objectui#6026: a row needing "top level only" says so with an extra
 * wildcard segment in its `path`, not with a depth rule in here):
 *
 *   - `exclude` — the names to leave out (objectui#4938);
 *   - `collect` — when given, the ONLY names to take, which is what makes
 *     `exclude` meaningless alongside it.
 *
 * @param {string} dir            the directory to walk
 * @param {string[]} [files]      accumulator, so the recursion has one array
 * @param {Set<string>} [exclude] basenames to leave out, at every depth
 * @param {Set<string> | null} [collect] the only basenames to take, at every depth
 * @returns {string[]}
 */
export function walk(dir, files = [], exclude = EMPTY_EXCLUDE, collect = null) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files; // a scan root that does not exist here contributes nothing
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!UNSCANNED_DIRS.has(entry.name)) walk(fullPath, files, exclude, collect);
      continue;
    }
    if (!/\.(md|mdx)$/.test(entry.name)) continue;
    if (collect ? !collect.has(entry.name) : exclude.has(entry.name)) continue;
    files.push(fullPath);
  }
  return files;
}

/**
 * Expands the leftmost wildcard segment of a scan root into one path per
 * directory at that level, sorted so the scan order — and therefore the report
 * order — does not depend on the filesystem's (objectui#3622). `collectFiles`
 * recurses, so a later wildcard segment expands on the next pass — which is
 * how the two-wildcard rows added by objectui#6026 come to mean "every
 * subdirectory of every package/app", and therefore why a `README.md` sitting
 * at a package's top level is outside those rows by construction.
 *
 * Deliberately not a glob library: a whole segment that is exactly `*`, and
 * nothing else. Anything richer THROWS rather than quietly matching nothing,
 * because a scan root that expands to zero paths is a surface silently dropped
 * — the one failure mode this gate must not have (same stance as the missing
 * route table in `routeExists()`).
 */
function expandWildcard(pattern) {
  const segments = pattern.split(path.sep);
  const index = segments.findIndex((segment) => segment.includes('*'));
  if (segments[index] !== '*') {
    throw new Error(
      `A SCAN_ROOTS path may only use a wildcard as a whole path segment, and got "${pattern}". ` +
        'Widen the row to the directory above, or add the paths one row each.',
    );
  }

  const parent = segments.slice(0, index).join(path.sep);
  const rest = segments.slice(index + 1);
  let entries;
  try {
    entries = readdirSync(parent, { withFileTypes: true });
  } catch {
    return []; // the parent is not here — same contract as a missing scan root
  }

  return entries
    .filter((entry) => entry.isDirectory() && !UNSCANNED_DIRS.has(entry.name))
    .map((entry) => [parent, entry.name, ...rest].join(path.sep))
    .sort();
}

/**
 * One scan root, which may be a directory to walk, a single markdown file, or a
 * wildcard pattern standing for one path per directory at that level.
 *
 * `exclude` (objectui#4938) names BASENAMES to leave out at every depth under a
 * directory root — `README.md` and `CHANGELOG.md` for the two package/app
 * "everything else" rows, so a directory walk can be added on top of the
 * single-file README row it duplicates without re-judging the same file twice.
 *
 * `collect` (objectui#6026) is its inverse: the only basenames to KEEP, again
 * at every depth — `README.md` for the two nested-README rows, whose paths
 * carry a second wildcard segment so the top-level README the earlier rows own
 * is not underneath them to begin with.
 *
 * Neither has any effect on a single-file root: a row names its own file
 * outright, not by basename, so there is nothing to filter.
 *
 * @param {string} root           a directory, a markdown file, or a wildcard pattern
 * @param {Set<string>} [exclude] basenames to leave out, at every depth
 * @param {Set<string> | null} [collect] the only basenames to take, at every depth
 * @returns {string[]}
 */
export function collectFiles(root, exclude = EMPTY_EXCLUDE, collect = null) {
  if (collect && exclude.size > 0) throw new Error(`${BOTH_FILTERS}, and got both for "${root}".`);
  if (root.includes('*')) return expandWildcard(root).flatMap((expanded) => collectFiles(expanded, exclude, collect));
  try {
    if (statSync(root).isFile()) return /\.(md|mdx)$/.test(root) ? [root] : [];
  } catch {
    return [];
  }
  return walk(root, [], exclude, collect);
}

/**
 * Replaces every fenced block and inline code span with spaces, leaving the
 * byte length and every newline untouched so offsets — and therefore reported
 * line numbers — still line up with the original file.
 */
export function stripCode(source) {
  const out = [];
  let openFence = null;

  for (const line of source.split('\n')) {
    const fence = FENCE_RE.exec(line);

    if (openFence) {
      out.push(blank(line));
      const closes =
        fence && fence[1][0] === openFence[0] && fence[1].length >= openFence.length && fence[2].trim() === '';
      if (closes) openFence = null;
      continue;
    }

    if (fence) {
      openFence = fence[1];
      out.push(blank(line));
      continue;
    }

    out.push(line.replace(INLINE_CODE_RE, (match) => blank(match)));
  }

  return out.join('\n');
}

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Existence, the `disk` rule's whole question — a directory counts, and so does
 * a file with no extension. GitHub renders links to both.
 */
function pathExists(candidate) {
  try {
    statSync(candidate);
    return true;
  } catch {
    return false;
  }
}

/** Is `candidate` `root` itself, or inside it? */
function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/** Strips the fragment and query, and decodes escapes — shared by every rule. */
function hrefPath(href) {
  const cleanHref = href.split('#')[0].split('?')[0].trim();
  try {
    return decodeURI(cleanHref);
  } catch {
    return cleanHref; // a malformed escape is checked as written
  }
}

/**
 * The in-repo path a self-referential GitHub URL names, or `null` if this href
 * is not one (objectui#3536). Fragments are stripped: anchors are out of scope.
 */
export function selfRepoPath(href) {
  const match = SELF_REPO_BLOB_RE.exec(hrefPath(href));
  return match ? match[1].replace(/\/+$/, '') : null;
}

/**
 * The absolute site path a site-absolute URL names, or `null` if this href is
 * not one (objectui#3603). The fragment and query are stripped — anchors are
 * out of scope here for the same reason they are for `selfRepoPath` — but the
 * path is NOT decoded: `routeExists()` does that itself, and decoding twice
 * would corrupt a legitimately escaped `%25`.
 *
 * `https://www.objectui.org` with no path at all names the site root, so it
 * resolves to `/` rather than to the empty string (which `routeExists()` reads
 * as a pure in-page anchor and waves through).
 */
export function siteAbsoluteRoute(href) {
  const match = SITE_ORIGIN_RE.exec(href.split('#')[0].split('?')[0].trim());
  if (!match) return null;
  return match[1] || '/';
}

/**
 * Does one `disk`-rule href resolve to something in this repository?
 *
 * @param {string} href
 * @param {{ fromFile: string, repoRoot: string }} context
 */
export function diskPathExists(href, { fromFile, repoRoot }) {
  const cleanHref = hrefPath(href);
  if (!cleanHref) return true; // pure in-page anchor or query

  // GitHub resolves a leading `/` against github.com, never against the repo,
  // so this shape cannot name a path here at all. See the header.
  if (cleanHref.startsWith('/')) return false;

  const target = path.resolve(path.dirname(fromFile), cleanHref);
  return isInside(repoRoot, target) && pathExists(target);
}

/** The extensionless-route spellings of `base`, as fumadocs would serve them. */
function routeCandidates(base) {
  return [`${base}.md`, `${base}.mdx`, path.join(base, 'index.md'), path.join(base, 'index.mdx')];
}

/**
 * Classifies one `apps/site/app` directory name as a URL segment.
 *
 * Next.js App Router, the four forms that matter here:
 *   `(group)`      — organisational only, contributes no URL segment
 *   `_private`     — never routable, subtree skipped
 *   `[[...slug]]`  — optional catch-all, matches 0+ segments
 *   `[...slug]`    — catch-all, matches 1+ segments
 *   `[slug]`       — dynamic, matches exactly 1 segment
 * anything else is a literal segment (`llms.txt` is a literal, dot included).
 */
function classifySegment(name) {
  if (name.startsWith('_') || name.startsWith('@')) return { kind: 'skip' };
  if (name.startsWith('(') && name.endsWith(')')) return { kind: 'group' };
  if (name.startsWith('[[...') && name.endsWith(']]')) return { kind: 'optionalCatchAll' };
  if (name.startsWith('[...') && name.endsWith(']')) return { kind: 'catchAll' };
  if (name.startsWith('[') && name.endsWith(']')) return { kind: 'dynamic' };
  return { kind: 'literal', value: name };
}

/**
 * Enumerates every URL the site can serve, as a truth source for absolute
 * hrefs: the App-Router segment tree under `<siteRoot>/app`, plus the static
 * files under `<siteRoot>/public` (Next serves those from `/`).
 *
 * Structure only — nothing here is imported or executed, so the table tracks
 * whatever the router currently is. See the header for why this script reads
 * outside `content/docs` at all.
 *
 * @returns {{ routes: object[][], assets: Set<string> }}
 */
export function collectSiteRoutes(siteRoot) {
  const routes = [];
  const assets = new Set();

  const walkApp = (dir, pattern) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && ROUTE_ENTRY_RE.test(entry.name))) {
      routes.push(pattern);
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const segment = classifySegment(entry.name);
      if (segment.kind === 'skip') continue;
      walkApp(path.join(dir, entry.name), segment.kind === 'group' ? pattern : [...pattern, segment]);
    }
  };

  const walkPublic = (dir, prefix) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walkPublic(path.join(dir, entry.name), child);
      else assets.add(child);
    }
  };

  walkApp(path.join(siteRoot, 'app'), []);
  walkPublic(path.join(siteRoot, 'public'), '');

  return { routes, assets };
}

/** Does `segments` match one route pattern? Catch-alls are terminal in Next. */
function matchesPattern(segments, pattern) {
  let index = 0;
  for (let cursor = 0; cursor < pattern.length; cursor += 1) {
    const part = pattern[cursor];
    if (part.kind === 'literal' || part.kind === 'dynamic') {
      if (index >= segments.length) return false;
      if (part.kind === 'literal' && segments[index] !== part.value) return false;
      index += 1;
      continue;
    }
    // catch-all / optional catch-all: swallows the rest, so it must be last.
    if (cursor !== pattern.length - 1) return false;
    return segments.length - index >= (part.kind === 'catchAll' ? 1 : 0);
  }
  return index === segments.length;
}

/** Is `pathname` (an absolute site path) served by a route or a static file? */
export function siteUrlExists(pathname, site) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (site.assets.has(normalized)) return true;
  const segments = normalized.split('/').filter(Boolean);
  return site.routes.some((pattern) => matchesPattern(segments, pattern));
}

/**
 * A heading line, ATX form. Setext headings (`Title` over `---`) are markdown
 * too, but this tree has none — asserted over the whole scan surface by the pin
 * test, so the day one is written the test says so rather than this gate
 * silently missing its anchor.
 */
const ATX_HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
/** A closing sequence of `#`s, which is decoration and not part of the text. */
const CLOSING_HASHES_RE = /\s+#+\s*$/;
/** fumadocs' explicit heading id: `## Heading [#custom-id]`. */
const CUSTOM_HEADING_ID_RE = /\s*\[#([^\]]+)\]\s*$/;
/** A document whose headings this gate can read. */
const MARKDOWN_FILE_RE = /\.mdx?$/i;
/** GitHub's raw-view line reference — names a line, never a heading. */
const LINE_REF_RE = /^L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/;
/** A letter or digit either side of a `*`/`_` run makes it intraword, not emphasis. */
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

/**
 * One heading's inline markdown reduced to the plain text the sluggers see —
 * fumadocs' `flattenNode()` over the mdast heading, and the text GitHub renders.
 *
 * Written by hand for the same reason `github-slug.mjs` is vendored: this file
 * may not import a parser. The pin test holds it to the real thing over every
 * heading in the repository, which is what makes hand-writing it safe.
 *
 * Code spans win over every other construct (CommonMark reads them first), and
 * their content is LITERAL — `### \`objectui add <component>\`` slugs through
 * the angle brackets, so stripping tag-shaped text inside a span would be
 * wrong. Seven headings in this tree depend on that.
 */
export function flattenInline(text) {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];

    if (char === '`') {
      let run = 0;
      while (text[index + run] === '`') run += 1;
      const marker = '`'.repeat(run);
      const close = text.indexOf(marker, index + run);
      if (close === -1) {
        out += marker; // an unclosed run is literal backticks
        index += run;
        continue;
      }
      out += text.slice(index + run, close);
      index = close + run;
      continue;
    }

    if (char === '!' && text[index + 1] === '[') {
      const image = /^!\[[^\]]*\]\([^)]*\)/.exec(text.slice(index));
      if (image) {
        index += image[0].length; // an image node carries no `value` to flatten
        continue;
      }
    }

    if (char === '[') {
      const link = /^\[([^\]]*)\]\([^)]*\)/.exec(text.slice(index));
      if (link) {
        out += flattenInline(link[1]); // a link flattens to its own text
        index += link[0].length;
        continue;
      }
    }

    if (char === '<') {
      const tag = /^<[^>]*>/.exec(text.slice(index));
      if (tag) {
        index += tag[0].length;
        continue;
      }
    }

    if (char === '*' || char === '_') {
      let run = 0;
      while (text[index + run] === char) run += 1;
      // Intraword runs are not emphasis delimiters — `NON_GRID_ROW_CEILING` and
      // `new_window` keep their underscores, and `github-slugger` keeps `_`
      // (it is connector punctuation) while dropping `*`. Getting this wrong is
      // silent: both spellings still produce A slug, just not the renderer's.
      if (WORD_CHAR_RE.test(text[index - 1] ?? '') && WORD_CHAR_RE.test(text[index + run] ?? '')) {
        out += char.repeat(run);
      }
      index += run;
      continue;
    }

    out += char;
    index += 1;
  }
  return out;
}

/**
 * Every anchor one markdown document offers, in the renderer's own spelling.
 *
 * @param {string} source     the file's raw text, frontmatter included
 * @param {{ customId?: boolean }} [options]  `customId` enables fumadocs'
 *        `[#explicit-id]` override; GitHub has no such syntax, so `disk`
 *        surfaces pass it false.
 */
export function headingAnchors(source, { customId = false } = {}) {
  const ids = new Set();
  const slugger = new GithubSlugger();
  const lines = source.split('\n');

  // YAML frontmatter is not document body, and its comments start with `#` —
  // reading it as markdown invents an h1 out of `# some comment`.
  let start = 0;
  if (/^---\s*$/.test(lines[0] ?? '')) {
    for (let index = 1; index < lines.length; index += 1) {
      if (/^(?:---|\.\.\.)\s*$/.test(lines[index])) {
        start = index + 1;
        break;
      }
    }
  }

  let fence = null;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const heading = ATX_HEADING_RE.exec(line);
    if (!heading) continue;
    const text = heading[2].replace(CLOSING_HASHES_RE, '');

    if (customId) {
      const explicit = CUSTOM_HEADING_ID_RE.exec(text);
      // An explicit id does NOT advance the slugger — fumadocs only calls it
      // when the heading has no id yet, so the duplicate counter must skip too.
      if (explicit) {
        ids.add(explicit[1]);
        continue;
      }
    }

    ids.add(slugger.slug(flattenInline(text).trim()));
  }
  return ids;
}

/**
 * The markdown document a `docs`-rule href names, or `null` when nothing in
 * this tree can answer for it.
 *
 * This is `routeExists()`'s file-producing half, factored out so the two cannot
 * drift: that function is now this one plus the site-route table.
 */
export function resolveDocsFile(href, { fromFile, docsRoot }) {
  let cleanHref = href.split('#')[0].split('?')[0].trim();
  if (!cleanHref) return fromFile; // a pure in-page anchor names THIS document
  try {
    cleanHref = decodeURI(cleanHref);
  } catch {
    /* keep the raw form — a malformed escape is checked as written */
  }

  if (cleanHref === DOCS_ROUTE_PREFIX || cleanHref.startsWith(`${DOCS_ROUTE_PREFIX}/`)) {
    const routePath = cleanHref.slice(DOCS_ROUTE_PREFIX.length).replace(/^\//, '');
    return routeCandidates(routePath ? path.join(docsRoot, routePath) : docsRoot).find(isFile) ?? null;
  }
  // An absolute non-`/docs` href is a site route; `siteUrlExists()` judges it,
  // and `apps/site/app` holds TSX rather than headings.
  if (cleanHref.startsWith('/')) return null;

  const base = path.resolve(path.dirname(fromFile), cleanHref);
  if (base !== docsRoot && !base.startsWith(docsRoot + path.sep)) return null;
  return [base, ...routeCandidates(base)].find(isFile) ?? null;
}

/** The file a `disk`-rule href names, or `null` — `diskPathExists()`'s half. */
export function resolveDiskFile(href, { fromFile, repoRoot }) {
  const cleanHref = hrefPath(href);
  if (!cleanHref) return fromFile; // a pure in-page anchor names THIS document
  if (cleanHref.startsWith('/')) return null; // github.com's root, not ours
  const target = path.resolve(path.dirname(fromFile), cleanHref);
  return isInside(repoRoot, target) && isFile(target) ? target : null;
}

/** The anchor an href asks for, decoded, or `null` when it names none. */
export function fragmentOf(href) {
  const hash = href.indexOf('#');
  if (hash === -1) return null;
  const raw = href.slice(hash + 1).trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // a malformed escape is checked as written
  }
}

/**
 * Does the anchor an href asks for exist in the document it names?
 *
 * Returns `'anchor'` when it demonstrably does not, and `null` both when it
 * does and when nothing here can decide — the two are different facts, and the
 * undecidable ones are enumerated in the header rather than left to inference.
 *
 * @param {string} href
 * @param {string | null} targetFile  the document, from one of the resolvers
 * @param {{ customId: boolean, anchorCache?: Map<string, Set<string>> }} options
 */
function judgeFragment(href, targetFile, { customId, anchorCache }) {
  const fragment = fragmentOf(href);
  if (fragment === null) return null; // no anchor asked for
  if (targetFile === null) return null; // no document here to ask
  if (!MARKDOWN_FILE_RE.test(targetFile)) return null; // no headings to read
  if (LINE_REF_RE.test(fragment)) return null; // a raw-view line, not a heading

  const key = `${customId ? 'custom' : 'plain'}|${targetFile}`;
  let anchors = anchorCache?.get(key);
  if (!anchors) {
    anchors = headingAnchors(readFileSync(targetFile, 'utf8'), { customId });
    anchorCache?.set(key, anchors);
  }
  return anchors.has(fragment) ? null : 'anchor';
}

/**
 * Resolves one href.
 *
 * @param {string} href       the raw href as authored
 * @param {{ fromFile: string, docsRoot: string, site?: { routes: object[][], assets: Set<string> } }} context
 */
export function routeExists(href, { fromFile, docsRoot, site }) {
  let cleanHref = href.split('#')[0].split('?')[0].trim();
  if (!cleanHref) return true; // pure in-page anchor or query
  try {
    cleanHref = decodeURI(cleanHref);
  } catch {
    /* keep the raw form — a malformed escape is checked as written */
  }

  // Site routes outside this docs collection — checked against the enumerated
  // router + `public/` tree (objectui#3490). No table means the caller has not
  // supplied a truth source; failing loudly beats silently waving 404s through,
  // which is precisely how the 18 links in #3490 accumulated. This is the one
  // branch `resolveDocsFile()` cannot answer, because a route is not a file.
  if (cleanHref.startsWith('/') && !(cleanHref === DOCS_ROUTE_PREFIX || cleanHref.startsWith(`${DOCS_ROUTE_PREFIX}/`))) {
    if (!site) {
      throw new Error(
        `routeExists() needs a site route table to judge the absolute href "${href}". ` +
          'Pass `site: collectSiteRoutes(<repo>/apps/site)`.',
      );
    }
    return siteUrlExists(cleanHref, site);
  }

  // Everything else resolves to a FILE, and `resolveDocsFile()` is the single
  // implementation of which one (objectui#7644): route form only under `/docs`,
  // no leaving the collection, file spelling before the extensionless route
  // spellings. It has to exist for the anchor check, and two copies of that
  // ladder is how a gate starts disagreeing with itself.
  return resolveDocsFile(href, { fromFile, docsRoot }) !== null;
}

/** Which of the four checks rejected this href — drives the hint printed below. */
function classifyBroken(href, { fromFile, docsRoot }) {
  const cleanHref = href.split('#')[0].split('?')[0].trim();
  if (cleanHref === DOCS_ROUTE_PREFIX || cleanHref.startsWith(`${DOCS_ROUTE_PREFIX}/`)) return 'docs-route';
  if (cleanHref.startsWith('/')) return 'site-route';
  const base = path.resolve(path.dirname(fromFile), cleanHref);
  if (base !== docsRoot && !base.startsWith(docsRoot + path.sep)) return 'escapes-collection';
  return 'relative';
}

/** Which `disk`-rule check rejected this href — drives the hint printed below. */
function classifyBrokenDisk(href) {
  return hrefPath(href).startsWith('/') ? 'example-absolute' : 'example-relative';
}

/**
 * Judges one href under one scan root's rule.
 *
 * @returns {string | null} the failing check's name, or `null` when it resolves
 */
function judgeHref(href, context) {
  // The two external-LOOKING shapes this script can actually decide run FIRST,
  // and in every rule: both must be reached before the by-scheme skip below
  // waves them through (objectui#3536, objectui#3603).
  //
  // Each branch answers the SAME two questions in order (objectui#7644): does
  // the document resolve, and — only once it does — does the anchor inside it.
  // The `customId` each passes is the renderer the READER lands in, which is
  // not always the rule the linking file was scanned under: a github.com blob
  // URL is read on GitHub even when it was written inside `content/docs`, and
  // an `objectui.org/docs/...` URL is read in fumadocs even when it was written
  // in a package README.
  const selfPath = selfRepoPath(href);
  if (selfPath !== null) {
    const target = path.resolve(context.repoRoot, selfPath);
    if (!isInside(context.repoRoot, target) || !pathExists(target)) return 'self-repo-url';
    return judgeFragment(href, target, { ...context, customId: false });
  }
  // A URL on this site is an internal route wearing an origin. Strip the origin
  // and judge what is left with the same `routeExists()` every absolute href
  // goes through — so `/docs` strictness and the `apps/site` route table apply
  // here too, on every surface, `content/docs` included.
  const siteRoute = siteAbsoluteRoute(href);
  if (siteRoute !== null) {
    if (!routeExists(siteRoute, context)) return 'site-absolute-url';
    // `href` keeps the fragment the origin-stripped route dropped, and
    // `fragmentOf()` reads only what follows the `#`, so the raw href is the
    // right thing to hand on here.
    return judgeFragment(href, resolveDocsFile(siteRoute, context), { ...context, customId: true });
  }
  if (EXTERNAL_HREF_RE.test(href)) {
    // The one shape this regex catches that names a document we hold: a pure
    // in-page anchor, whose document is the file it was written in.
    if (!href.startsWith('#')) return null;
    return judgeFragment(href, context.fromFile, { ...context, customId: context.rule === 'docs' });
  }

  if (context.rule === 'disk') {
    if (!diskPathExists(href, context)) return classifyBrokenDisk(href);
    return judgeFragment(href, resolveDiskFile(href, context), { ...context, customId: false });
  }
  if (!routeExists(href, context)) return classifyBroken(href, context);
  return judgeFragment(href, resolveDocsFile(href, context), { ...context, customId: true });
}

/**
 * Scans every surface in `SCAN_ROOTS`, each under its own rule.
 *
 * Takes the repo root — not a docs root — so a caller cannot configure away a
 * scan surface or the `apps/site` truth source and get a green that only means
 * "nothing was looked at". `SCAN_ROOTS` is the single list of what is checked.
 *
 * @param {string} repoRoot  the repository to scan
 * @returns {{ file: string, href: string, line: number, reason: string }[]}
 */
export function collectBrokenLinks(repoRoot) {
  const broken = [];
  const docsRoot = path.join(repoRoot, 'content', 'docs');
  const site = collectSiteRoutes(path.join(repoRoot, 'apps', 'site'));
  // One anchor set per (document, renderer) per scan, not per href: the
  // `**Related:**` lines this card came from point many links at one page.
  // Scoped to this call rather than the module, so a caller scanning two
  // trees (the pin tests do) can never read the other one's headings.
  const anchorCache = new Map();

  for (const scanRoot of SCAN_ROOTS) {
    const exclude = scanRoot.exclude ? new Set(scanRoot.exclude) : undefined;
    const collect = scanRoot.collect ? new Set(scanRoot.collect) : undefined;
    for (const file of collectFiles(path.join(repoRoot, scanRoot.path), exclude, collect)) {
      const source = stripCode(readFileSync(file, 'utf8'));
      MARKDOWN_LINK_RE.lastIndex = 0;
      let match;

      while ((match = MARKDOWN_LINK_RE.exec(source)) !== null) {
        const href = match[1].trim();
        const reason = judgeHref(href, { fromFile: file, docsRoot, repoRoot, site, anchorCache, rule: scanRoot.rule });
        if (reason === null) continue;

        broken.push({ file, href, line: source.slice(0, match.index).split('\n').length, reason });
      }
    }
  }

  return broken;
}

// Run only when invoked directly — the test suite imports the helpers above and
// must not trigger a repo scan (or a `process.exit`) on import. Same guard shape
// as scripts/check-control-bytes.mjs.
const invokedDirectly = isEntrypoint(import.meta.url);

const HINTS = {
  relative:
    'Relative links must name the target FILE including its real extension' +
    ' (`../plugins/plugin-charts.mdx`) — that is the key fumadocs indexes pages by.',
  'docs-route':
    'Absolute `/docs/...` links must be extensionless ROUTES' +
    ' (`/docs/plugins/plugin-charts`); a `.md`/`.mdx` suffix 404s whatever is on disk.',
  'site-route':
    'Absolute non-`/docs` links must resolve to a real site URL — a route under' +
    ' `apps/site/app` or a file under `apps/site/public`. There is no `/spec`,' +
    ' `/protocol`, `/api/<pkg>` or `/examples` route: link the equivalent' +
    ' `/docs/...` page, or an absolute `https://github.com/...` URL.',
  'escapes-collection':
    'A relative link may not leave `content/docs` — fumadocs can only resolve' +
    ' hrefs inside the docs page index, so it reaches the browser verbatim and' +
    ' 404s even though the file exists. Use an absolute' +
    ' `https://github.com/objectstack-ai/objectui/blob/main/...` URL instead' +
    ' (the "Package README" form used throughout content/docs/plugins/).',
  'example-relative':
    'Outside content/docs (examples/**, docs/**, each package and app README,' +
    ' and the root-level markdown files) a relative link is a' +
    ' PATH IN THIS REPO, resolved by GitHub against the linking file — so it' +
    ' must name something that exists and lives inside the repository. A' +
    ' directory or a non-markdown file is fine; an extensionless spelling of a' +
    ' `.md` file is not, since GitHub serves files, not routes.',
  'example-absolute':
    'Outside content/docs a leading `/` is NOT the root of this repository —' +
    ' GitHub resolves it against github.com, so `/packages/core` links to' +
    ' https://github.com/packages/core. Write the repo path relative to the' +
    ' file (`./packages/core`), or, if a github.com URL really was meant,' +
    ' write it in full with the scheme.',
  'site-absolute-url':
    'A `https://www.objectui.org/...` URL is a route on this project OWN site,' +
    ' so the origin is stripped and the rest is checked exactly like the' +
    ' equivalent absolute href — this one does not resolve. Fix the route, or' +
    ' drop the link if no such page exists. Inside content/docs prefer the' +
    ' origin-less form (`/docs/guide/plugins`): it survives a domain change,' +
    ' and both spellings are checked identically.',
  anchor:
    'The link resolves to the right DOCUMENT but names an `#anchor` that document' +
    ' does not have. Heading anchors are derived exactly as the renderer derives' +
    ' them (`scripts/github-slug.mjs`), so the usual cause is a heading that was' +
    ' RENAMED without its cross-references — the failure objectui#7644 added this' +
    ' check for. Fix the fragment to the heading\'s current slug, or restore the' +
    ' heading. Inside content/docs an explicit `## Heading [#stable-id]` pins an' +
    ' anchor so a future rename cannot break it.',
  'self-repo-url':
    'A `https://github.com/objectstack-ai/objectui/(blob|tree)/main/...` URL' +
    ' points into this repository, so its path is checked against the working' +
    ' tree — this one is not there. Fix the path, or link the equivalent' +
    ' `/docs/...` page. (Only `main` and only this repo are checked; other' +
    ' refs and other repos cannot be resolved offline.)',
};

if (invokedDirectly) {
  // Derived from this file's own location, not the cwd: a cwd-relative root
  // would make running the script from a subdirectory scan nothing and report
  // success — a false green is the one failure mode this gate must not have.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const broken = collectBrokenLinks(repoRoot);

  if (broken.length > 0) {
    const targets = new Set(broken.map((item) => `${path.dirname(item.file)}|${item.href.split('#')[0]}`));
    console.error(
      `Found ${broken.length} broken link${broken.length === 1 ? '' : 's'} (${targets.size} distinct target${targets.size === 1 ? '' : 's'}):`,
    );
    for (const item of broken) {
      console.error(`- [${item.reason}] ${path.relative(process.cwd(), item.file)}:${item.line} -> ${item.href}`);
    }
    for (const reason of Object.keys(HINTS)) {
      if (broken.some((item) => item.reason === reason)) console.error(`\n${reason}: ${HINTS[reason]}`);
    }
    console.error('\nSee the header of scripts/check-doc-links.mjs.');
    process.exit(1);
  }

  console.log(`Links are valid across ${SCAN_ROOTS.length} scan roots.`);
}
