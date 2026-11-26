---
'@object-ui/core': patch
---

fix(core): a date macro inside a longer string is a literal on the client too

Clause-②: no
Metadata-protocol: none

`resolveDateMacros` resolves a filter value only when the whole value is one placeholder (`'{today}'`, `'${today}'`, `'{7_days_ago}'`). A value that merely contains one, such as `'from {today} on'`, is now returned as written. Before, the client replaced the macro inside the string while the server's resolver left it literal, so the same filter matched different rows in the console and on the server. This is the reading the spec declares for filter placeholders: a value that merely contains braces is untouched.

A previous-period comparison (`shiftFilterByCompareTo`) follows the same reading: it renames only whole-value tokens, so the comparison query filters on the same literal as the current one.
