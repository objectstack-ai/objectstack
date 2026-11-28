---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the App Studio list draws its own title row, toolbar and columns, and New on a read-only base says where the item goes

Clause-②: no
Metadata-protocol: none

In the App Studio area, a metadata type's list now has a title row with the type's icon, its name, "New X" (for example "New Object") and the help menu, and one toolbar row under it: a source dropdown (all sources / modified and new / system-shipped, each with its count) and the search box. The breadcrumb, the stat tiles, the refresh button, the sort dropdown and the "only customizations" toggle are gone from that list; a column header sorts it, the Name header by API name by default.

The table runs full width with no outer frame. The name column draws the item's own icon tile (an object's `icon` and `color`), its label as the primary line and its API name small and mono below it. A column of numbers (an object's field count) is right-aligned, and the object list no longer draws a plural label column there. "Modified at" and "Source" are drawn only when the list's rows do not all show the same value in them. The Source badge reads System-shipped, Modified or New (系统自带 / 已修改 / 新建): an item the base's `.custom` package overrides is Modified, an item that package adds is New. The detail page's previous / next order reads the source filter the same way.

On a read-only base whose New creates into the base's `.custom` package, New stays enabled and its tooltip says the package is read-only and the new item goes to that `.custom` package (new key `engine.list.createInPairHint`). On a writable package New is unchanged.

Setup's list and the list outside Studio and Setup are unchanged. New `studio` keys: `engine.list.createNamed`, `engine.list.createInPairHint`, `engine.list.source.system`, `engine.list.source.modified`, `engine.list.source.new` and `engine.list.sourceFilter.{all,changed,system}`, in en and zh.
