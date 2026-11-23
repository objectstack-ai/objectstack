---
'@object-ui/app-shell': patch
---

feat(console): the design mode is entered from the app-name menu; the page header no longer carries 「Edit app」 or 「Open {app} in Studio」

Clause-②: no
Metadata-protocol: none

The app-name menu at the top of the sidebar now offers 「Edit app」 under the list of apps, in one group with 「Add app」. Choosing it turns the design mode on for the app on screen, in place. It is offered on the condition the page header's button was drawn on, unchanged: a workspace admin holding `manage_metadata`, on an app whose package Studio lists (the console's own Setup, Studio and Account apps get none). An app built here and an installed (read-only) one get it alike, except where the customization door is walled off for the caller (a walled deployment, not the platform operator): there an installed app's menu offers no 「Edit app」. While the mode is on, the menu does not offer it. The menu is drawn from 768 px up, docked or floated over the content while the sidebar is collapsed; a phone has no way into the mode, as before.

The page's top-right button group now holds the comments slot, the AI assistant and help only: its 「Edit app」 and the read-only package's 「Open {app} in Studio」 are gone. The app switcher's 「Open {app} in Studio」 row is unchanged, and so is the top bar's Studio entry where a top bar is still drawn (from 640 to 767 px wide, and on an app's docs pages).
