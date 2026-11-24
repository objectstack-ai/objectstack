---
'@object-ui/app-shell': patch
---

fix(console): the *Publish all* warning about a failed runtime check shows the customer's sentence, never the agent's text

Clause-②: no
Metadata-protocol: none

Home's *Publish all* and the draft-preview bar's *Publish* warn "Published, but verification found problems." when a publish's runtime checks (ADR-0038 L3 probes) find an error. The detail under that title printed the finding's `message`, which is English written for the AI agent that repairs the build. It now shows the finding's `userMessage`, the sentence the platform writes for the person who published, in the request's language. When no error carries one, the detail is the generic sentence the AI chat's publish-health line already shows for the same case (`chatbot.build.issuesSummary`, from the locale pack). A finding's `message` and `fix` never reach the toast.

No locale keys, props or exports change.
