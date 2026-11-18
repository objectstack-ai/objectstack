---
name: objectstack-project
description: >
  Run an ObjectStack metadata-app project: decide whether a change belongs in
  the app or the platform, what to write before building, what the app tests
  and what the platform already checks, how a change is described for
  customers, released and upgraded. Use when starting a feature or fix, filing
  an issue, writing a test, opening a PR, releasing, or bumping
  `@objectstack/*`. Not for writing metadata (the domain skills) or crossing a
  protocol major (objectstack-upgrade).
license: Apache-2.0
compatibility: Requires @objectstack/cli 18.x and @objectstack/verify 18.x; the check lists below are that version's.
metadata:
  author: objectstack-ai
  version: "18.6.0"
  domain: process
  tags: project, process, testing, verify, release, changeset, upgrade, backfill, platform-gap
---

# Running an ObjectStack metadata-app project

The domain skills teach how to write metadata. This one teaches how a change
moves through the project.

## 0 · Two questions before any work

**1. App or platform?** Could someone who has only the metadata, and knows
nothing of this business, have written the change?

| Answer | Where it goes |
|:--|:--|
| No: it encodes this business's judgement (a discount ceiling, who approves what, how a case is routed) | the app |
| Yes: it only asks whether the metadata is consistent (references resolve, labels are translated, a write round-trips) | the platform: check the table in §2 before writing anything |
| Platform behaviour is missing or wrong, and the app pays for it | the platform, and a **gap** until it ships (§3) |

**2. Own use or product?** Ask the owner once: is the app used by its own team,
or installed and upgraded by customers? Record the answer as one line in the
project's `AGENTS.md` (`Project kind: own use` or `Project kind: product`) and
read it from there afterwards. Steps marked ★ apply only to a product.

Default to own use, and keep it light: a one-person app changing a label needs
the edit, the four checks (§2) and a commit. ⛔ Do not ask it for a requirement
record, a design note or a changeset.
Building through MCP with no repository: only §0 and §3 apply.

## 1 · What to write at each stage

| Stage | Own use | ★ Product adds |
|:--|:--|:--|
| Requirement | Feature: who asked, their words, one acceptance sentence ("A user can …"), on the issue. Bug: steps, expected, actual. | A file in `docs/requirements/` for a feature customers will see (template below) |
| Design | On the issue. A short note only when the change spans two packages or adds an object; it covers the checklist below | The note always answers "installed data" and "upgrade steps" |
| Issue | One issue, one PR | |
| Build | Change `src/` only. A Studio change stays in that environment's database and never ships (the project's `AGENTS.md`) | |
| Test | §2 | |
| Acceptance | The PR says which path was walked and as which user; the locale or device when it matters | |
| User docs | The same PR updates the docs a user reads (package docs: objectstack-ui) | |
| Release | | A changeset written for the customer (§4) |
| Upgrade | §5 | The release note lists the customer's steps |

Design checklist: objects and fields touched · who may read and edit them ·
which automation fires · which screens change · translations ·
★ what happens to data already installed · ★ the steps an upgrading customer takes.

★ Requirement template, created the first time one is needed:
```markdown
# REQ-NNNN <title>
- Asked by: <who> · Their words: "<quote>"
- A user can: <one acceptance sentence>
- Out of scope: <what this does not do>
- Status: proposed | accepted | shipped in <version>
```

## 2 · Testing: what the app pins, what the platform checks

The platform checks consistency. The app tests its own business facts. Run all
four before calling a change done; a scaffolded project's CI runs them too:

```bash
pnpm validate && pnpm lint && pnpm typecheck && pnpm test
```

What the platform checks at 18.x, so the app never hand-writes it:

| Tool | Checks |
|:--|:--|
| `os validate` (the same rules `os build` runs) | Protocol schema; CEL expressions and their `record.<field>` paths; references between metadata (fields, objects, views, actions, picklists, capabilities, approvers); dashboard widget bindings and dataset members; view, form and page shape; flow trigger readiness and undeclared flow cycles; sharing and row-level security enforceability; seed rows against state machines; package docs; a provider for every required capability |
| `os lint` | The shared author-time rules again, plus its own: naming and label style, hook bodies that stop lowering to metadata-only bodies, and translation coverage (a missing non-source locale is an error only with `--i18n-strict`) |
| `os verify` | Boots the app and writes over REST: every field type round-trips. `--rls`: a user who cannot read a record cannot write it. Also opt-in: `--reference-shapes`, `--delete-behaviors`, `--unique-scopes`, `--parent-write-reach`, `--dashboard-windows`, `--multi-tenant` |
| `pnpm typecheck` | Types against `@objectstack/spec` |

⛔ `os verify` is not one of the four and not in the scaffold's CI. Nothing in
its row is checked until someone runs it: `npx os verify --rls` before a
release, or as a CI step.
The installed version's own list wins over this table: `npx os explain` lists
the author-time rules it can explain, and `npx os explain <rule-id>` explains one.

