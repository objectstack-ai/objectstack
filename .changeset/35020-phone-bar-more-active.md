---
'@object-ui/app-shell': patch
---

fix(app-shell): a phone's bottom menu bar lights More when the page in view is in the full menu but not in the bar

Clause-②: no
Metadata-protocol: none

On a phone, the bottom menu bar holds four of the app's entries and then More, which opens the full menu. On a page whose entry was not one of the four (an Opportunities list when the bar holds Home, Sales home, Leads and Accounts), no cell was highlighted, so the bar did not show where the reader was. More is now highlighted on such a page, and the full menu it opens shows that entry selected. On a page whose entry is one of the four, that cell is highlighted as before and More is not. A page that no menu entry addresses highlights no cell. Which four entries the bar holds is unchanged: pinned entries first, then the menu's first entries.
