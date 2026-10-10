---
'@objectstack/spec': patch
---

The `submitBehavior.url` docblock in `src/ui/view.zod.ts` no longer names a navigation mechanism

Clause-②: no

The docblock above the redirect `url` check said objectui's `FormPage` performs a verbatim
redirect on this value, and that the value reaching `window.location.assign` is the string with
its tokens substituted. Neither is how the Console behaves at the objectui pin this package
builds against (`20c6d351ad74`): it substitutes each `{{record.…}}` token, URL-escapes the
value, and navigates in-app through its router. The docblock now states the ruled contract
only: relative paths only, interpolation only from declared record fields with every value
URL-escaped, and the resolved relative path is the destination. It says that the navigation
mechanism belongs to each consumer, and marks the pre-ruling `FormPage` behaviour as history.
Comment text only: no schema, key, type, export or `.describe()` string changes.