What the app tests, with `bootStack` from `@objectstack/verify` on the real
engine (the scaffold's `note.test.ts` is the shape): the numbers in its rules,
who approves which amount, what a flow writes, what an action does, and which
role sees which records **as this business intends** (`--rls` proves
consistency, not intent).

```ts
const stack = await bootStack(config);   // the default export of objectstack.config.ts
const admin = await stack.signIn();      // the seeded admin; signUp(email) is a plain member
await expect(
  stack.hooks.run('crm_quote', 'insert', { name: 'Q-1', discount: 0.35 }, { as: admin }),
).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
await stack.stop();
```

The handle also has `stack.flows.run`, `stack.actions.run`, `stack.seed` and
`stack.rows` (read as a user); the README in `node_modules/@objectstack/verify`
documents each. A plugin's own tests use `LiteKernel` (objectstack-platform).

⛔ Do not hand-write a check the table lists, such as "every reference
resolves" or "every view names real fields". Asked to write one, run the
command that already checks it and show its output instead.

A consistency check the table does **not** list is a platform gap (§3). Until it
ships, the app may carry the test, marked `// PLATFORM-GAP: <issue link>`. When
the platform rule lands, retire it: inject the same defect, confirm the platform
command fails on it, then replace the test with a one-line
`// RETIRED: <rule id>, checked by os lint` (or validate, or verify).

## 3 · Platform gaps

- ⛔ Never work around a platform defect in the app: no duplicate route, no hook
  that patches the engine's answer, no hand-rolled permission check, no
  metadata reshaped to dodge a bug. A workaround outlives the fix.
- File it at `objectstack-ai/objectstack`: the platform version, the smallest
  metadata that shows it, expected and actual.
- Mark the app's issue blocked (a `blocked` label and a `Blocked by: <link>`
  line) and keep its priority. If a stale bot runs, exempt that label.
- It unblocks when the fix is in a version the app can install, not when the
  upstream PR merges: `npm view @objectstack/<package> version`, then its `CHANGELOG.md`.
- Relief for customers before the fix ships: the owner decides, on the issue.

## 4 · ★ Describing a change for customers

- Set up changesets once (`pnpm add -D @changesets/cli && pnpm changeset init`);
  every PR that changes what ships adds one (`pnpm changeset`).
- Write it for the customer's administrator: what they can do now, in their
  words. No issue numbers, no internal names.
- A breaking change (a field, object, view, permission or behaviour removed,
  renamed or changed in meaning) is `major` and states: FROM → TO, the minimum
  `@objectstack/*` version, and the administrator's steps in order, a backfill
  (§5) first.
- To release: `pnpm changeset version` writes `CHANGELOG.md`, the notes
  customers read, and bumps `package.json`. Set `manifest.version` in
  `objectstack.config.ts` to match by hand: `os package publish` ships that
  one. Then `os build` and `os package publish` (objectstack-platform).

## 5 · Bumping the platform, and customer data on upgrade

Bump:
1. Move every `@objectstack/*` package to one version together, `@objectstack/skills`
   included, then re-sync the skills and commit them:
   `npx skills@1.7.2 experimental_sync --agent claude-code --copy -y` (name your
   own runtime after `--agent`).
2. Read each package's `CHANGELOG.md` between the two versions for breaking
   entries. Crossing a protocol major: objectstack-upgrade.
3. Run the four checks. A new rule that reports existing metadata is fixed in
   the metadata, ⛔ never silenced.
4. Sweep the blocked issues (unblock each whose fix is now installed) and the
   `PLATFORM-GAP` tests (retire each one the platform now checks, §2).

Data already installed:
- Added objects, fields and indexes apply on boot. A rename carries
  `renamedFrom`. A type change, a drop or a relaxed `NOT NULL` goes through
  `os migrate plan` then `os migrate apply` (`--allow-destructive` for a drop).
  Detail: objectstack-data, "Schema evolution".
- Removing a field or object, or changing what its value means, puts the old
  values out of reach once the new metadata is installed. Copy them first with
  a backfill script in `scripts/`:
  - run it against each deployment while it is still on the old release;
  - REST API only, no import from `src/`, so it works on any installed metadata;
  - report by default, write only with `--apply`;
  - touch only the rows that need it; a second run reports zero;
  - sign in as an administrator named on the command line.
- ★ The release note names the script and when to run it.

## 6 · Where each kind of change is taught

| Change | Skill |
|:--|:--|
| Objects, fields, validations, hooks, permissions, seed data | objectstack-data |
| Queries, filters, aggregation | objectstack-query |
| Views, apps, dashboards, reports, actions, pages, package docs | objectstack-ui |
| Flows, triggers, approvals, jobs, webhooks | objectstack-automation |
| Agents, tools, knowledge, the MCP server | objectstack-ai |
| CEL formulas and predicates | objectstack-formula |
| Translations | objectstack-i18n |
| REST endpoints, auth, realtime | objectstack-api |
| Project setup, plugins and their tests, the CLI, deployment | objectstack-platform |
| Crossing a protocol major | objectstack-upgrade |
| Answering a question from the app's records | objectstack-ask |
| Rendering the metadata in React | objectui |
