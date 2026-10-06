---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

Studio's action form now offers `onSuccess` (the route an `api` or `script` action opens once it succeeds, and whether it opens in place or in a new tab) and `outcomeMessages` (a JSON map from each `outcome` the handler returns to the success message shown for it), with their labels and help text translated for `zh-CN`, `ja-JP` and `es-ES`.
