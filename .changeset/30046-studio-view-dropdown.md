---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): Studio Interfaces picks an object's list view from the header title, object / view ▾, the way the running list does, and the open view stays in the address

Clause-②: no
Metadata-protocol: none

- **The view switcher is in the header's title.** An `object` entry's header reads object / view ▾. The switcher is the running list's own dropdown (`ObjectViewTitleSwitcher`): the object's list views by label, a view only drafted in this package included, a search box, and New view, which opens the Create View dialog. Studio does not offer the reader's own features there: no ☆, no 📌, no recent views, no Save as my view. It shows when the object has one list view too, so New view is always one click away. A read-only package switches views and offers no New view.
- **The Properties panel no longer holds a view picker, Add view or "Back to …".** It keeps the open view's settings, and its title is the view's name as the switcher gives it (the label the object's served `listViews` carry). A view with no label is named "Default view" or by its key; the header names the object before it.
- **The open view is in the address.** Switching writes `?view=<object>.<key>` beside `?surface=` and `?nav=`; the entry's own view writes none. A reload or a shared link opens that view again, a view only drafted in this package included. A link naming a view of another object is not taken. A pending edit is still sent before a switch, and an edit that cannot be sent still asks first.
- **`ObjectViewTitleSwitcher`: the pin is optional.** `onPinnedViewChange`, `pinnedViewId` and `recentViewIds` may be left out; without `onPinnedViewChange` no row draws 📌 and no Pinned section is listed. The running list passes all three, so it is unchanged.
- **`@object-ui/i18n` (studio namespace):** adds `engine.studio.inspector.listView.defaultView`; removes `defaultTitle`, `namedTitle`, `addView`, `backToEntry`, `switchView` and `switchViewDraft`, which only the removed panel controls read.
