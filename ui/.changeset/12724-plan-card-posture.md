---
"@object-ui/plugin-chatbot": minor
---

Clause-②: yes
Metadata-protocol: none

The AI build chat's plan card now says how the build will land. When `propose_blueprint`'s `planCard` carries `posture` (objectstack-ai/cloud#2924 ruling A), its `line` (e.g. "This first build goes live at once; later changes are saved as drafts for you to publish") is drawn as the last item of the assumptions list. The exported `ProposedPlanCard` type gains the optional `posture: { mode: 'publish' | 'draft'; line: string }`. A plan card without the key draws as before (objectui#12724).
