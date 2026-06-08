---
"@objectstack/service-settings": major
"@objectstack/plugin-auth": minor
"@objectstack/service-ai": patch
"@objectstack/spec": patch
---

Settings namespace environment overrides now use the canonical ObjectStack
`OS_<NAMESPACE>_<KEY>` form, with no unprefixed aliases. For example,
`ai.openai_base_url` is now `OS_AI_OPENAI_BASE_URL`, and
`feature_flags.ai_enabled` is now `OS_FEATURE_FLAGS_AI_ENABLED`.

The AI service now treats a stored or env-locked `provider=memory` setting as
an explicit override, while the manifest default still leaves boot-time
provider auto-detection intact.

The auth plugin now binds the `auth` settings namespace to better-auth runtime
configuration, exposes an extension hook for provider packages, and includes a
basic Google sign-in implementation configured either in Setup → Authentication
or by deployment-level `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
