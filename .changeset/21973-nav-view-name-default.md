---
"@objectstack/spec": patch
---

`ObjectNavItemSchema.viewName`'s describe no longer says the default is "all". It now states what the console does when an object nav entry names no view: it opens the object's default list view, else its first declared list view. `all` is only the console's fallback tab, and it exists only for an object that declares no list view.

Clause-②: no

- The rule is read from objectui at the `.objectui-sha` pin. `ObjectView` opens `defaultViewId || views[0]`, where `defaultViewId` is the view `buildViewTabs` marks `isDefault` (the default `list`). `buildViewTabs` adds the `all` tab only when the object has no list view at all.
- An author who omitted `viewName` expecting all records got that default or first declared view instead. When the object declares more than one list view, name the one the entry should open in `viewName`.
- The generated app reference page follows (#21973). The lint header that quoted the old sentence follows too, as a comment only.
- ⛔ No schema, type, optionality, default, export or accept-set change. The console's behaviour does not change.
