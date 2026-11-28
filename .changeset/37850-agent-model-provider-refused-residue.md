---
'@objectstack/skills': patch
'@objectstack/spec': patch
---

docs(skills,spec): an agent's retired `model.provider` is described as refused, naming the one 18.x value that still parses

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai/SKILL.md` (Model Configuration) said that writing `provider` is a parse error. One value is not: the `provider: 'openai'` that a released 18.x toolchain wrote out into every agent `model` block it parsed is accepted and stripped (`acceptRetiredDefaultResidue`); every other value is refused at parse, and `tsc` refuses the key whatever its value. The skill now says the key is retired and refused, names that exception, and keeps the instruction: delete it. The `provider` jsdoc on `AIModelConfigSchema` in `packages/spec/src/ai/agent.zod.ts`, which used the same words, names the exception too. Comment only on the spec side: no schema, type or export changes.

Three `objectstack-ai` eval cases are graded more fairly, with no change to what a correct answer must say:

- Sampling settings (Anthropic, temperature 0.3, 2000 tokens): the forbidden written line is now a set of code spellings (single or double quotes, with or without a trailing comma, and the JSON form), not one. An inline prose warning such as `provider: 'anthropic'` in backticks still passes.
- Nightly approval script: the any-of group also accepts "refuses".
- `run_action` with `confirm: true`: "do not retry" moves into an any-of group with "Do not retry", "don't retry" and "Don't retry"; the grader matches case-sensitively, and correct answers used all four.
