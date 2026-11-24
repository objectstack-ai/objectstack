---
'@object-ui/app-shell': patch
---

fix(studio): the object extension, hook, action and flow Saves no longer publish over another admin's live change

Clause-②: no
Metadata-protocol: none

Studio's top-bar Save writes an item's draft and then publishes that one item. The object page pinned that publish to the published row it was loaded at, but the other editors that save this way did not: two admins who opened the same object extension, hook, pair action or flow each passed the draft check, and the later Save replaced the earlier one's live change without a word.

Each of those editors now reads the published version at the address its publish writes (the `/layers` read's `overlayVersion`) where its buffer is loaded, and its Save's publish sends it as `If-Match` (`If-None-Match: *` where nothing is published there yet). When another writer published since, the Save opens the same dialog the object page shows for a live change: reload re-reads the live item, overwrite (after a confirmation) publishes over the version the refusal names, and keep editing leaves the edits on the page, unsaved. The flow's on/off switch is pinned the same way. Creating a new hook, pair action or flow publishes with `If-None-Match: *`, so a same-named item another writer published first is refused instead of replaced. No dialog wording or locale key changes.

A reload over a draft that was pending before the Save (a copilot's) now keeps the publish pinned to the version the conflict was raised on: the reload re-reads that draft, which carries the page's edits, and the next Save is asked again instead of publishing it over the row that moved. An overwrite, a publish that lands, or a load that finds no pending draft ends that hold. This applies to the object page too.

A server that serves no `overlayVersion` gets an unpinned publish, as before. Nothing to migrate.
