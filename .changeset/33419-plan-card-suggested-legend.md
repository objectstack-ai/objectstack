---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

fix(plugin-chatbot, i18n): the AI build chat's plan card says what its 「· 补充」 (`· suggested`) field mark means

Clause-②: yes (widening) — the `@object-ui/i18n` packs gain the key `chatbot.plan.suggestedFieldLegend` in all eleven shipped locales. Nothing is removed or narrowed.
Metadata-protocol: none

- On the plan card, a field the user's words did not name is drawn as a dashed chip ending in 「· 补充」 (en `· suggested`), and nothing on the card said what that meant: the chip's tooltip is the field's machine name. When at least one field on the card is suggested, the card now draws one line under its field rows: "Fields marked “suggested” were added by the AI; you didn’t ask for them." (zh-Hans 「标「补充」的字段是 AI 自行补充的，你没有要求。」). A card with no suggested field draws no such line, and the chip's tooltip still shows the machine name.
