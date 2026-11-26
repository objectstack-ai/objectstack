---
'@object-ui/app-shell': patch
---

fix(console): the *Publish all* warning about failed sample data shows the pack's sentence, never the seed loader's text

Clause-②: no
Metadata-protocol: none

Home's *Publish all* and the draft-preview bar's *Publish* warn "Published, but some sample data failed to load." when a seed fails to load. The detail under that title printed the seed loader's own engine text (for example "seed apply stopped at the seed for object …"), and for a package-less seed with no text a hard-coded English "NAME: sample data failed to load" in every language. It now shows the sentence the AI chat's publish-health line already shows for the same failure (`chatbot.build.health.seedFailed`, from the locale pack), on both the package batch and the package-less publish. The loader's text never reaches the toast.

No locale keys, props or exports change.
