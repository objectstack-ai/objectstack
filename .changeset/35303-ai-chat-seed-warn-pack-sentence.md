---
'@object-ui/app-shell': patch
---

fix(console): the AI chat page's publish warning about failed sample data shows the pack's sentence, never the seed loader's text

Clause-②: no
Metadata-protocol: none

Publishing from the AI chat page warns "Published, but some sample data failed to load." when a seed fails to load. The detail under that title printed the seed loader's own engine text (for example "seed apply stopped at the seed for object …"), and when the loader reported only per-record rows it printed "[object Object]". It now shows the sentence the chat's publish-health line already shows for the same failure (`chatbot.build.health.seedFailed`, from the locale pack), the same sentence *Publish all* shows. The loader's text and its error rows go to the browser console (`console.warn`), never the toast.

No locale keys, props or exports change.
