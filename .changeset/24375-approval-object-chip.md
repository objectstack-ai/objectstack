---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the approval request page's highlights strip no longer shows the target object's API name

Clause-②: no

- **The strip draws no Object chip.** `sys_approval_request_detail` no longer lists `object_name` on its highlights strip, so a request about an announcement no longer shows `showcase_announcement` there. `object_name` holds the target object's API name, and `sys_approval_request` declares no field that holds that object's label.
- **The page still names the target object, by its label.** The Details tab draws the `record_id` / `object_name` pointer pair as a card of the target record. The card heads the record with its object's label (`Announcement`), translated into the reader's locale and read from the object's definition when the page draws, so a relabelled object shows its new label. Where the reader may not read the target record, or the platform deleted it, the card says so and the page names no object.
- **The object's `highlightFields` drops `object_name` too.** The page's Details tab is a bare `record:details` node, which draws the object's `highlightFields` minus the strip. A change to the strip alone would have moved `object_name` into that tab as a row showing the API name.
- **Unchanged:** `object_name` stays a declared, required field: the approvals machinery queries on it, and it is the type half of the pointer pair. The request list views still show their Object column.

A patch: one entry fewer in one platform object's field list and in its page. No export, type, accepted value, served key or stored column changes.
