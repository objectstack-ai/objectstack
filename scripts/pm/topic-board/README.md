# Topic-and-area board — runbook

The board is one claude.ai artifact page with two tabs, objectstack and cloud. Each tab lists every
open topic (专题) as a collapsible tree under its `area:*`, then each area's open cards that sit in no
topic. It is a view, never state: every number is re-read from GitHub on each refresh, and nothing
reads the board back.

| File | What it is |
|:--|:--|
| [`../topic-board.mjs`](../topic-board.mjs) | Builds the datasets. Read-only GitHub reads; header doc says what counts as a topic, a member, a parent, and the area table. |
| [`page.html`](page.html) | The page template: a Data-type artifact page reading the datasets `epics`, `areas`, `epics_cloud`, `areas_cloud`. |

## Duty and cadence

The triage seat refreshes the board every 3 hours, on the patrol fires at UTC hours 0, 3, 6, 9, 12,
15, 18 and 21.

## Each refresh

1. **Build both repos** into one scratch directory (the session scratchpad, never the repo):

   ```sh
   node scripts/pm/topic-board.mjs --repo=objectstack --out=DIR
   node scripts/pm/topic-board.mjs --repo=cloud --out=DIR
   ```

   That writes `epics.json`, `areas.json`, `epics_cloud.json` and `areas_cloud.json`. A run that
   exits 3 had a GitHub read fail and wrote nothing: do not upload the previous files as if they were
   new. Retry on the next fire.

2. **Upload the four JSON files** as assets of the board artifact, **one file per call**.

3. **Point the four dataset docs** (`epics`, `areas`, `epics_cloud`, `areas_cloud`) at the new
   blobs, each write pinned with `if_version` to the version you just read, so a concurrent refresh
   cannot be silently overwritten. A version conflict means another seat refreshed in between:
   re-read and start over, never force.

4. **Delete the superseded blobs** — only those no dataset doc points at any more.

## Ownership

- The artifact belongs to the claude.ai account that created it. A triage seat on another account
  needs edit access shared to that account by the owner, or publishes a new board from
  `page.html` and tells the maintainer the new link.
- ⛔ Do not put the artifact's URL in this repository. The seat post or project memory carries it.

## Reading a stale row

A card touched after the build — relabelled, re-parented, or newly filed — can show up as a
stateless (无状态) or 「（未定 area）」 row until the next refresh. Rebuild, or fold it into its area
by hand when reporting.

## Checking the script

```sh
node scripts/pm/topic-board.mjs --self-test   # offline, no network, no token
```

CI runs the same self-test through `pnpm check:pm-board-snapshot`.
