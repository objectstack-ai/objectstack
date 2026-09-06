---
"@objectstack/platform-objects": patch
---

fix(platform-objects): 21 zh-CN metadata-form leaves say what their source says

`zh-CN.metadata-forms.generated.ts` carries 615 leaves that differ from `en` and hold no
digest in `zh-CN.source-hashes.generated.ts` — LEGACY-TRUSTED values carried in from a
pre-consolidation hand vocabulary (`e0077ea36` deleted a 746-line
`src/metadata-translations/zh-CN.ts` and imported its strings) and never reconciled
against the English the same commit range seeded. A census of all 613 (as the population
then stood) found 26 that assert something the source does not, or drop a distinct concept
the source names. Five of the 26 — the whole `dashboard` subtree — landed in `9f57f1e31`.
These are the remaining 21.

They are not stale fills and no gate can see them: a stale fill is a byte copy of a
previous source revision, detectable by cross-locale agreement or a recorded digest, and
these are neither. Nor does re-extraction correct them — bundle merge fills gaps only, and
a present-but-wrong leaf is not a gap.

Three defect kinds, all decided against this bundle's own usage:

- **Asserts an input that does not exist.** `skill.sections.triggers.description` promised
  「触发关键词」 for a section holding only `triggerConditions` (`triggerPhrases` was
  removed with the key); `email_template.fields.variables.helpText` promised a per-variable
  「默认值」 that `EmailTemplateDefinitionVariableSchema` does not declare;
  `action.sections.advanced.description` promised 「批量」 after `bulkEnabled` was removed
  from that section.
- **Names the wrong technology.** `action.fields.body.helpText` said the body is
  「JavaScript 代码」; an L1 expression is not JavaScript. It now reads
  「L1 表达式或 L2 沙箱 JS 体」 — verbatim the sibling `hook.fields.body.helpText`, which
  translates the identical source sentence correctly.
- **Drops a distinct concept the source names.** `object.fields.isSystem.helpText` dropped
  「共享默认为公开」; `view.fields.filter.helpText` reduced a sentence about the shared
  visual builder to 「筛选规则」; `permission.sections.identity.description` dropped both
  sentences explaining how permission sets stack on profiles.

zh-CN only: es-ES and ja-JP are untouched here. The 18 looser paraphrases the census
excluded are also untouched.
