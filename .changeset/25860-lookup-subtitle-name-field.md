---
'@object-ui/fields': patch
---

fix(fields): a lookup's option subtitle no longer repeats the record name when the referenced object's name field is not `name`

Clause-②: no
Metadata-protocol: none

The quick-picker shows each candidate as its title over a subtitle of the referenced object's other columns. A lookup that declares no `displayField` titles the option through the referenced object's name field (`nameField`, else the derived title field), but the subtitle skipped only a field literally called `name`. On an object whose name field is `title`, `customer_name` or any other name (every AI-built object), the subtitle's first and widest slot repeated the title and pushed the column that tells two records apart, such as a phone number, into truncation.

The subtitle now also skips the referenced object's resolved name field when the lookup declares no `displayField`. Unchanged: a declared `displayField` is the field skipped, so the object's name field stays in the subtitle; an object titled by a `titleFormat` template keeps every field in the subtitle; an explicitly authored `descriptionField` still leads the subtitle.

What to do: nothing.
