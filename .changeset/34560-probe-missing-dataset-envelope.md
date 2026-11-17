---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the publish probes skip a widget whose dataset does not exist instead of checking the read's envelope

Clause-②: no
Metadata-protocol: none

The by-name read `getMetaItem` answers an item that does not exist with its envelope, `item` empty, not with `undefined`. The publish probes' reader (`publishedItemReader`) fell back to that envelope when it carried no `item`, so a dashboard widget naming a dataset nothing holds was handed the envelope as its dataset. The widget was counted in `checked.widgets`, and its query ran over a body that binds no object, which could report a false `widget_query_failed` on the publish receipt and in `verify_build`. The reader now answers no body when the envelope carries no `item`, so such a widget takes the dangling-dataset path again: an L1 graph finding, not probed and not counted. A dataset that exists is read exactly as before.
