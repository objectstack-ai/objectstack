---
'@object-ui/app-shell': patch
'@objectstack/client': patch
---

fix(app-shell): the view settings draft bar publishes the reloaded draft after a conflict is resolved with "reload"

When a view settings Save was refused because the draft moved and the author chose "reload" in the conflict dialog, the panel re-read the stored view but the draft bar kept the draft version it had read before the reload. Its Publish was then pinned to a draft that no longer existed and was refused until the panel was reopened. The panel now hands the bar the version its reload read found (`RuntimeDraftBar`'s new `reloadedSignal`, `reloadedDraftVersion` and `reloadedHasDraft`), so the Publish promotes the draft now shown, and a reload that found no pending draft takes the bar's indicator down. A reload whose read fails hands the bar nothing, so its Publish stays pinned and is refused rather than sent unpinned.

`client.meta.publishItem`'s `parentVersion` JSDoc now says an empty string pins nothing and is not sent, as `draftVersion`'s does, and the client SDK page shows a publish pinned with `draftVersion` and `parentVersion`.
