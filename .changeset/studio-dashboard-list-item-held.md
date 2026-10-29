---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): an item just added to a dashboard's list property is held until it is filled in, instead of being autosaved and refused

Clause-②: no
Metadata-protocol: none

In the Studio's Interfaces pillar, "Add item" under a dashboard's **Global Filters** or its header **Actions** used to autosave the new, empty item. The draft door refused it (422), and every later save of the dashboard carried the same item and was refused too, so an edit made afterwards, such as a new Label, was lost on reload.

Such an item is now held the way a widget waiting for its dataset is: nothing is sent while the dashboard's own schema refuses the item only for inputs it leaves unset, a neutral line names what it needs (for example "Field on item #1 of “Global Filters” needs a value") with a **Show me** that opens the dashboard's properties at that list, and Publish refuses while it is held. Once the item is filled in, the next autosave sends every edit kept meanwhile. An item refused for a value it holds is not held: it is sent, and the refusal it draws shows as before.
