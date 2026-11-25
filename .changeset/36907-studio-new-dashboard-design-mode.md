---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): New on a Studio dashboard list opens the app's design mode, ready to add a dashboard to its menu

Clause-②: no
Metadata-protocol: none

Studio redesign (epic #36890): a new dashboard is made where it hangs in an app's menu, never outside every menu.

- **New on a Studio dashboard list** opens the package's app with Design layout already on and the 「Add menu item」 picker open on its Dashboards, 「New dashboard…」 first. The app is picked the same way as for opening a dashboard: the app you came from when it is one of the package's, otherwise the package's first app. For an installed app, what you save there goes to its customization package, as before. For a customization package (`<base>.custom`) that has no app of its own, the base package's app opens.
- **After Create** the dashboard is in the menu where the picker put it, at the end of the menu's top level, and opens for editing, as a dashboard made in Design layout always has. Its × goes back to the Studio list you left. Closing the picker instead leaves you in Design layout, with nothing added.
- **When there is no New.** On a phone-width window the dashboard list offers no New: Design layout is never on there. A package with no app to open offers no New either, and the list says why.
- **Nothing enters Design layout by itself.** The way in is a one-time instruction carried by the click, never the address: a reload, a shared link or Back does not turn it on. If a dashboard's or a report's own editor is open at that moment, Design layout refuses with the usual message and nothing else happens.
- **The report list is unchanged:** its New still opens the app's New report page.
- **A note on an earlier entry,** customization packages' dashboards and reports opening in their base package's app: the app you came from also counts when it is not one of the base's apps, as long as its menu opens that dashboard or report. That is the same rule as for every package.
- New Studio string `engine.list.dashboardNewNoApp`, in English and Chinese.
