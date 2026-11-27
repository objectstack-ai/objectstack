---
'@objectstack/scenarios': patch
'@objectstack/skills': patch
---

feat(qa): the skill-evals grader takes an any-of form, `must_contain_any`; `objectstack-ai` case 6 moves to it

Clause-②: no
Metadata-protocol: none

A skill eval case can now list `assertions.must_contain_any` beside `must_contain` and `must_not_contain`: a list of groups, each a list of tokens, and a group is met when at least one of its tokens is in the answer. Every group is required, so `[["a", "b"], ["c"]]` reads "(`a` or `b`) and `c`". Matching is the same as the other two forms: a literal, case-sensitive substring, nothing normalised, no model judge. The reader refuses a `must_contain_any` that is not a list of groups, a group that is empty or not a list of strings, a group holding an empty token, and a case with no token in any of the three forms. A failing run record names each unmet group whole in `unmetAny` (the key is absent when every group is met), and the round summary prints it in the missed column as `(none of: a / b)`. The runner runs from a checkout only; of `@objectstack/scenarios`, the published README is what changes.

The case hash covers the groups only when a case has any, so every case without the form keeps its hash and `skill-evals --regrade` reads its earlier records as before. A case that gains a group, or has one edited, has a new hash: its earlier records are set apart, and it compares across rounds only after a re-run.

`skills/objectstack-ai/evals/skills-tools-knowledge.json` case 6 (an operator script asked to approve AI pending actions on an API token) now requires one of `ai:approve`, `signed-in session`, `refused` or `never decides` in place of both `signed-in session` and `refused`, which failed correct answers that worded the refusal another way or answered in another language. Its prompt, reference answer and forbidden token are unchanged, and so is the skill text.
