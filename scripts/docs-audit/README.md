# Docs accuracy verification

Keeps the **hand-written** docs (`content/docs/**` minus `content/docs/references/**`)
in sync with the actual implementation in `packages/**` as the platform evolves.
Generated references (`content/docs/references/`) are produced from `packages/spec`
and are out of scope here — regenerate those separately.

The system has four parts, layered cheapest-and-earliest first:

## 1. `affected-docs.mjs` — change → docs mapping (the linchpin)

Maps a set of `packages/**` changes to the hand-written docs that **name something the
change touched**, so an audit can be scoped to what actually changed.

```bash
# docs affected by changes on this branch vs origin/main
node scripts/docs-audit/affected-docs.mjs origin/main

# JSON (with changed packages + per-doc "why")
node scripts/docs-audit/affected-docs.mjs --json origin/main

# every hand-written doc (full audit scope)
node scripts/docs-audit/affected-docs.mjs --all

# pin the classifiers, package-root and anchor derivations (needs no repo state; CI runs this before the mapping)
node scripts/docs-audit/affected-docs.mjs --self-test

# how much of the DECLARED client-bound route surface the `sdk` bridge can reach (diff-free)
node scripts/docs-audit/affected-docs.mjs --bridge-coverage
node scripts/docs-audit/affected-docs.mjs --bridge-coverage --json   # + the unreachable rows themselves, each with WHY and its witness
```

