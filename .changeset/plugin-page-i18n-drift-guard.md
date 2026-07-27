---
---

test(cli): pin the plugin-carried Setup pages against their translations (#3589)

Test-only; releases nothing. Adds a drift guard asserting the `en` entries in
`@objectstack/platform-objects` stay byte-identical to the `page:header`
literals authored in `@objectstack/cloud-connection` and `@objectstack/mcp`,
that the `pages` key set matches across every shipped locale, and that
`translatePage` localizes the three Setup pages end-to-end.

`translatePage` applies the bundle for every locale including `en`, so a
drifted `en` entry silently overrides newer authored copy rather than falling
back to it — previously nothing in the build caught that.
