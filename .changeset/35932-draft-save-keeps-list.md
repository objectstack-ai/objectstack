---
'@object-ui/app-shell': patch
---

fix(console): saving a shared view's draft keeps the list on screen, and a second change builds on the first

Clause-②: no
Metadata-protocol: none

An admin who saved a draft of a shared view (a footer calculation pick, or a view settings change) saw the list redraw on the published view about half a second later, and the change came back only after Publish. A second change before Publish was then built on the published view, so its draft replaced the first: pick Sum, then Latest, then Publish, and only Latest was kept.

Every draft save announces itself on the metadata-refresh pulse, so the pending-drafts surfaces re-read, and every mounted metadata provider refetches its loaded types on that pulse. While the refetched view list was on the wire, the route's object scope read as unanswered, so the console dropped the route to its loading skeleton and mounted the list again, on the published view. A type that is refetching over an answer it still holds now counts as answered: the scope stays settled on the views in hand, the route stays mounted, and the list keeps the draft on screen. This holds for every refresh pulse (a publish, a package install, a change noticed in another tab), not only a draft save. On an app with a metadata bundle, the pulse also drops the bundle, and it answers nothing until it is downloaded again; meanwhile the scope's views now come from the bundle that last answered, when it holds every object the route asked for, so the route stays mounted there too. A type the provider drops (an invalidation, an organization switch) still waits for its new answer, and an organization or session switch forgets the last bundle.

Publish and Discard in view settings now drop the list's local copy of the draft once the saved views have been read again, so the list then shows what is stored. A reader who is not an admin still sees the published view until Publish. No props, exports or locale keys change.
