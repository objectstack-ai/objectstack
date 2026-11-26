---
'@object-ui/app-shell': patch
---

fix(console): the AI-build entries show only where the agent catalog serves the build agent, and an old build conversation still opens

Clause-②: no
Metadata-protocol: none

A deployment can close in-app building with AI: its agent catalog then keeps `ask` and no longer lists `build`, and the chat route refuses `build`. The console's build entries now read the catalog for the build agent itself (alias-aware, `build` or its legacy id), never "any agent" and never a hosted or self-hosted guess:

- The sidebar app menu's 「Add app」 and the desktop's no-apps empty state offer "New in Studio" (Studio's new-package flow) instead of "Build with AI"; the template and marketplace choices stay.
- Home's builder chip takes its "New in Studio" form, as it already did for an empty catalog, instead of "Build an app".
- Studio's AI copilot is not drawn; the right panel shows the properties alone, as for an empty catalog. Asking stays in the console's chat drawer.
- The full-page chat address `/ai/build/ID` lands on `/ai/ask/ID` and opens that conversation, instead of `/ai/ask` without it. A maker's bare `/ai/ask` is not redirected to `/ai/build`.

Where the catalog serves `build`, every entry behaves as before. `useAiSurfaceEnabled()` also returns `buildServed`; no locale keys change.
