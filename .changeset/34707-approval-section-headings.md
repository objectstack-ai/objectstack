---
'@object-ui/app-shell': patch
---

fix(app-shell): the approval request page heads the submitted record's field groups as real sections, with links to each

Clause-②: no
Metadata-protocol: none

On an approval request page, the "As submitted" card drew each field group's name as small grey text, one pixel larger than the field labels and in the same grey, so a record with many groups read as one long run of fields.

Each titled group is now a heading, a level below "As submitted", drawn the way the object's default record page draws its section titles: semibold, in the foreground colour, with the group's declared icon, over a hairline, and with more space between groups than between fields. The title wraps instead of being cut off on a phone. Every group stays open: a group declared collapsed is not folded here, because the approver decides on the whole record.

When the record has two or more titled groups, a strip of group names sits at the top of the card; a click scrolls to that group. A record with one group shows no strip.

Which fields show, their order, and the "Changed" mark with the current value are unchanged.