**Derivation (#9192): a doc is *affected* when it NAMES something the change touched.**
Not when it mentions the changed package — that predicate is a dependency-graph proxy
answering a semantic question, and it was measured wrong in *both* directions on PR #9191
(three read verbs in `@objectstack/metadata-protocol`): 3 pages listed of which 1 was
relevant, while the 2 pages that actually document the changed surface —
`api/client-sdk.mdx` and `kernel/contracts/metadata-service.mdx` — were absent, because
they document it through the **SDK** surface, which does not depend on the implementing
package at all.

Over-inclusion is not free, and that is the correction. A wrong-both-ways advisory trains
its reader to skip it, and then it fails on the PR where it is right — the same bill
exclusion 1 below already paid. The derivation is therefore **precision-first**: a shorter
right list beats a longer noisy one.

Three anchor kinds, each exact:

| anchor | what it is | how it is derived |
|:--|:--|:--|
| `symbol` | a documentable declaration the diff touched | the top-level declaration, or a member of a top-level **container** (class / interface / type / enum / schema object), enclosing each changed line — on **both** sides of the diff, so a removed export still anchors the pages naming it |
| `route` | a wire path the change touched | a path literal on a changed line, plus every route whose **registrar handler** references a changed symbol |
| `sdk` | the client method bound to an anchor route | the declared `route` ⟷ `client` rows in the repo's route ledgers |

The `route` and `sdk` hops are what carry the derivation across the surface boundary the
package graph cannot cross: `auditMetaItem` (changed) → `GET /api/v1/meta/:type/:name/audit`
(`rest-server.ts` registrar) → `meta.getAudit` (`rest-route-ledger.ts`) → the token
`api/client-sdk.mdx` actually contains.

**A local variable is not documentable surface.** That one rule is what drops the measured
false positive: `const singular = request.type;` inside a method body is not an anchor, so
`kernel/services-checklist.mdx` — whose only `singular` is a service *slot name* — is no
longer listed. A `const` object **is** a container (its keys are metadata property names,
which docs do name); a function body is not.

### Two guards, and both publish what they removed

The first build of this derivation was, on some PRs, *noisier* than the proxy it replaced
(134 rows where the old tool gave 26). Two guards fixed that, and both run **before** the
route bridge — a name left in the set does not merely add a noisy row, it mints noisy route
and SDK anchors from every registrar handler that mentions it:

1. **Shape** — an anchor must be code-shaped (camelCase / PascalCase / snake_case /
   dotted). `label`, `object`, `start`, `locale` and `sections` all arrived as real
   declarations and matched 82, 113, 43, 13 and 10 of 178 pages; confining them to code
   spans does not help, because those words live in code spans too. Reported as
   `weakAnchorsDropped`. The recall cost is a genuinely lowercase export (`parse`, `mask`).
2. **Corpus share** — an anchor matching more than 15% of the corpus is a hub term, not an
   identifier. `ObjectQL` is code-shaped, genuinely changed, and named by 59 of 178 pages;
   it cannot tell an author which page to re-read. Reported as `overbroadAnchors`, with the
   count that condemned it.

Plus a cap on the route bridge itself: a symbol wired into more than 3 routes is a
cross-cutting helper, and "which routes mention this name" then answers *every* route.
Reported as `crossCuttingSymbols`. `SCREAMING_SNAKE` constants are kept out of the bridge
entirely — a data table is consulted by handlers, it is not their implementation.

### The `sdk` bridge reaches part of its own population, and says which part (#9572)

The `sdk` hop needs a registrar `path:` tail to select a route-ledger row. Measured on
`9ff11921a`: **45 of the 221 client-bound ledger rows are reachable, 176 are not.** An
unreachable row is not "unlisted this time" — no symbol change bridges to it, ever.

That number now travels with the answer. `bridgeCoverage` is emitted on every run whose
change carried a bridgeable symbol (`{ measured: false, reason }` when it did not — never a
fabricated zero), the drift comment renders it in *What this run could not see*, and
`--bridge-coverage` answers it with no diff at all.

Two things it deliberately is **not**:

- **Not a verdict.** The ratio is reported. Failing CI on it would widen the recognizer
  under CI pressure, which the #9747 family declines explicitly. What *does* exit non-zero
  is `brokenScan` — no ledger found, no tail produced, a ledger file matching the
  convention that the row recognizer parses to zero rows, or a **partial read** (next
  section). Those cannot fire on a tree where the scan works at all, and each of them
  otherwise reports `0 of 0 unreachable`, which is arithmetically true and reads exactly
  like a healthy bridge.
- **Not a fix for the 176.** The causes are unrelated to each other and each needs its own
  before/after measurement per #9432's standard. They are no longer estimated: the run
  splits them (next section).

Half the blind spot is load-bearing: **88 of the 176** unreachable rows name a client
method that at least one hand-written page carries (31 distinct pages, `api/client-sdk.mdx`
among them), so the silence is not an empty region.

### Why a row is unreachable is measured, not one column (#11178)

`56 of 56` and `46 of 87` used to print in the same words, and they are not the same
finding. Every unreachable row is now attributed against a **ceiling** — every `path:` any
`packages/**` file declares, with `REGISTRAR_FILE_RE` ignored entirely, built by
`maximalTailsFrom` from the same `parseRegistrarSource` over the same walk. Measured on
`589758d22`, the 177 unreachable rows partition as:

| cause | rows | what it means |
| --- | --- | --- |
| `discovery-gap` | 14 | an in-repo file declares this exact path; the filename convention did not scan that file. The JSON **names the witness**. |
| `no-in-repo-registrar` | 56 | on a ledger where **not one** row is declared in-repo — declared upstream and catch-all-mounted. No discovery change reaches it. |
| `undecided` | 107 | no in-repo declaration for the row, on a ledger that *has* in-repo registrars. Absence and an unreadable spelling are not distinguishable here, so neither is claimed. |

Exactly **one** of the seven ledgers is `no-in-repo-registrar` today: `auth-route-ledger.ts`,
whose own header has said so since #3656 — better-auth declares those routes inside
`node_modules` and the plugin mounts them with a single ``rawApp.all(`${basePath}/*`)``,
which `routeTailOf` cannot and should not turn into a tail. That is why widening
`REGISTRAR_FILE_RE` to admit `auth-plugin.ts` was measured to move `registrar files
scanned` 12 → 13 and **nothing else**.

⛔ **This changes no discovery and moves no reach.** `REGISTRAR_FILE_RE` is byte-identical,
the bridge still rides on `registrarByTail` alone, and `reachable` is 45 before and after —
pinned in `--self-test`. The ceiling only explains the number; it never participates in it,
and because it is a superset by construction a ceiling that misses a *reachable* row is a
`brokenScan` verdict rather than a quieter result.

The classification is **derived, never listed**. Control on `589758d22`: adding one
in-repo file that declares one auth route — under a filename the convention does not match
— moves the auth ledger out of `no-in-repo-registrar` on its own (structural 56 → 0,
`reachable` still 45), and removing it restores 56.

### A PARTIAL ledger read is a verdict too (#9896)

The row recognizer reads **single-quoted** values only, and the `rowsParsed === 0` guard
above is the all-or-nothing case. The likelier shape is a ledger that parses *almost*
completely — and it used to render exactly like a complete one. Measured on `a718ee3dd` by
respelling **one** row of `i18n-route-ledger.ts`:

| ledger written as | client-bound rows | verdict | exit |
| --- | --- | --- | --- |
| all single-quoted (today, all 7 ledgers) | 221 | none | 0 |
| one row backtick-quoted `route:` | **220** | none *(now: `PARTIAL read … 2 of 3`)* | 0 → **1** |
| one row backtick-quoted `client:` | **220** | none *(now: `PARTIAL read … 2 of 3 client`)* | 0 → **1** |
| one `route:` backtick-quoted in `rest-route-ledger.ts` | **221** ⚠️ | none *(now: `PARTIAL read … 95 of 96`)* | 0 → **1** |

The last row is why the verdict keys on the **declined spelling** and not on a shortfall:
the row window is delimited by the same single-quote-only lead, so a declined row does not
close the *previous* row's window and the row before it **inherits the declined row's
client**. Backtick-quoting `GET /api/v1/meta` moved `meta.getTypes` onto the server-only
`GET /api/v1/docs` while `clientRows` stayed 221 — a count comparison is blind to it.

A template literal is the realistic spelling: the formatter rewrites double quotes back to
single, but leaves `` route: `${base}/locales` `` alone, and that is the natural shape the
moment anyone interpolates a base path into a row.

So both halves of the fraction now print on every run — `ledger rows read … 259 of 259
declared` — and a declined declaration is a `brokenScan` verdict that **names the entry**
(`line 96: route: \`GET /api/v1/i18n/locales\``). The recognizer itself is untouched: this
reports its narrowness, it does not widen it, and `--self-test` pins the population at its
old value so a silent widening fails there.

**Values in no quote at all are counted too.** A `route:` / `client:` whose value is not a
string literal (`route: ROUTES.health`, `route: BASE + '/x'`) is read by neither the
recognizer (which needs a leading `'`) nor the declined-spelling counter (which needs a
leading `"` or backtick). Such a row used to leave the population with **no verdict at all** —
not read, not declined, absent from the denominator. It is now reported as unread, so the
row ends up in a verdict either way.

The `route: string;` member each ledger's own entry interface declares is **not** a row, and
is excluded on a structural discriminator rather than on the quote: a type member sits inside
an `interface`/`type` declaration and a table row never does. Comments and string payloads
are masked out for the same reason — `runtime/src/route-ledger.ts` contains the English
sentence *"It never named a mounted route: the branch"*. Both exclusions are pinned in
`--self-test` in both directions; removing the type-declaration one turns all seven of
today's accurate ledgers red (`259 of 266`), which is why a bare "count every `route:`"
check was never an option.

**The row recognizer reads through both of those exclusions too** — comments and string
payloads since #10683, type declarations since #10793. Before each, the recognizer read a
source the rest of the file had already ruled out, and a lead it should not have read did
not merely mis-count: it became a **row**. Both were silent for the same reason — `rows`
and the first term of `routesDeclared` moved together, so the partial-read verdict, which
keys on the gap between them, had no gap to see. The type-declaration case is the one a
quote test cannot catch on its own: a literal-union member (`route: 'GET /a' | 'GET /b'`)
opens with the very quote the recognizer reads. Both moves were priced on a tree carrying
no instance of the shape, and `259 of 259` / `221 of 221` / 176 unreachable came out
byte-identical across each.

**And the key itself is anchored** — since #11542, in one place rather than eight. Eight
scans ask *"is a `route:` / `client:` declaration written here?"*; `declLead` has spelled the
colon and the run after it once since #11494, but the **key** stayed each call site's own
argument and only one of the eight anchored it with `\b`. So `subroute: 'GET /api/v1/gone'`
was a declaration to **seven** of them and not to the eighth, and it minted a phantom
**row** — silent for the same reason as the two above, `rows` and the first term of
`routesDeclared` moving together. Not all seven behaviours it moved are counting: the row
window is delimited by that same lead, so a `subroute:` written between a real `route:` and
its `client:` **closed the real row's window** and handed the binding to the phantom, which
then joined the unreachable population — a wrong binding no count comparison can see. Priced
on a tree carrying no instance: **zero** leads across the seven ledgers that the unanchored
spelling reads and the anchored one does not, and `269 of 269` / `222 of 222` / 45 reachable /
177 unreachable came out byte-identical **row for row** across the change. `$route:` is still
read as a declaration — `\b` fails only against a *word* character — but all eight agree on it
now, and `--self-test` pins that residue (#11630) where the next card will find it.

A skipped type member is reported **nowhere**, and that is the intended answer rather than
a new silence: it is a correct declaration of a *type*, not a table row — the same rule
under which the `route: string;` member of all seven entry interfaces has always produced
nothing. What the prose case gets instead is `prose-quoted leads`, because a lead sitting
where the mask says code is not is a would-be row and worth naming.

### What it cannot see is reported, never implied

`anchorlessChanges` lists changed files that yielded no anchor at all; a non-empty value
means the list is incomplete **by a known amount**, and an empty `docs` beside it must
never be read as "no page documents this change". The superseded coarse set is still
computed and emitted as `packageMentionDocs`, labelled — an audit that deliberately wants
the wide net can still ask for it, and keeping it visible is how a reader tells a *narrow*
list from a *blind* one. The PR comment renders all of this in a collapsed section — and,
since #11357, renders the anchorless count in the **headline** as well, because a limit a
reader has to expand a fold to find is one a reader does not find. The failure #9192
records was never the tool lying; it was the tool never signalling its own limits at the
point of use.

Since #11356 the same posture reaches the ✅ itself — see **The verdict when nothing names
the anchors** below.

### Measured, before and after

Ten real PRs, each re-derived at its own merge base with its own docs corpus. `docs` rows:

| PR / commit | old (package-mention) | new (anchor) |
|:--|--:|--:|
| #9191 — the three metadata read verbs (the filing card's specimen) | 4 | **3** |
| `0668f02a6` fix(rest): closed `ErrorCode` union on the error responder | 26 | 14 |
| `75b7c240a` feat(spec): `master_detail` + `controlled_by_parent` | 113 | 32 |
| `07ad42463` fix(cli): `os meta resync` skip-count explanation | 22 | **0** |
| `7a537ce90` feat(spec): strict top-level stack keys | 113 | 13 |
| `445ae4deb` fix(auth): auth emails follow the deployment locale | 13 | 3 |
| `30b1c636a` feat(spec): register 9 REST wire codes | 113 | 4 |
| `650cd3daa` fix(objectql): delete-cascade registry reads | 14 | **0** |
| `3851f87f0` feat(spec,plugin-security): partial field masking | 116 | 19 |
| `d5156b965` refactor(metadata-protocol): drop dead `objects` tolerances | 4 | 4 |

The #9191 row reads 4 where the filing card says "the bot listed three pages": `docs` is
the full set and the comment partitions `content/docs/releases/v9.mdx` into its own
read-only section (#6893), so 3 editable rows + 1 release-owned row = 4.

On #9191 the change is qualitative, not just smaller: all three previously-listed pages
are gone and the two pages the filing card measured as *missing* are back, each with the
anchor that put it there (`getAudit`/`getReferences` for `client-sdk.mdx`, `getHistory`
for `metadata-service.mdx`).

The two zeroes are the honest shape of the trade, not a bug: `07ad42463` derives
`MetaResync` and `resyncSkipExplanationLine`, and no hand-written page names either, so the
run says so and points at the coarse set — where the old tool's 22 rows were every page
mentioning `@objectstack/cli`. A CLI **command name** (`os meta resync`) is exactly the
recall class the shape guard costs us: it is a lowercase word, so it cannot anchor.

### The verdict when nothing names the anchors

That state — anchors derived, nothing left unanchored, no page naming any of them — used
to end the headline in a ✅. It no longer does (#11356). The sentence reports the **naming
relation**, and the relation only ever lists a page that ALREADY names a changed token, so
a PR that **widens an enumerable vocabulary** is invisible to it by construction: the new
members' absence from the page is precisely the defect, and an absence names nothing.

Measured on #11347 — six new flow-expression functions (`round`/`floor`/`ceil`/`abs`/
`min`/`max`) — the run derived 9 anchors, matched 0 pages, and rendered the ✅, while
`content/docs/automation/flows.mdx` carried a table enumerating the available bindings
that the same PR had just made incomplete. A reviewing seat almost passed the PR on that
tick.

⚠️ **The narrowing does not catch that class.** Nothing in the anchor model can: anchoring
the new members is impossible by construction, the siblings live in carriers the diff
never touches, and the container symbol is named by no page. The authoring-mark route
that would catch it is escalated as #11817. What the narrowing changes is that the run no
longer **claims** it did — the verdict states only what it measured, and the clean-bill
glyph is left to a run that earned one. The rendering is pinned in both directions by
`check-drift-comment.mjs`, which asserts the verdict byte-exact on that state and asserts
it ABSENT on all four neighbouring states.

How often it renders, re-derived over the 40 first-parent commits ending at `e43b18fd9`:
3 of the 17 package-touching runs (18%) — `20a452e664`, `f213793ddb`, `dd4113ec0b` — so it
is a rare notice rather than a per-PR banner, which is what keeps it readable.

**Cost** (the card's open question): the anchor derivation reads the same 178-page corpus
the old one did, plus the 18 route-registrar/ledger sources (~875 KB) and one `git show`
per changed file per side. Measured end-to-end on the ten PRs above, `node affected-docs.mjs`
went from 85-195 ms to 114-582 ms. The heaviest case is the widest diff; every case stays
well under a second, against a job that already spends seconds checking out the repo and
setting up Node. It is the right default for every PR.

**How a changed file maps to its package:** the package root is the **deepest ancestor
directory with a `package.json`**, resolved from the filesystem — never a hand-kept
list of container directories. (The mapper once special-cased only
`packages/plugins/*`; the 30 packages nested under the other six containers collapsed
into `packages/services` et al., whose missing `package.json` disabled the npm-name
matching arm entirely, so a doc naming `@objectstack/service-automation` but not the
repo path was a guaranteed miss — #4162.) A deleted package falls back to the coarse
`packages/<x>` token, which still substring-matches any doc naming the deleted path.

**Three exclusions:** change classes that cannot make an implementation-accuracy doc
stale are dropped before the changed-package roots are derived:

1. **Test files** (`*.test.*` / `*.spec.*` at any depth, plus `__tests__` /
   `__mocks__` / `__fixtures__`): a test observes behaviour rather than defining it —
   yet counting them made every tests-only PR light up its packages' whole doc set, a
   class of finding that is always false. That is the one place over-inclusion actively
   hurt: a comment a reader learns to skip stops working on the PR where it is right.
2. **Package tooling scripts** (`<packageRoot>/scripts/**`): build/verification
   tooling, not the runtime behaviour docs describe (#4183 flagged 106 docs for a diff
   whose only code change was a new check script). Narrow on purpose: `src/scripts/**`
   is runtime code and stays counted. No package publishes runtime code from `scripts/`
   (checked against every `files` allowlist; three plugins ship a lone
   `i18n-extract.config.ts` only for lack of a `files` field).
3. **Dev-only manifest edits** (#6893): a `<packageRoot>/package.json` whose changed
   **top-level keys** are all in `{scripts, devDependencies}`. This is the only
   **field-level** exclusion — `package.json` as a file stays counted, because
   `exports` / `main` / `dependencies` / `files` / `version` changes ARE implementation.

   It is the residue of exclusion 2: #4183 dropped the check *script* but kept the
   `package.json` line registering it, so the same PR still lit up the same doc set
   through the manifest. Measured over 400 merged commits, five had a `package.json` as
   their only `packages/**` implementation change, and **all five** touched nothing but
   those two keys — 152 doc-rows in total, none of which could be stale:

   | commit | keys changed | docs flagged |
   |:--|:--|--:|
   | `df0605ba5` | `scripts` | 12 |
   | `2672f855f` | `scripts` | **113** — #6893's headline number |
   | `a64315556` | `devDependencies` | 10 |
   | `77d9001c7` | `devDependencies` | 13 |
   | `466bd9285` | `devDependencies` | 4 |

   The last three are `test(...)` commits: exactly the class exclusion 1 exists to kill,
   leaking through the manifest instead. The allowlist is an allowlist on purpose — an
   unknown or newly-invented key falls on the **counted** side — and unparseable, added
   or deleted manifests are counted too.

   **Why it cannot narrow the net:** the classifier is per *file*. A PR that also touches
   that package's `src/**` derives the package root from those files anyway, so this arm
   only ever decides the case where the manifest is the package's sole change. Verified
   both directions on the real diffs (#6893): adding an `exports` entry to
   `packages/spec/package.json` still flags 113 docs, and a `scripts` entry *alongside* a
   `src/` edit also still flags 113 — with the manifest itself reported as skipped.

The excluded counts are reported in the summary line and as `testFilesSkipped` /
`scriptFilesSkipped` / `devOnlyManifestsSkipped` in `--json`, so the narrowing is never
silent. `--self-test` pins the classifiers, the package-root derivation *and* the anchor
derivation against inputs that must and must not match (`commands/test.ts` is implementation;
`foo.conformance.test.ts` is not; a container directory must never come out as a package
root; `dependencies` is never dev-only).

**And one deliberate non-exclusion:** `packages/*/CHANGELOG.md` stays counted, even though
release notes define behaviour no more than a test does. Extending the exclusion there
looks like the obvious next step and is a provable no-op, for two independent reasons:

1. The only PR class that mass-touches those files is `chore: version packages`, and it
   runs **no GitHub Actions at all** — `changesets/action` opens it with the repo's
   `GITHUB_TOKEN`, and GitHub does not trigger workflow runs from `GITHUB_TOKEN`-authored
   events. Measured on #3910: one check run, from Vercel's own app. So this gate never
   sees a release PR to be noisy on. (The bump is still verified — `ci.yml` and `lint.yml`
   both run on `push: main`, and `release.yml` gates publish on a green build.)
2. Even if it did run, `changeset version` writes `package.json` next to every
   `CHANGELOG.md` it appends to — 45 of the former against 46 of the latter on the first
   page of #3910's diff — so dropping the CHANGELOGs would leave the derived package-root
   set bit-identical. Exclusion 3 does **not** undercut this: what `changeset version`
   rewrites is `version` (and workspace `dependencies` ranges), neither of which is in
   the dev-only allowlist, so those manifests stay counted.

A hand-edited CHANGELOG outside a release is also close to nonexistent in practice. Left
counted, and recorded here so the idea is not rediscovered as a gap.

## 1b. `check-audit-scope.mjs` — the audit workflow's scope, derived not hand-kept

```bash
node scripts/docs-audit/check-audit-scope.mjs           # verify (also: pnpm check:docs-audit-scope)
node scripts/docs-audit/check-audit-scope.mjs --write   # regenerate the list from the filesystem
node scripts/docs-audit/check-audit-scope.mjs --self-test
```

The `docs-accuracy-audit` workflow (part 3) carries its default scope **inline**, as
`ALL_HANDWRITTEN`. It has to: a workflow script runs inside a `node:vm` context whose
only globals are `log`/`phase`/`console`/`budget`/timers plus
`agent`/`parallel`/`pipeline`/`workflow`/`args`, with code generation disabled — no
`require`, no `import`, no filesystem. It can neither walk `content/docs/` nor read a
JSON artifact, so the list cannot be derived *at run time*.

It is therefore derived at *generation* time instead: `--write` rewrites the block from
`affected-docs.mjs --all` (one definition of "hand-written doc", not two), and the plain
run is a CI gate in `lint.yml` that fails when the block and `content/docs/` disagree
**in either direction**.

Both directions matter, and only one had ever been noticed (#4851):

- **listed but missing** — the 10 `content/docs/protocol/objectos/**` paths left behind
  by the rename to `protocol/kernel/`, plus 6 others. An audit agent pointed at a
  non-existent file reads nothing and reports `fixCount: 0`, which in the run summary is
  indistinguishable from a doc that was checked and found accurate. That is how the
  accuracy defects in #4781 and #4817 sat in `protocol/kernel/` for ~2 months while full
  audits reported green.
- **exists but unlisted** — 48 docs, including all of `protocol/kernel/**` and the whole
  `capabilities/` directory. A run logging `FULL audit (no args.docs given)` was
  auditing 130 of 178 docs.

The workflow additionally preflights its resolved scope — including a caller-supplied
`args.docs`, which no CI gate can see — and aborts naming any path that does not exist;
and each audit agent reports `docExists` from the read path itself, so a preflight that
was wrong cannot be laundered into a green summary. The gate covers the default list,
the preflight covers the caller's list, and the read path checks both.

### Release-owned pages are in scope, and read-only (#4920)

The derived scope contains `content/docs/releases/**` (9 pages), and AGENTS.md's
Documentation Guardrails forbid a code PR from editing those pages at all. Since the
audit's deliverable is an in-place mdx rewrite, a full audit used to walk straight into
that prohibition — and open exactly the PR the guardrail exists to stop.

They are **not** excluded. Excluding them would leave some of the most-read pages in the
docs permanently unaudited, and would put a second definition of "docs this workflow
covers" next to the generated block — #4851 is the bill for one subject with two
hand-kept lists. Instead the **deliverable** forks, on a path prefix (`content/docs/
releases/`, which is the guardrail's own path column, decidable inside the workflow VM):

| | editable docs | release-owned pages |
|:--|:--|:--|
| prompt | audit + **fix in place** | review, **never edit** |
| output schema | `fixesApplied` / `fixCount` | `findings[]` + `filesEdited` |
| adversarial verifier | yes — re-checks applied edits | n/a, nothing was applied |
| deliverable | the diff | findings → **file as issues** |

Each finding carries `kind` (`never-true` / `no-longer-true` / `ambiguous` — a release
page is a historical record, so "the current API differs" is not automatically an
error), where on the page it is, what it should say instead, and `file:line` evidence.
The run summary reports them under `releaseOwnedReadOnly` and logs
`releases (read-only): N finding(s) — file issues, do not edit`.

Three failure modes are made loud rather than silent, because "audited nothing" and
"audited, found nothing" must never look alike:

- a release page whose review returns **no result** fails the run by name — that is the
  exclusion option arrived at by accident;
- a review agent reporting `filesEdited: true` fails the run naming the file to revert;
- the read-only headline is logged whenever release pages are in scope, **including at
  zero findings** (reviewed-and-clean is a result, absence is not).

`pnpm check:docs-audit-scope` enforces the whole contract: AGENTS.md must still mark
that exact path RELEASE-OWNED, the workflow's `RELEASE_OWNED_PREFIX` must still match
that row, the scope must still contain release pages, and the fork must still work —
checked by **running** the workflow against stub agents and inspecting which prompt and
schema each doc gets, not by grepping for a keyword. `--self-test` then mutates the fork
out of an in-memory copy and requires that check to go red.

## 2. CI gate — `.github/workflows/docs-drift-check.yml`

On any PR that touches `packages/**`, runs `affected-docs.mjs` against the base branch
and posts/updates a single advisory PR comment listing the docs that name something the
change touched — each row carrying **the anchor that put it there**, so a wrong row is
reportable rather than merely annoying. **Never fails the build** — it only flags drift at
the source, before it lands on `main`. Reviewers (or an on-demand audit run) decide whether
to re-verify.

The comment also carries a collapsed **"What this run could not see"** section:
anchorless files, cross-cutting symbols, over-broad anchors, the coarse package-mention
count, and the `sdk` bridge's reach over the client-bound ledger rows (#9572). That is
the point-of-use half of #9192 — every one of the three derived-list failures in that
shift was caught only because a dev widened the probe past what the tool offered, never
because the tool signalled its own limits where it was read.

### The headline says what the run did not cover (#11357)

A README carries no `@docs-rule` block, exports no symbol, mounts no route and declares
no SDK method, so a README-only diff derives **nothing** — and the comment answered it
with *"this run has no opinion about the docs"*, which a reviewer reads as *"nothing to
check"*. The file it could not anchor **was** named, honestly, in the collapsed section
above; GitHub renders that section shut. Two real README defects landed inside that gap
on one day: #11180 (`packages/cli/README.md` advertising `os studio`, a command the CLI
does not ship) and #11262 (`packages/console/README.md` asserting a `@object-ui/console`
fallback the code no longer performs). Neither was detectable by this check on any run.

So whenever `anchorlessChanges` is non-empty the headline itself now names the count and
the files, says those pages are **not covered by this run**, and **withholds the ✅** —
a green tick is the clean-bill glyph and a partial look is not a clean bill. Anchor
derivation is untouched: with nothing unanchored, every headline is byte-identical to
what it was, and no run's verdict moves either way (this check never fails a build).

⚠️ This is #9282's **option 4**, not its option 3. Falling back to the coarse
package-mention set for an anchorless file was measured 0-for-3 on recall on its own
specimen (see [§1](#1-affected-docsmjs--change--docs-mapping-the-linchpin)), and would
regrow the ~106–112-row lists #6893 / #7009 measured and readers learned to skip.
Reporting the gap costs nothing and hides nothing; buying coverage with noise does both.

`check-drift-comment.mjs` pins it **in both directions** — a fixture diff touching only a
README must produce the not-covered wording, and one touching an anchorable source file
must not. It runs the workflow's own inline `github-script` block against real
`affected-docs.mjs` output from throwaway git repos, because a source grep passes just as
happily on text that never renders and on text that renders unconditionally, and neither
is a report. Zero dependencies, like the mapper: this job never runs `pnpm install`.

### The comment forks release-owned pages into a read-only section (#6893)

Same ruling as [1b](#release-owned-pages-are-in-scope-and-read-only-4920), one level
down. The comment used to list `content/docs/releases/v17.mdx` in the same bulleted list
as editable pages — so a reader treating the advisory as a worklist was being pointed at
the one edit AGENTS.md forbids outright. The specimen that made it concrete: PR #6921
changed two diagnostic strings in `packages/lint` and got back three rows, one of them
that release page.

They are **not filtered out**. `docs` in `--json` stays the full set (it is what scopes
the audit, and #4920 rejected excluding these pages for good reasons); `releaseOwnedDocs`
is a **partition** of it — `releaseOwnedDocs ⊆ docs`, always — and the comment renders it
under its own ⛔ heading telling the reader to file an issue instead of editing.

`affected-docs.mjs` therefore holds a third literal copy of `RELEASE_OWNED_PREFIX`,
alongside AGENTS.md's guardrail row and the audit workflow's own const. Copies, because
the workflow is evaluated in a sandbox VM that cannot import and a shared module would
leave *it* the only unanchored one. `check-audit-scope.mjs` iterates
`RELEASE_OWNED_CONSUMERS` and fails if any copy stops matching the guardrail row — **add
a consumer, add it to that list.**

## 3. `docs-accuracy-audit` workflow — the LLM audit

A Claude Code multi-agent workflow (`.claude/workflows/docs-accuracy-audit.js`). For each
doc: an agent reads it, locates the real implementation, and applies evidence-backed
fixes in place; a second **adversarial verifier** re-checks every fix against the code and
repairs over-corrections. Scope it with `args.docs`; omit for a full audit.

```js
// scoped to the docs a code change touched:
Workflow({ name: 'docs-accuracy-audit', args: { docs: [/* output of affected-docs.mjs */] } })
// full audit of all hand-written docs:
Workflow({ name: 'docs-accuracy-audit' })
```

It edits files in place (frontmatter preserved, no moves) and returns a per-doc log of
fixes, verifier repairs, and residual items that couldn't be confirmed against code —
**except** for `content/docs/releases/**`, which is reviewed read-only and returns
findings to file as issues (see [1b](#release-owned-pages-are-in-scope-and-read-only-4920)).
Always follow a run with the docs build gate:

```bash
pnpm --filter @objectstack/docs build   # must compile all pages clean
```

## 4. Scheduled routine — periodic backstop ⛔ NOT RUNNING

**Measured 2026-08-18: no live schedule runs this audit.** This section previously
described the backstop in the present tense; it does not exist, so **it cannot be cited
as coverage for what the part-1 scope leaves out.** Recorded rather than fixed on the
spot: standing up a periodic LLM audit spends real budget on a cadence, which is the
maintainer's call.

The intended design, for whoever stands it up: a cron routine on a cadence (default
monthly / per-release) catches drift the CI gate missed — it runs the
`docs-accuracy-audit` workflow, runs the build, and opens a PR when there are fixes.

**Two independent defects in the old text, both worth keeping in view:**

1. **It never ran.** Checked four ways, all negative — repeat these rather than
   re-deriving them:

   - **GitHub Actions** — no workflow runs this audit at all. Of the 31 workflows
     registered on the repo, the 10 carrying a `schedule:` trigger (`codeql`,
     `coverage-nightly`, `engine-split-metric`, `prerelease-pin-watch`, `publish-smoke`,
     `rerun-safety-nightly`, `scaffold-e2e`, `showcase-smoke`, `stale`, `validate-deps`)
     are all unrelated. Derive that list with `grep -rl '^\s*schedule:' .github/workflows/`
     rather than copying it: an unanchored grep for `schedule:` also matches `cut-rc.yml`,
     whose only hit is a comment saying it deliberately has no schedule.
     ⚠️ **Read the registered workflow list and its run history, not the YAML on disk.**
     The two disagree in *both* directions: a workflow can be registered in Actions with
     no file on `main` (`matrix-aggregate-experiment.yml` is, today), and a scheduled
     workflow that GitHub auto-disabled after 60 days of repo inactivity leaves its file
     byte-identical. "The file is there" cannot answer "is it running" — the same
     read-a-conclusion-off-a-field-that-cannot-carry-it failure this docs-audit subsystem
     keeps paying for.
   - **Routines** — the Claude Code Remote `list_triggers` tool lists every Routine the
     agent-seat account owns, and this is the surface that answers the question (it was
     once written off as unreadable by any agent; it is not). The only cron Routine is the
     hourly triage seat, `18 * * * *`. There is no docs-audit Routine, enabled *or*
     disabled. A cron Routine is never hidden by the `include_completed` filter, so the
     absence is real rather than a listing artifact.
   - **The creation mechanism this section named is gone** — there is no `schedule` skill
     in `.claude/skills/`.
   - **No trace of a periodic run.** Repo history holds exactly three docs-accuracy audit
     PRs (#3243, #4219, #4312), every one hand-initiated against a named issue family, the
     most recent 2026-07-31. Nothing on a cadence.

2. **A change-scoped run is not a backstop.** The old text had the routine compute "the
   change-scoped doc list since the last audit", while the cost note below calls part 4 the
   "periodic **full** backstop". Those are two different runs and only the second is a
   backstop — a change-scoped list is derived by the very anchor heuristic whose misses
   the backstop exists to catch, so scoping it that way re-inherits the blind spot it is
   meant to cover. A backstop has to run `--all`: all 178 hand-written docs (run
   `check-audit-scope.mjs` for today's number rather than trusting this one).

3. **And the obvious cheap substitute is not a backstop either.** When the backstop is
   missing, the tempting one-line fix is to widen the audit's scope back to the coarse
   `packageMentionDocs` set part 1 still emits. Measured across the 8 most recent
   `packages/**`-touching commits on `main`: it is wider (21 pages vs 5 on `a4331227b`)
   but it is **not a superset** — in every one of the 8, between 3 and 7 pages present in
   the precise `docs` set are absent from `packageMentionDocs`
   (`api/error-catalog.mdx`, `automation/approvals.mdx`, `api/plugin-endpoints.mdx`,
   `data-modeling/relationships.mdx` among them). That is #9192's finding restated: the
   two sets miss in *different* directions, because the coarse one is a dependency-graph
   proxy and pages documenting a change through the SDK surface never name the
   implementing package. Swapping to it trades one incomplete set for another and loses
   pages the precise scope gets right. Only `--all` is a backstop.

---

**Cost note:** a full audit is ~2 agents per doc — measured at ~2.8M output tokens /
~160 agents when the scope was 128 docs, and the hand-written set is 178 today (run
`check-audit-scope.mjs` for the current number; don't trust a count written down here).
Always prefer the change-scoped list (`affected-docs.mjs`) over `--all`; reach for `--all`
only for a deliberate full audit. (This sentence used to name the periodic full backstop as
the exception — see part 4: that backstop is not running.)
