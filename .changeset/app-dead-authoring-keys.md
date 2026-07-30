---
"@objectstack/spec": major
---

feat(spec)!: tombstone the seven dead AppSchema authoring keys (#4001 app step, PR A)

The 2026-06 AppSchema liveness audit verdicted seven authorable keys DEAD —
never read by any consumer in framework or objectui. Authoring them shipped
config the author believed was in effect; `sharing`/`embed` were the
dangerous case (a declared public-access surface no route enforced,
ADR-0049 class). All seven are now `retiredKey()` tombstones: `tsc`-level
`never` for typed authors, a parse-time prescription for everyone else —
NOT a silent strip, because `AppSchema` is not yet `.strict()`.

**Removed keys and their prescriptions (FROM → TO):**

- `App.version` → an app is versioned by its owning package: `manifest.version`.
- `App.aria` → declare `aria` on the component/widget that renders the DOM node.
- `App.objects` / `App.apis` → the self-described "config file convenience";
  objects/apis belong to the stack (`defineStack({ objects, apis })`) — the
  chatbot derives an app's object list from its NAV ITEMS, never from these.
- `App.sharing` / `App.embed` → public access is granted per FORM VIEW
  (`FormView.sharing`, the public-data-collection surface); no public-app or
  iframe route ever read the app-level blocks.
- `App.mobileNavigation` → fully unimplemented (even `packages/mobile`
  ignored it); returns if/when a real mobile navigation ships.

Deleting a key is behavior-preserving by construction — none ever had a
runtime effect. `os migrate meta --from <16 or lower>` rewrites your source
(the `app-dead-authoring-keys-removed` conversion, ADR-0087), or delete the
keys by hand.

This clears the ADR-0049 precondition for PR B (AppSchema + navigation-union
`.strict()`): strictness should guard the real contract, not dead keys.
