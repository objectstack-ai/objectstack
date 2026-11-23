---
'@objectstack/spec': patch
---

docs(spec): `navigation.size` says what `'auto'` really does

Clause-②: no
Metadata-protocol: none

The TSDoc and `.describe()` text of a view's `navigation.size` said that the default `'auto'` makes the renderer derive the drawer size from the object's field count and the viewport, so an author writes nothing. No renderer does that. `'auto'` is the host's fixed default width, the same for every object: the console's record side panel opens at `min(92vw, 460px)`, and a page block's drawer at that block's own default. The text now says so, gives the pixel cap of each explicit bucket (sm 480, md 720, lg 960, xl 1200, full 1600, always clamped to the viewport), says that a width the reader drags wins, and says where the key has no effect (a record that opens as a page, a phone-width screen). It no longer calls the buckets aligned with `FormView.modalSize`, whose buckets have other names and other widths.

Prose only: the key, its values and its default are unchanged. The view form's help text for the key and the generated reference pages carry the same text.
