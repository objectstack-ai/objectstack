---
'@objectstack/spec': patch
---

docs(spec): the `disabledActions` description names Setup › Packaged Actions, not the retired Setup › Packaged automation page

Clause-②: no
Metadata-protocol: none

The description of `disabledActions`, the key a `GET /api/v1/meta/object/:name` read serves beside `item`, told the reader that an administrator turned those actions off under Setup › Packaged automation. That page is retired: a packaged action's switch is on Setup's Packaged Actions page. The description, and the generated API reference pages built from it (`protocol` and `app-bundle`), now name Setup › Packaged Actions.

Words only. The key's shape, when it is present, and the `ACTION_DISABLED` code are unchanged.
