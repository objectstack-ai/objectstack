---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell, console): "Save to this view" and the runtime draft bar's Publish publish only the draft they mean

Clause-②: yes (widening)
Metadata-protocol: none

"Save to this view" (and every save that publishes at once, `saveAndPublishRuntimeMetadata`) pins its publish to the draft its own draft write returned. When another admin's rename, pin or set-default lands on the same view between that draft write and the publish, the publish is refused, nothing is published, and the draft, which now holds that other change, stays pending for review instead of being discarded; the save answers as it does over a draft found pending. The runtime draft bar's Publish is pinned to the draft the bar read and shows: a draft changed since is refused with the server's message and stays pending. Against a server that serves no draft version, both publish unpinned, as before.
