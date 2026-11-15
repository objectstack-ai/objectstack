---
'@objectstack/skills': patch
---

docs(skills): the navigation rule teaches the approvals inbox entry the way the platform's Account app writes it, gated on the approvals service

Clause-②: no
Metadata-protocol: none

`objectstack-ui`'s navigation rule taught the approvals entry as a `type: 'object'` item on `sys_approval_request` gated by `requiresObject: 'sys_approval_request'`. An app that copied it hid the entry from every non-administrator approver until some approval request already involved them: the object metadata read answers 404 to them until then, and the console prunes a `requiresObject` entry against the objects it is served. The rule now teaches the inbox component, `{ type: 'component', componentRef: 'approvals:inbox', requiresService: 'approvals' }` (the shape of `nav_account_approvals` in `@objectstack/platform-objects`), which the server keeps in the served navigation whenever plugin-approvals registers its `approvals` service, and says in one line why `requiresObject` is wrong here. The matching eval expects the same shape. No schema or runtime change.
