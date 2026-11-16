---
'@object-ui/app-shell': patch
---

fix(console): a packaged app's lookup targets outside its package, and an app entry's `requiresObject`, are asked by name only once the host serves them

Clause-②: no
Metadata-protocol: none

The console asked two kinds of object definition by name even when the host does not register the object, and each answered `404` on every open of the route.

- **A packaged app's lookup targets outside its package.** An object's route and a page in an app with a package asked each lookup target the package list does not hold by name (`sys_approval_request` on a Free environment). Those targets are now asked first in the one `GET /api/v1/meta/object?names=` read an app with no package already uses, which leaves an absent object out, and only the ones it serves are then read by name. A target the package list holds is read as before, with no extra request.
- **An entry's `requiresObject`.** The objects an app's navigation and area entries require were asked by name, by the route's scope, the sidebar's capability gate, the served view items and the `nav:menu` block. They are now asked in the same `?names=` presence read, in one request shared by those readers; the route reads by name only the ones it answers served. The sidebar and the `nav:menu` block still hide an entry whose object the answer leaves out, and show one it serves or has not answered yet. In a packaged app the package's own objects are answered by its list and are not asked again.
