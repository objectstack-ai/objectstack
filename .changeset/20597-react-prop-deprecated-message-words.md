---
'@objectstack/lint': patch
---

The `react-prop-deprecated` warning states its reason in words instead of citing a tracker number

The finding `validateReactPageProps` reports for a react-page prop written in a
deprecated react-tier spelling used to end by pointing the author at an issue
number that no longer resolves. It now says what that decision was, in the
sentence being read: the react tier converges on the metadata-tier vocabulary,
so the deprecated spelling keeps working through the deprecation window and is
removed after it. The block tag, the prop and the canonical metadata-tier
spelling it names are unchanged, and so are the rule id, the `warning`
severity, the hint and every other finding.
