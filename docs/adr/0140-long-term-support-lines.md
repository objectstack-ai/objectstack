# ADR-0140: Long-term support lines — v18 is the first LTS line, `latest` follows the supported line, breaking changes batch into quarterly majors

**Status**: Proposed (2026-10-24). `docs/adr/**` is Tier H (Prime Directive #14): this record becomes **Accepted**
on the maintainer's approval of the pull request that carries it, and the execution cards under
[Execution plan](#execution-plan-after-acceptance) are cut after acceptance and ⛔ never before it. **This record
declares; it implements nothing.**
**Decided by**: the maintainer, in session on 2026-10-24, verbatim and untranslated:
「接受 18.x 作为 LTS 并放慢破坏性变更」. Two further rulings from the same session fix the market and the team the
decision is sized for: 「我希望开源项目和云端面向全球开发者,落地的企业版客户在中国」 and
「人类团队规模,平台2个开发,企业版落地项目有5个项目经理」.
**Builds on**: [ADR-0059](./0059-third-party-backward-compatibility-gates.md) (a breaking change cannot leave this
repository silently), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (conversion over notification; the
replayable migration chain a major must carry), [ADR-0125](./0125-release-approval-gate-replaces-the-typed-version.md)
(the human act that authorises a release), [ADR-0130](./0130-release-artifact-as-co-ownership-boundary.md) (the
artifact the apps ship against this platform), AGENTS.md Prime Directive #15 (a release is performed by the
maintainer, by hand), the maintainer's 2026-10-21 grading ruling recorded on the releases overview page
([#25105](https://github.com/objectstack-ai/objectstack/issues/25105): the level follows the metadata protocol).
**Supersedes**: the 「阶段姿态」 paragraph of `docs/NORTH-STAR.md` as it stood before this record — 「速度优先于兼容。用的人少」
— which is amended in the same pull request. Nothing else. The #25105 grading rule is **kept** on `main` (D5).
**Consumers**: `.github/workflows/release.yml` and `cut-rc.yml`, the changeset gates under `scripts/`,
`create-objectstack`, `@objectstack/skills`, `content/docs/releases/`, the sibling `objectui` (the console pin), the
apps that ship against this platform (`hotcrm`, `hotclm`, `hotsrm`, `templates`), and ObjectOS Cloud and Enterprise,
whose commercial support terms are the cloud half of this decision (see [Provenance](#provenance)).

---

## TL;DR

Nine months after the first public release the platform has shipped seventeen majors, and since 18.0.0 a
**patch** may carry a breaking change to anything that is not the metadata protocol. That posture was right while
nobody depended on a released version. It is wrong now: enterprise customers run the platform under contract, the
reference app pins an exact version because a caret range is not safe, and a marketplace cannot form on a line that
moves under it.

**Decision:** one **LTS line** at a time, v18 first, cut as `release/18.x` at the release that is `latest` on the day
of acceptance. The LTS line takes **fixes only** — security, data integrity, regressions, docs — never a new key, a
rename or a refactor, and npm's `latest` points at it for as long as it is supported. `main` keeps its speed, but
everything it publishes goes to `next`; its breaking changes reach `latest` **only as a major, at most once a
quarter**, and only when the ADR-0087 chain carries every one of them. Backports are mechanical (a label, a bot-opened
cherry-pick), so two platform developers can run the line, and a project manager has a formal door to ask for one.

## Context

### Measured velocity, and who now stands under it

- Release history, read from the releases overview and the GitHub release list: `1.2.0` on 2026-02-09, `18.0.0` on
  2026-10-20, `18.1.0` on 2026-10-24 — seventeen majors in nine months.
- The 2026-10-21 grading ruling (#25105) keeps the no-major guard and grades a changeset by what it does to the
  metadata protocol: `added` / `narrowed` / `semantic` take `minor`, everything else `patch`, breaking or not.
  18.1.0 was the first release cut under it: a minor carrying 90 changesets declared breaking, 42 of them `patch`.
- `hotcrm` pins every `@objectstack/*` dependency to the exact version `18.0.0`, and #25539 made the scaffolder do
  the same for every new project — the right call under the current posture, and the symptom this record treats:
  an exact pin is how a consumer protects itself from a line that breaks on patch, and it also means no consumer
  receives a security fix without a deliberate pin bump.
- #25556 recorded the cost of lockstep without a stable line: a published-type change landed on framework `main`
  ahead of objectui's adaptation and left the two `main`s uncompilable together.
- The posture itself is written down: `docs/NORTH-STAR.md` 「阶段姿态」 — 「速度优先于兼容。用的人少:退役立即生效,无过渡窗口、无别名双拼;
  兼容层、迁移窗口一类的工作默认 p3」.

### What changed

The maintainer's rulings of 2026-10-24 (header): there are paying enterprise deployments in China, with more in
negotiation; the open-source framework and the cloud are aimed at developers worldwide; the human team is two platform
developers and five project managers. 「用的人少」 no longer holds, and the five-to-two ratio says demand for stability
will outrun the hands available to deliver it by hand. Any support policy this team can keep has to be run by the
fleet, with the humans deciding and approving, not cherry-picking.

### Why not simply slow `main` down

The fleet's velocity is the company's engineering asset; a policy that halves it to protect customers trades the
future for the present. The shape that keeps both is the one every long-lived platform converged on: a fast trunk
whose output is clearly marked as such, and a slow supported line that customers and partners stand on.

## Decision

### D1 — Lines: one LTS line at a time, v18 first

- At most **two** lines exist at any moment: `main` and one **LTS** line. ⛔ Never a third ("current") line;
  two platform developers cannot keep three honest.
- **v18 is the first LTS line.** The branch `release/18.x` is cut from the commit that published the release
  `latest` names on the day this record is accepted (`@objectstack/cli@18.1.0`, commit `e649c2d` on 2026-10-24,
  unless a later 18.x patch has shipped from `main` by then — the cut takes the newest).
- **Support window**: the LTS line receives fixes for **twelve months from its GA** (18.0.0 GA was 2026-10-20, so
  until **2027-10-20**), or **three months after the next LTS line's GA**, whichever is **later**. The next LTS line
  is named by an amendment to this record no later than three months before the window closes (D9).

### D2 — What lands on the LTS line: fixes only, by a closed list

A changeset lands on `release/18.x` only when **all** of the following hold:

1. Its declarations read `Clause-②: no` and `Metadata-protocol: none` — no key, value or metadata type is added,
   narrowed or given a new meaning, and no third-party-facing surface widens or narrows.
2. It is one of: a **security** fix; a **data-integrity** fix (a write that did not persist, a filter that answered
   the wrong rows, a permission that admitted what it should refuse); a **regression** fix (behaviour that worked on
   an earlier release of the same line); a **documentation or skills** correction (`content/docs/**`, `skills/**`,
   `README.md`); a **dependency** bump for a published security advisory; a **console pin** bump to a commit on
   objectui's own `release/18.x` line (D7).
3. It is a **backport of a change already on `main`** (D3) — the one exception is a fix to code that no longer
   exists on `main`, which is authored on the LTS branch and says so in its changeset.

⛔ Never on the LTS line: a new feature, an `added` key however small, a rename, a "move-only" refactor slice, a
retirement, a dependency major, a changed default, a new environment variable. These wait for the next major.

**The one named exception.** A security or data-integrity fix that must **narrow** to fail closed (the shape
`fix(plugin-auth)!: fail closed on a missing auth secret outside development` took on `main`) lands on the LTS line
with its changeset carrying one extra line-initial marker, `LTS-exception: security` or
`LTS-exception: data-integrity`, and the patch's release note **leads** with it and its remedy. The gate (D3) admits a
`Clause-②: yes (narrowing)` on `release/*` only under that marker; a widening is never an exception.

### D3 — Mechanism: main-first, then a labelled backport the fleet opens

- Every fix is authored, reviewed and landed on **`main` first**. The pull request carries the label **`backport:18.x`**
  when D2 applies; the seat that files the card or lands the PR applies it, and a reviewer may add it.
- On merge to `main`, a workflow opens the **cherry-pick pull request** against `release/18.x` as the fleet App,
  carrying the original changeset and body. It runs the same required set as any PR (`Lint & Repo Gates`,
  `TypeScript Type Check`, `Test Core`, `Build Core`, `Governed Surface Queue Guard`) plus one new required gate,
  **`LTS Changeset Gate`**, which reads every changeset the PR adds and refuses one that violates D2 — by its two
  declaration lines, and by the `LTS-exception` marker for the narrowing case.
- A cherry-pick that conflicts is resolved **by the owning lane, on that PR**, never by a push to the branch.
  ⛔ Never a direct push to `release/*`; branch protection requires the PR and the required set, as on `main`.
- A **project manager's door**: a card labelled **`lts:request`** names the customer-facing defect, the 18.x release it
  reproduces on, and the impact. Triage judges it **by D2 alone** — never by the size of the customer — and, when it
  qualifies, applies `backport:18.x` to the fix that resolves it. A request D2 refuses is answered on the card with
  the major that will carry it.

### D4 — Publishing: the LTS line owns `latest`; `main` publishes to `next`

- `release/18.x` publishes **patch** releases `18.x.y` through the same two-lane `release.yml` ADR-0125 describes:
  a standing Version Packages PR per branch, the push that lands it queues the deployment, the maintainer approves
  the `release` environment. Prime Directive #15 is untouched: no seat releases.
- Each LTS publish sets npm dist-tags **`latest`** and **`lts-18`** on every package in the fixed group.
- Immediately after the cut, `main` enters changesets **pre mode** with the tag `next` for the next major; every
  release cut from `main` is `19.0.0-next.N` on npm's `next` tag — the mechanics the 17.x → 18 transition already
  exercised. ⛔ `latest` never points at a `main` head while an LTS line is in support.
- The `rc` channel and `cut-rc.yml` keep their role for `main`; the LTS branch has no `rc` — a patch is cut or it
  is not.

### D5 — Cadence: breaking changes reach `latest` only as a major, at most quarterly

- A **major GA** from `main` happens **at most once per calendar quarter**, on a date the maintainer sets; the first
  candidate is **19.0.0 in the first week of 2027-01**.
- A major is cut only when the **ADR-0087 chain is complete** for every breaking changeset since the previous GA:
  each one has its disposition marker, a D2 conversion or a D3 migration step where its disposition requires one,
  and `check:upgrade-guide` projects clean. The migration chain is the deliverable that opens the quarter's GA;
  without it the major waits for the next quarter.
- Between GAs, **no breaking change reaches `latest`** — D4 makes this structural rather than disciplinary.
- The #25105 grading rule **stands on `main`** unchanged: protocol kind → `minor`, everything else → `patch`; in pre
  mode both surface as `next.N`, and the recorded kind is what the GA's notes and the chain are compiled from.

### D6 — Consumers start on the LTS line

- `npm create objectstack@latest` therefore scaffolds against the LTS line; `@next` is the opt-in for the trunk, and
  the scaffolder's banner says which line it is installing and why.
- Exact pins (#25539) **stay**. A new LTS patch is a pin bump an agent applies through the upgrade path ADR-0087
  provides; the skills bundle says so in one sentence.
- The apps this organisation ships against the platform — `hotcrm`, `hotclm`, `hotsrm`, the `templates` — target the
  LTS line on their `main`; a branch that tracks `next` is the exception, named in the app's README.

### D7 — objectui mirrors the line; the console pin on the LTS branch moves only along it

- objectui cuts its own `release/18.x` at the commit the framework's `.objectui-sha` names at the cut
  (`2958f17e9c6a` as of this writing) and takes D2/D3 verbatim as its own policy record.
- On `release/18.x` the console pin moves **only** to a commit on objectui's `release/18.x`; `cut-rc.yml`'s
  "the pin is an input, never a decision" ruling is unchanged, and the full battery's `Console Pin Gate` on the LTS
  branch builds objectui at that pin against the LTS head.
- A console fix an enterprise customer needs is backported in objectui first, then the pin bump is backported here
  (D2 item 2, last clause).

### D8 — What the commercial side may promise

ObjectOS Cloud and ObjectOS Enterprise run the **LTS line** and promise customers **that line and its window** (D1) —
never `main`, never a feature date. The promise text, the support SLA and what an enterprise contract adds on top are
the cloud half of this decision and live in `objectstack-ai/cloud` (Provenance). This record fixes the mechanism the
promise rests on; it does not price it.

### D9 — End of life

- Three months before the window closes, an amendment to this record names the next LTS line (the then-current GA
  major), and the overlap begins: both lines take D2 fixes until the old window closes.
- At EOL the `lts-18` dist-tag stays on npm and the branch is kept read-only; nothing further is published from it;
  `latest` has already moved to the new LTS line at its GA.

## Consequences

- **For enterprise customers and partners**: a line to pin to that receives security and data-integrity fixes
  without a rename arriving with them; one upgrade conversation a year, with a migration chain the agent replays.
- **For developers worldwide**: `latest` is stable and `next` is where the platform's speed is visible; the trade is
  that new capabilities reach `latest` quarterly, not weekly. The docs and the scaffolder say so plainly.
- **For the fleet**: `main`'s rules and speed are unchanged. The new work is mechanical and bot-operated: a label, a
  cherry-pick PR, one gate. The humans decide (D3 triage, D4 approval) and nothing else.
- **For the two platform developers**: the ceiling is one LTS line (D1); a request for a second is answered by this
  record, not by a weekend.
- **For the five project managers**: `lts:request` is the door, D2 is the answer, and the quarter's major is where a
  refused request lands — a predictable "when", which is what a customer conversation needs.
- **What it costs**: a `release/18.x` publish lane, one gate, one workflow, the pre-mode entry on `main`, a docs
  pass, and the discipline of a quarterly GA date. Every item is on the execution plan.
- **What it does not do**: it does not slow `main`, does not certify anything, and does not change what an exact
  pin means; the `rc` channel and the version-PR lane keep their roles.

## Alternatives considered

- **Node-style: `latest` follows the current (trunk) line, LTS gets its own tag.** Rejected: under #25105 a
  `patch` on `main` may be breaking, so `latest` would keep breaking exactly the consumers this record protects, and
  `npm create` would scaffold against it by default.
- **Three lines — LTS, current and `main`.** Rejected for the team size recorded in the header; the overlap in D9 is
  the only time two supported lines coexist, and it is bounded.
- **Feature backports to the LTS line** ("just this one `added` key"). Rejected: an `added` key is a protocol change,
  the apps and skills pinned to the line would have to re-validate, and the line stops being a line.
- **No LTS; rely on exact pins plus the ADR-0087 chain.** Insufficient: a pin never receives a security fix, and the
  chain moves a consumer forward across breaking majors — it does not give it a place to stand still.
- **Slow `main` to fixes-only.** Rejected (Context): it spends the fleet's velocity, which is the asset, to buy a
  stability the LTS line buys for the price of a label.

## Execution plan (after acceptance)

Cards are cut after acceptance, each one PR, in this order; items 1 and 5 are the maintainer's own acts.

1. **Cut `release/18.x`** at the commit D1 names; branch protection: PR-only, the required set, no force-push.
2. **`release.yml` and `cut-rc.yml`**: `push: branches: [main, 'release/**']`; a Version Packages PR per branch;
   dist-tag logic (`latest` + `lts-18` from `release/18.x`, `next` from `main`); the `release` environment gate
   unchanged (ADR-0125).
3. **`LTS Changeset Gate`** (`scripts/check-lts-changeset.mjs`, `--self-test` per AGENTS.md): on a PR whose base is
   `release/*`, every added changeset satisfies D2 or carries a D2 `LTS-exception` marker; added to the required set
   for `release/*` bases.
4. **Backport workflow**: `backport:18.x` on a merged `main` PR opens the cherry-pick PR as the fleet App, through
   `scripts/pm/` and the shared write gate; conflict → the PR is opened anyway with the conflict named in its body.
5. **Pre mode on `main`**: `changeset pre enter next` for 19, in a release-adjacent PR; the no-major guard stands
   aside in pre mode as it did for 18, and D5 is the condition for leaving it.
6. **Labels**: `backport:18.x` and `lts:request`, with the `lts:request` card template naming the fields D3 lists.
7. **Docs**: the "Versioning policy" section of `content/docs/releases/index.mdx` and a **Support policy** page under
   `content/docs/releases/` (the window, the two tags, what a patch may carry, how to ask for a backport); one line
   in `README.md` and `LICENSING.md`; the skills bundle's upgrade sentence (D6).
8. **Scaffolder banner** (D6) and a smoke test that `create-objectstack@latest` resolves the LTS line.
9. **objectui**: its own policy record, the `release/18.x` cut, and the pin-direction check for the LTS branch (D7).
10. **cloud**: the commercial record D8 points to — the support terms the LTS line lets Enterprise promise.

## Provenance

The mechanism half of this decision — lines, gates, tags, cadence — governs open code and lives here. The commercial
half — what ObjectOS Cloud and Enterprise promise on top of the window, and at what price — is a cloud decision; the
cloud record is to be cut as execution item 10 and will carry a one-line pointer back to this one. Until it exists,
D8 is the whole of what this repository says about the promise.
