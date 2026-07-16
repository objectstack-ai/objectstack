---
'@objectstack/platform-objects': minor
'@objectstack/plugin-auth': patch
'@objectstack/spec': patch
---

Close the `@better-auth/oauth-provider` 1.7 schema drift that broke platform
SSO (token exchange 500: `table sys_oauth_access_token has no column named
authorizationCodeId`).

- `sys_oauth_access_token` / `sys_oauth_refresh_token`: add
  `authorization_code_id`, `resources`, `requested_user_info_claims`,
  `confirmation` (+ access-token `revoked`; + refresh-token `rotated_at`,
  `rotation_replay_response`, `rotation_replay_expires_at`).
- `sys_oauth_consent`: add `resources`, `requested_user_info_claims`.
- `sys_oauth_application`: add `jwks`, `jwks_uri`, `backchannel_logout_uri`,
  `backchannel_logout_session_required`, `dpop_bound_access_tokens`.
- New platform objects for the three models 1.7 introduced:
  `sys_oauth_resource`, `sys_oauth_client_resource`,
  `sys_oauth_client_assertion` (RFC 8707 resource indicators + RFC 7523
  client-assertion replay prevention), registered in the auth manifest and
  mapped in `buildOauthProviderPluginSchema()`.
- All camelCase→snake_case `fieldName` mappings extended accordingly, and a
  new parity test (`oauth-provider-schema-parity.test.ts`) fails the build
  whenever a future better-auth bump introduces model fields our objects or
  mappings don't cover.
