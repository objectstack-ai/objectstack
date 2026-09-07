---
"@objectstack/platform-objects": patch
---

`sys_email.highlightFields` names the recipient column that exists, so the platform's own email log stops rendering one column short (#15629)

The list read `['subject', 'to', 'status', 'sent_at']`. Three of those four resolve; `to` does not — `sys_email`'s recipient column is `to_addresses`. It now reads `['subject', 'to_addresses', 'status', 'sent_at']`, and nothing else about the object moved.

`highlightFields` is the object's ordered "most important fields" pointer (ADR-0085): it drives the default list columns, record cards, previews and the detail highlight strip. Every consumer **silently skips** an entry it cannot resolve — nothing throws and nothing logs — so each of those surfaces rendered one field short, and the field missing from the platform's own outbound-email log was the recipient.

There was a second, louder consequence that nobody could reach by accident. Since `object-field-ref-unknown` crossed onto the object write door (#15254), this body could not be republished through `PUT /api/v1/meta/object` or a package publish: the door answers `422 INVALID_METADATA`. `sys_email` reaches the runtime as a code-shipped registry object instead — `EmailServicePlugin` hands it to the manifest service, a path that runs no authoring gate — so boot was never affected and no deployment was failing. It was a trap laid for whoever next edited the object through a door rather than the file.

`sys-email.highlight-fields-resolve.test.ts` pins it through that real door rather than by comparing the array against `Object.keys(fields)`: it runs `runRuntimeAuthoringRules({ type: 'object' })` over the shipped declaration with the audit module's other objects as resolution context, and a control case restores the old entry and requires the same call to refuse it — so a green result means the door read this object and accepted it, never that nothing looked.
