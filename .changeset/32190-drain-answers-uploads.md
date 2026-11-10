---
'@objectstack/plugin-hono-server': patch
---

fix(plugin-hono-server): a request whose body is still arriving at shutdown is answered, not cut off

Clause-②: no
Metadata-protocol: none

A request that was uploading when the server was told to stop (a file, a large import, a form posted over a slow link) used to get its connection closed with no answer. `HonoServerPlugin.destroy()` started the HTTP drain without waiting for it, so the kernel finished its shutdown and exited the process within milliseconds, and the 10 s drain window never ran.

Now the plugin drains the HTTP server from its `kernel:shutdown` hook and waits for it, before any plugin is destroyed. A request in flight finishes while the services it needs (auth, data and the rest, which are destroyed after) are still up:

- a request whose body finishes arriving inside the drain window is served, and gets its real answer with `Connection: close`;
- a request whose body is still arriving when the window ends gets `503 SERVICE_UNAVAILABLE` with `Connection: close`, and then its connection closes. The app never had the whole body, so the request was not processed and can be sent again.

An event stream (`text/event-stream`) that is open when the drain begins is now closed at the start of the drain, because it never ends on its own. Before, it was cut when the process exited, a few milliseconds later; its client reconnects either way. A stream that opens during the drain is still held until the window ends.

The drain window stays 10 s. A shutdown now takes as long as the requests in flight need, up to that window.
