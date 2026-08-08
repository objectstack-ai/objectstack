---
'@objectstack/spec': patch
---

docs(spec): correct two published claims about the #4610 Notification retirement, and forward-note the stale `areas` caveat in the shipped rc.2 changelog (#5781, #5809)

**What changes is what the repo SAYS, not what it does.** No schema byte, no
export, no conversion and no baseline moves; `@objectstack/spec/ui` still does
not publish `Notification(Schema)` / `NotificationConfig(Schema)` and
`@objectstack/spec/system` still does not publish `NotificationConfig(Schema)`.
Two of the three corrections are to live contract prose, one is a forward-note
on a shipped changelog section, and one unconsumed changeset (a v17 GA release
input) is corrected at the source.

**1. "zero importers in all three repos" was false for objectui (#5781).** #4610
justified removing the two `./ui` notification wrappers with a three-repo,
import-statement-level consumer scan. objectui#3310 measured the same names at
17.0.0-rc.1 and found both alive: `packages/types/src/index.ts` re-exported them
with `export … from '@objectstack/spec/ui'`, and
`packages/core/src/protocols/NotificationProtocol.ts` consumed them through the
`@object-ui/types` barrel, in the public signatures of `resolveNotificationConfig`
/ `specNotificationToToast`. The scan matched `import … from` statement text and
could see neither hop.

⛔ **The retirement is not reopened.** objectui does not ask for it back: the
`@object-ui/core` bridge had zero in-repo callers, the implementation that runs
is `@object-ui/react`'s locally-declared `NotificationSystemConfig`, and objectui
deleted the bridge to FOLLOW the retirement rather than re-declare vocabulary the
spec had just dropped. Only the sentence that justified the removal changes.

**2. The FROM → TO would have sent an author to code that does not compile
(#5781).** #4610 published `from '@objectstack/spec/ui'` → `from
'@objectstack/spec/api'` for `Notification(Schema)`. `./api`'s `Notification` is
the REST inbox row (`id` / `type` / `title` / `body` / `read` / `data` /
`actionUrl` / `createdAt`); the removed `./ui` shape was a toast instance
(`message` / `severity` / `position` / `duration` / `dismissible` / `actions` +
ARIA). They share zero fields — same name, a different contract, which is the
dual-source trap #4610 closed rather than a new home for the old shape. The
guidance is now **no replacement**: keep `./ui`'s presentation enums and declare
the instance shape locally, as objectui does. Counted honestly while rewriting
it: **three** enums survive (`NotificationType` / `NotificationSeverity` /
`NotificationPosition`), not the four #4610 listed — #5015 retired
`NotificationAction` at 17.0.0-rc.3.

**3. The methodology, written down beside the tombstone.** A cross-repo liveness
verdict must be read off the RESOLVED SYMBOL GRAPH, covering at minimum
`export … from` re-exports and consumption that reaches the spec indirectly
through a downstream barrel package — never off import-statement text. This was
the third miss of that class, after #4667 / #4709 (`app.homePageId`).

**4. Shipped changelog sections get forward-notes, never rewrites (#5809).** A
changelog's value is in being a faithful record of what was shipped and said, so
the stale sentences stay and a clearly-marked correction is added inside the
section, pointing at where the corrected statement lives. Three notes land in
`## 17.0.0-rc.2`: two on the #4610 entry (`0a936ea`, the evidence and the
FROM → TO), and one on the #4651 app-area entry (`ad047d2`), whose caveat *"per-item
gating inside an area is enforced by the shell only, because the server does not
walk `areas`"* has not held since #4722 — `filterAppForUser` runs the same
`filterNav` over every `areas[].navigation`. The same file's `## 17.0.0-rc.4`
entry `e4c8b6c` (#5337 / PR #5796) already carries the corrected statement, so
until now one `CHANGELOG.md` asserted a prescription in one section and refuted
it in another; a reader arriving by keyword search could be sent off to do an
unnecessary navigation-tree refactor.

Corrected directly (live contract text and GA inputs, not shipped records):
`packages/spec/src/ui/notification.zod.ts`'s tombstone,
`packages/spec/src/migrations/registry.ts`'s protocol-17 `#5015` rationale (which
projects verbatim into `docs/protocol-upgrade-guide.md` and `spec-changes.json`
via `gen:upgrade-guide` / `gen:spec-changes` — both regenerated, never hand-edited),
and the still-unconsumed `.changeset/notification-dual-source-c3.md`, which is a
legal input to the v17 GA release notes while the repo is in changesets pre mode.
New pin tests keep both false premises from returning: the registry `reason` is
pinned in `migrations.test.ts`, the tombstone's four verdicts in
`notification.test.ts`. ⛔ `content/docs/releases/` is untouched.
