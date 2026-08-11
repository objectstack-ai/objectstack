---
name: dogfood-verification
description: >
  Internal process for dogfooding the ObjectStack platform — booting a real
  example app (showcase / CRM) and driving it in a browser as a real user or
  admin to find runtime bugs that static checks and unit tests miss, then
  fixing and shipping cleanly. Use whenever the task is "verify in the browser",
  "act as a real admin/user", "dogfood the Setup/Studio app", or browser-verify
  a change in the running app. NOT a customer-published skill — this is internal
  agent tooling (lives in .claude/, never in the published `skills/` dir).
metadata:
  # Hides this skill from interactive `npx skills add objectstack-ai/objectstack`
  # discovery. NOTE: the skills CLI's `--all` implies `--skill '*'`, which
  # includes internal skills — so the hard boundary against leaking into
  # customer projects is the `/skills` subpath in every advertised install
  # command (scaffolder, docs). Every SKILL.md outside `skills/` must carry
  # this marker — template-consistency.test.ts enforces both layers.
  internal: true
---

# Dogfood verification

Hard-won process for booting and driving the real app. Three pillars: **isolate
the environment**, **know the build model**, **verify visually/authoritatively
before asserting**. Skipping pillar 1 or 3 is where time gets burned.

## 0. Pre-flight — isolate the environment (do this FIRST)

The dev working tree, the dev-server port, and the preview browser are all
**shared**: a parallel Claude/dogfood session will yank the browser tab, leave
unsaved drafts that block navigation, and dirty the working tree. Isolate up front:

- [ ] **Own port**: pick a free, non-default port (NOT 3000/3001/3210). Check first:
      `lsof -nP -iTCP:<port> -sTCP:LISTEN`. Add a named config to `.claude/launch.json`
      pointing at *this* working dir, e.g.
      `pnpm -C <abs>/examples/app-showcase exec objectstack dev --ui --seed-admin -p <port> -d file:/tmp/<run>/data.db`.
- [ ] **Own data**: `--seed-admin` gives `admin@objectos.ai / admin123` on an empty DB.
      Persistent `-d file:/tmp/<run>/data.db` survives restarts (good for multi-step config
      runs); `--fresh` for a pristine first-run (wipes on exit).
- [ ] **Confirm exclusive control**: after `preview_start`, check `location.origin` ===
      your `http://localhost:<port>`. If the tab keeps drifting to another app/route you
      didn't navigate to, or shows drafts you never made → **a parallel session owns the
      browser**. Stop fighting it; pin all checks to your absolute origin and lean on the
      API + source (pillar 3).
- [ ] If you'll also open a PR, build it in a **separate git worktree off `origin/main`**
      (see §5) — never commit from the shared dirty branch.

## 1. Boot

- [ ] `preview_start` your named `.claude/launch.json` config; poll readiness:
      `curl -s -m3 -o /dev/null -w '%{http_code}' http://localhost:<port>/api/v1/health` → 200.
- [ ] Console UI is at `/_console/`; apps at `/_console/apps/<appId>` (e.g.
      `com.objectstack.setup`, `com.objectstack.studio`). API root `/api/v1`,
      settings `/api/settings`, merged app/nav `/api/v1/meta/app?id=<appId>`.

## 2. Build/runtime model — batch, then ONE restart

- [ ] Packages load from **`dist`**, not `src` (`pkg.main = dist/index.js`). Editing
      `packages/*/src` has **no runtime effect** until you rebuild that package
      **and restart the server**. The `os dev` watcher only recompiles the example's
      own `objectstack.config.ts` / `src`, not workspace packages.
- [ ] So: make **all** source edits first → `pnpm --filter <pkg...> build` →
      `preview_stop` + `preview_start`. Don't edit→build→restart per fix.
