---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): a report's new Order or Blocks item, or a chart type picked before its axes, is held until it is filled in, instead of being autosaved and refused

Clause-②: no
Metadata-protocol: none

In the Studio's Interfaces pillar, a report's properties used to autosave an unfinished edit: "Add item" under **Order** sent an empty sort key, "Add item" under a joined report's **Blocks** sent an empty block, and picking a **Chart type** before its X and Y axes sent a chart without them. The draft door refused each (422), and every later save of the report carried the same body and was refused too, so an edit made afterwards was lost on reload.

Such a report is now held the way a dashboard's unfinished list item is: nothing is sent while the report's own schema refuses the item, or the chart, only for inputs it leaves unset. A neutral line names what it needs (for example "Order By on item #1 of “Order” needs a value", or "X-Axis (dimension) on the report’s chart needs a value") with a **Show me** that opens the report's properties at that input, and Publish refuses while it is held. Once the input is filled in, the next autosave sends every edit kept meanwhile. An item or a chart refused for a value it holds is not held: it is sent, and the refusal it draws shows as before.
