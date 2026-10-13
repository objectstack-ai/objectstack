---
'@objectstack/spec': patch
---

`PageHeaderProps.actions` now says what its list is: the whole set the header draws. An action that declares `record_header` (or `record_more`) in its `locations` but is not named in an authored `page:header`'s `actions` is not drawn in that header, and a header with no `actions` draws none of the object's own actions; a named id whose action declares neither location renders nowhere, and the host's own Edit / Share / Delete chrome is separate from the list. The `.describe()` was "Action IDs to show in header", which read as a filter over the declared placements. Text only: the accepted set of `actions` is unchanged, and no rule or renderer behaviour moves.
