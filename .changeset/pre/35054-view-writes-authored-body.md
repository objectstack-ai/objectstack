---
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell, data-objectstack, console): view, form, pair-action and report edits start from the stored item, not the translated served one

Clause-②: no
Metadata-protocol: none

The served metadata reads are translated for the reader's locale, and the metadata save door stores a body verbatim. Four more writers seeded a whole-item save from a served read, so in a zh-CN session each stored the translations as the item's source text and readers in every other locale were then served Chinese. The view config panel (and its draft-bar resume) seeded its buffer from the served view; the adapter's `updateView`, behind Manage views' Rename, Pin and Set as Default, merged onto the served draft or the served published view; Developer → Public Forms spread the served form view into its Publish and Edit writes and prefilled the thank-you text from it; and Studio's pair actions on an installed app's object buffered the pair's served actions. Each now starts from the untranslated layered read through `authoredBuffer` (the pending draft as stored, else the published item) or, for the live-row writers, `authoredPublished`, and changes only the keys its control owns. A pending draft whose stored copy the layered read does not serve is refused, and so is an item with nothing stored to read: nothing is written from the served copy. The report quick edit now hands its served draft to `authoredBuffer`, so a pending report draft the layers do not serve opens no editor instead of one seeded from the published report.
