---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's disabled Publish says why there is nothing to publish, on hover and on keyboard focus, the way it already does on a read-only package

Clause-②: no
Metadata-protocol: none

With no drafts pending, the Studio header's Publish button was natively disabled and carried its reason ("No drafts pending publish") only as a `title` on the button itself. A disabled button fires no hover or focus events, so no tooltip opened and Tab skipped Publish entirely. It now takes the read-only state's treatment: a focusable wrapper that is the tooltip trigger and a tab stop, with the wrapper and the button both described by the existing `sr-only` reason. The text is the existing `engine.studio.publishNoneTitle` sentence; no locale key is added.

The read-only state is unchanged, a pending draft still shows the plain enabled Publish button, and a publish in flight keeps its spinner without a wrapper.
