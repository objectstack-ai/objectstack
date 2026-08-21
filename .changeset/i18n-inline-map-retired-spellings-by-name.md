---
"@objectstack/spec": minor
---

fix(spec): reject the retired `key`/`defaultValue` spellings in inline locale maps BY NAME, in any combination — and stop claiming the retired form "resolves to nothing" (#10492)

Two legs, both on `InlineLocaleMapSchema` in `packages/spec/src/ui/i18n.zod.ts`:

1. **Message accuracy.** The `INLINE_LOCALE_KEY` rejection message said the
   retired key-reference form (#5055) "resolves to nothing". Measured false:
   both resolvers — `resolveI18nLabel` here and objectui's `pickLocalized`,
   parity-pinned — fall through to their last resort (first string value, in
   key insertion order) and return the raw dotted key, which renders as the
   visible label. The message now states the measured behaviour.

2. **Enforcement hole closed.** `key` is three letters — syntactically a valid
   BCP-47 primary subtag — so `{ key: 'common.save' }` alone parsed as a
   "language `key` inline locale map" and painted `common.save` on screen; the
   pair form was rejected only because `defaultValue` fails the tag grammar.
   The key pattern now refuses the two retired spellings by name, in any
   combination, matching the emitted type's `{ key?: never; defaultValue?:
   never }` narrowing (#9925, maintainer ruling 2026-08-19, option B). This is
   an enforcement gap of the #5055 retirement, not a new contract: nothing else
   is denied — real 2–3 letter subtags (`deu`, `fra`, `yue`) still parse.

FROM → TO: a label authored as `{ key: '<i18n.key>' }` (or any inline map
carrying a `key`/`defaultValue` entry) is now refused at parse time with the
named message; write the inline locale map form `{ en: '…', 'zh-CN': '…' }`,
or a plain string resolved through a translation bundle. This is the same
prescription the #5055 retirement and the #9925 type narrowing already carry —
the runtime now enforces what the type already refused.

<!-- adr-0087: not-required (already-registered ui-widget-i18n-family-retired) the key-reference dialect's retirement record already carries this prescription; this change closes its runtime enforcement gap, no new migration -->
