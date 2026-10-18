---
'@objectstack/service-settings': patch
---

Clause-②: no

fix(service-settings): the Setup settings pages name the organization or the environment where they said "workspace"

- **What changed.** The built-in settings manifests and their en, zh-CN, ja-JP and es-ES bundles no longer say "workspace" (工作区, ワークスペース, espacio de trabajo). Each string now uses the noun for what the setting belongs to:
  - **Organization** (组织 / 組織 / organización): the Branding name field, now **Organization name**, and the Branding description; the Company legal-name help; the Feature Flags description. These settings are stored once per organization.
  - **Environment** (环境 / 環境 / entorno): the Provider section of Mail and of SMS. These settings are stored once for the running instance.
  - Authentication, New user membership: the help now names the explicit act as **creating an organization**.
- **Unchanged:** every setting key, including `branding.workspace_name` and its `OS_BRANDING_WORKSPACE_NAME` override; stored values; the Settings hub `category` values; the keys and shape of the translation bundles; and the exports. Only the text a reader sees changed.