- [ ] `dist/` is gitignored — safe; never commit build output.
- [ ] **The `/_console` UI is a *vendored objectui build*, separate from framework `dist`.**
      It's pinned by `.objectui-sha` and served as a pre-built bundle. A merged objectui
      fix — *or even a bumped `.objectui-sha`* — is **not live at :3000 until the vendored
      console is rebuilt**: the running server keeps serving the old build artifact (stale
      BUILD ≠ stale PIN). So **before declaring a console/Studio UI bug found at
      :3000/_console, check it against current objectui source or a fresh build** — the
      vendored bundle may be stale and the bug already fixed upstream. Fastest authoritative
      check = objectui's HMR console against your server:
      `VITE_SERVER_URL=http://localhost:<port> DEV_PROXY_TARGET=http://localhost:<port> pnpm --filter @object-ui/console dev`
      (separate origin → needs its own `admin@objectos.ai/admin123` login). Skipping this
      cost a full spawn-a-fix cycle on an action-create dead-end that was already fixed in
      objectui main.

## 3. Verify — visual / API first, DOM last (the anti-false-positive rule)

The biggest trap: `preview_eval` DOM queries **right after navigation** return
transitional/empty results (React hasn't hydrated) → you conclude "nav is empty /
feature is broken" and it's a lie.

- [ ] **Before asserting any "missing / broken / unreachable" finding**, confirm with a
      **screenshot** (visual truth) or an **authoritative server response**
      (`/api/v1/meta/...`, `/api/settings`) — the metadata the server actually sends.
      Never report a severe finding from a single post-nav DOM dump.
- [ ] DOM dumps are fine *after* you've confirmed the page rendered (screenshot first,
      then query for selectors).
- [ ] **Test both sides of a gate**: a `requiresService`/`requiresObject`/permission gate
      should be verified both when the dependency is present *and* absent.
- [ ] Server is the authoritative visibility gate (ADR-0057 D10) — client filtering is
      "courtesy". If a metadata flag doesn't change the UI, check whether enforcement is
      server-side (framework, fixable here) or client-side (objectui console, separate repo).
- [ ] Prove it to the user with a `preview_screenshot` (or `preview_network` for API
      changes); note loading-spinner / async-data states explicitly rather than claiming
      final values you didn't wait for.

## 4. Browser escape hatches (gotchas)

- **Stuck page / blocked navigation** (unsaved-changes `beforeunload`, shared tab): neutralize then navigate —
  ```js
  Object.defineProperty(Event.prototype,'returnValue',{configurable:true,get:()=>undefined,set:()=>{}});
  const op=Event.prototype.preventDefault;
  Event.prototype.preventDefault=function(){ if(this&&this.type==='beforeunload')return; return op.apply(this,arguments); };
  window.onbeforeunload=null; location.replace('<url>');
  ```
- **Login / React controlled inputs**: `preview_fill` sets `.value` but doesn't fire React
  `onChange` → form submits empty. Use the native setter + dispatch `input`+`change`, or
  just POST the auth endpoint via `fetch` from the page.
- **Cross-origin**: pin `fetch` to your absolute `http://localhost:<port>` so a drifted tab
  doesn't hit the wrong server; `credentials:'include'` for cookie-authed routes.

## 5. Ship — isolated PR (when the working tree is shared/dirty)

- [ ] Capture only your files: `git diff -- <explicit paths…> > /tmp/fix.patch`
      (use **explicit paths**, not a multi-line shell var — it silently yields an empty patch).
- [ ] `git worktree add -b <branch> /tmp/pr origin/main` → `git -C /tmp/pr apply /tmp/fix.patch`
      → confirm `git -C /tmp/pr status` shows *only* your files.
- [ ] Add a **changeset** (`.changeset/<slug>.md`, `"@objectstack/<pkg>": patch`) — CI's
      "Check Changeset" gate requires it for published-package changes.
- [ ] Commit (end message with the `Co-Authored-By:` trailer), push, `gh pr create`,
      then `gh pr merge --squash --auto --delete-branch` (remove the worktree first so the
      local branch isn't locked: `git worktree remove /tmp/pr --force`).

## 6. Shell hygiene

- zsh eats `--include=*.ts` when the glob doesn't match → use the dedicated **Grep tool**,
  or quote the glob.
- Prefer explicit args over multi-line `VAR="a b c"` in compound `git` commands.

---

**Golden rule:** if a finding would be severe ("the whole settings surface is unreachable"),
treat your first read as a hypothesis and disprove it with a screenshot or the server's own
metadata before writing it down. Most "P0s" found this way are hydration artifacts.
