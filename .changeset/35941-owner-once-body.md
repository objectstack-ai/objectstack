---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record page names the owner once when a details section already shows the owner field

Clause-②: no
Metadata-protocol: none

On the default record page, the meta line at the foot of the details column (created · updated · owner · id) always named the record's owner, and a details section usually showed the `owner_id` field as well: in a declared field group, in the "Other" group that collects fields no declared group takes, or in the derived section of an object that declares no groups. So the owner was shown twice. The meta line already left the owner out when the highlight strip showed it, and the default page no longer draws a strip, so that rule never applied.

The meta line now also leaves the owner out when a details section of the page's own record draws the `owner_id` row. The owner then shows once, as the section's field, where it can also be changed. The sections report the rows they actually draw, so the owner stays on the meta line whenever no section draws it: the field is hidden, the reader may not read it, a `visibleWhen` hides it or its group, or its section is collapsed. When a collapsed section holding it is opened, the owner moves from the meta line to that section. The field groups are drawn as declared. The highlight strip rule is unchanged.

This changes the laid-out default record page, the one `RecordPageColumns` draws. A default page whose tab strip cannot be laid out keeps the strip-only rule. No metadata key, value or default changes, and no prop, export or locale key is added.
