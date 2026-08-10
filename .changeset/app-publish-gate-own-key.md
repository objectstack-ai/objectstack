---
"@objectstack/spec": major
"@objectstack/rest": minor
"@objectstack/runtime": minor
---

fix(spec,rest,runtime)!: the ADR-0045 publish gate gets its own machine-managed key — `app.hidden` goes back to meaning navigation, and the built-in Account app stops 404ing for every normal user (#4829)

<!-- adr-0087: registered app-hidden-to-unpublished -->

**FROM → TO:** nothing to rewrite by hand. `app.hidden` keeps its spelling and its
authoring contract; the publish gate moves to a new machine-managed key,
`app._unpublished`, which no author writes. Stored `sys_metadata` app rows carrying
`hidden: true` are rewritten to `_unpublished: true` by the ADR-0087 conversion
`app-hidden-to-unpublished` — automatically on every stored-row read, and in place via
`os migrate meta --stored --apply`.

## The defect

`filterAppForUser` (`@objectstack/rest`) treated `app.hidden` as an access gate:

```ts
if (item.hidden === true && !sysPerms.has('studio.access') && !sysPerms.has('setup.access')) return null;
```

`hidden` does not mean that. Its contract, written in `app.zod.ts` the day the key was
born alongside the built-in Account app, is navigation presentation: *"Hidden apps stay
fully routable and permission-checked"* — keep it out of the App Switcher, surface it from
the avatar menu, which is exactly how personal-settings apps behave in GitHub Settings,
the Google account chip and Salesforce Personal Settings.

So the platform's own `account` app — authored `hidden: true` on purpose — was erased from
`GET /api/v1/meta/app` for every user without `studio.access` / `setup.access`. Clicking
the avatar → Profile landed on *"App not available — it may still be publishing"*, and
password changes, avatar, linked accounts, active sessions and the inbox were all
unreachable. Any admin saw a completely healthy system, which is why it survived a release
candidate and shipped a downstream workaround.

The two contracts arrived from different places. ADR-0045 §3 did not introduce `hidden`; it
**borrowed** it, citing an "ADR-0019 launcher contract (`hidden`, `active`)" as an existing
read side. That contract does not exist — **ADR-0019 contains no `hidden`** and never
discussed launchers, the avatar menu or the Account app. The reference was dangling from
the day it was written, which is why nothing caught the collision it created: one boolean,
two contracts, disagreeing on the only question that matters — *may a normal user reach
this app?*

## What changed

- **`AppSchema` declares `_unpublished`** — the ADR-0045 §3 publish gate. `true` means the
  app is unpublished: externally unobservable, not merely unlisted. It is written by the AI
  additive-materialization path and cleared by `POST /packages/:id/publish-drafts`, and its
  `_` prefix is this repo's existing marker for the channel tooling stamps onto artifacts
  (ADR-0010's `_lock` / `_provenance` envelope; the prefix `lintAuthoredRecordKeys` already
  skips). It is *declared* rather than omitted because the write path validates against
  this very schema (`saveMetaItem` → 422; `Registry.validate('app', …)` → `AppSchema.parse`),
  so an undeclared key would make the platform's own flip unwritable. The strict door
  answers the author-shaped spellings — `unpublished`, `published`, `draft` — with a
  prescription that says *publish state is not authorable*, rather than routing them onto
  the key.
- **`app.hidden` is navigation only**, and its docblock now says so with the incident
  attached. Authoring `hidden: true` affects the App Switcher and nothing else.
- **The REST gate judges `_unpublished`.** A hidden app is served to everyone, with its
  `hidden` flag intact so the shell can place it; an unpublished app still 404s externally
  and still reaches builders for direct-URL preview, and `requiredPermissions` still applies
  to both.
- **`publish-drafts` clears `_unpublished`** instead of un-hiding. It writes `false` rather
  than deleting the key, because ADR-0045 §3 makes publish/unpublish symmetric, and it
  copies `hidden` through untouched — publishing no longer rewrites a presentation choice
  as a side effect. The response fields keep their `unhiddenApps` / `unhideError` spelling:
  they are a wire contract read by the objectui Publish button, and renaming them from a
  repo that cannot update that consumer would be a silent break of exactly the kind this
  change is about.
- **ADR-0045 is amended**, its dangling ADR-0019 reference corrected, and both
  implementation sites (`rest-server.ts`, `runtime/domains/packages.ts`) are now anchored in
  `scripts/adr-anchors.json` — neither carried an anchor before, which is why an author
  could change ADR-0045's §3 without knowing they were changing a decision.

## Why a new key rather than deleting the gate

Taking `hidden` out of the access decision was proposed first and refused. The gate is §3 of
an **Accepted** ADR with pin tests and a live implementation behind it, so removing it in a
patch would reverse a recorded decision by side effect. It is also the worse failure
direction: a gate that fails **open** exposes a half-built app to real users, silently.

## Migration reach

The conversion is `retiredFromLoadPath: true`, and here that flag is load-bearing rather
than bookkeeping — it confines the rewrite to **stored rows**. `hidden` is not retired as an
authorable key, so a conversion running on the load path would rewrite
`defineApp({ hidden: true })`, and the Account app itself, into unpublished apps and
reproduce the defect through the conversion layer. Excluded from the load path, it replays
only where the old meaning is the only meaning: the stored-row rehydration seams and
`os migrate meta`. Stored `hidden: true` was unambiguous under the old regime — that value
*was* the gate, so nobody stored it to mean "keep me out of the switcher"; code-declared
apps like `ACCOUNT_APP` never enter `sys_metadata`, and the Studio app form has no `hidden`
control.

## Follow-ups (other repos, filed separately)

- **cloud** — the AI materialization write point must stamp `_unpublished: true` where it
  stamps `hidden: true` today.
- **objectui** — the Unpublished banner and the Publish button must read/clear
  `_unpublished`; the App Switcher keeps reading `hidden`, which now means only what it says.
- **os-project-titanwind-ehr** — PLAT-DEF-040's startup `{hidden:false}` overlay can be
  deleted once this ships.
