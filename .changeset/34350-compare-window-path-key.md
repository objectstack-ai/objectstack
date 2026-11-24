---
'@object-ui/plugin-dashboard': patch
'@objectstack/service-analytics': patch
---

fix(plugin-dashboard): a compare widget dated on a related record's field is served through the dataset's declared date dimension over that path

Clause-②: no
Metadata-protocol: none

A dataset-bound compare widget (`compareTo`) sends its date window to the dataset query under the filtered field's name. The dataset query answers only declared dimensions, and a dimension name has no dot, so a window on a related record's field, such as `account.founded_at`, was refused with `400 INVALID_FIELD`.

When such a key is in the window, the widget now reads the dataset definition and sends the window under the one declared dimension with `type: 'date'` and `field` equal to that path (for example `{ name: 'account_founded', field: 'account.founded_at', type: 'date' }`). A `compareTo.dimension` that names the window by the path or by that declared name is sent as the declared name. When no declared date dimension covers the path, or two or more do, the key is sent as authored and the dataset query still refuses it. Keys that can be dimension names, such as `close_date`, are never renamed, and widgets whose window has no such key read nothing extra.

To serve a compare widget dated on a related record's field, declare one date dimension over that path on the dataset.

The dataset query's `400 INVALID_FIELD` refusal for a comparison-window date key that cannot be a dimension name no longer says the comparison cannot run unless the date field is a field of the dataset's own object; it names the remedy that exists: declare one date dimension over that field (`type: 'date'`, `field` set to it, any snake_case name, the relationship in the dataset's `include`) and name it in `timeDimensions`, which a dashboard compare widget then does itself. The refusal's code, status and when it fires are unchanged.
