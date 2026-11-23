---
'@objectstack/service-messaging': patch
---

feat(service-messaging): inbox messages, notification preferences and templates carry a palette colour

Clause-②: no
Metadata-protocol: none

The console draws an object's icon as a white glyph on a square of the object's palette colour, and an object that declares no `color` is drawn in the neutral `gray`. Until now no built-in object declared one, so every platform object read the same. Inbox messages, notification preferences and notification templates are now `pink` (messaging and notifications).

Each colour is one of the palette names (`OBJECT_COLORS`), picked by business family, not by status: people and organisation `blue`, security and access `purple`, approvals and work routing `orange`, messaging and notifications `pink`, integrations `teal`, reference data and preferences `green`, audit `amber`. Objects nobody opens in the console (credential and token stores, queues, run logs, engine bookkeeping) keep no `color` and stay `gray`. Nothing about the objects' fields, data or API changes.
