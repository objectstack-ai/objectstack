---
"@objectstack/platform-objects": patch
---

The user, OAuth-application and SSO-provider actions whose endpoint admits only a platform administrator are now offered only to a platform administrator.

Clause-②: no

- These thirteen actions now declare `visible: 'current_user.isPlatformAdmin == true'`, composed with their existing terms:
  - `sys_user`: `ban_user`, `unban_user`, `unlock_user`, `create_user`, `set_user_password`, `impersonate_user` and `set_user_manager`;
  - `sys_oauth_application`: `disable_oauth_application` and `enable_oauth_application`;
  - `sys_sso_provider`: `register_sso_provider`, `register_saml_provider`, `request_domain_verification` and `verify_domain`.
- Where an action also carries `requiresFeature`, the feature gate composes onto it at parse time. For example, `ban_user` now serves `(current_user.isPlatformAdmin == true) && features.admin == true`.
- Each endpoint (`/api/v1/auth/admin/*`) has always admitted a platform administrator alone (ADR-0068) and answered every other caller, org owners and admins included, with 403 `PERMISSION_DENIED`. Before this change the buttons were still shown to those callers.
- `create_oauth_application`, `rotate_client_secret`, `delete_oauth_application` and `delete_sso_provider` are unchanged: their endpoints authorize the signed-in user or the record's owner, not the platform administrator.
- ⛔ Nothing you author changes. The endpoints and the callers they admit are unchanged, and no key, export or parameter is added. The actions' labels are unchanged.
