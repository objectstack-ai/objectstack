---
'@objectstack/service-settings': minor
---

feat(service-settings): Setup → AI takes several providers at once, a model list per provider, one default model and one structured-output model

Clause-②: yes (widening)
Metadata-protocol: added

The `ai` settings page chose one provider. It now lets several be on at once. `provider` keeps its key and its stored values and becomes the default provider, always on; every other provider is turned on with its new `<provider>_enabled` toggle, and its section shows while it is on. Each provider keeps its one encrypted key field, never echoed by a read, and gains `<provider>_models`, further model ids one per line beside its existing `<provider>_model`, and its own "Test connection" (`ai/test_<provider>`, a form check until the AI runtime registers the live one). `default_model` picks the default model among the default provider's models, and `structured_output_provider` / `structured_output_model` pick the model strict structured-output calls use, a knob separate from the default model; a blank value means the provider's first model.

A save is refused (`SETTINGS_VALIDATION`, `invalid_value` at the key it changes, `constraint.rule` naming the rule) when the default model is not among the default provider's models, when the structured-output provider is off, or when the structured-output model is not among its provider's models. The refusal is written in the caller's language.

Values stored before these keys existed read unchanged and need no rewrite: a stored `provider` with its `<provider>_model` and none of the new keys is that provider on, that model its only model and the default. `resolveAiModelConfiguration(values)`, exported with `parseAiModelList`, `aiModelRuleBreaches` and `registerAiModelRules`, reads the configuration that way for the AI runtime: the providers that are on with their models, the default model and the structured-output model.
