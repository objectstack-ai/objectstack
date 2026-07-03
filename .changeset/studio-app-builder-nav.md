---
"@objectstack/platform-objects": patch
---

feat(studio): "App Builder" navigation entry — the pillar builder joins the journey

The Studio app's Overview group gains an **App Builder** entry (componentRef
`studio:builder`, bound by the console to the builder landing page). This makes the
pillar application builder reachable from the moment a user logs in — Home → Studio
→ App Builder → pick/create a writable base package → the full-screen builder at
`/studio/:packageId/:tab` — instead of being a URL-only surface.
