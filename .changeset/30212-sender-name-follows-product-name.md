---
'@objectstack/plugin-email': patch
'@objectstack/service-settings': patch
---

fix(plugin-email,service-settings): mail whose sender has no From name goes out under the product name, not "ObjectStack"

Clause-②: no
Metadata-protocol: none

- **Now.** A default sender with no display name of its own goes out under the product name the auth mails' subject and body already use: the Setup → Branding product name when an administrator set one, else the deployment's name (`OS_APP_NAME`, then `config.email.appName`, `config.email.defaultTemplateContext.appName` and the top-level `appName`), else `ObjectStack`. A Branding save renames the sender on the next mail, with no restart. The "Send test email" button sends under the same name.
- **Which senders.** The sender saved in Setup → Mail with the From name left empty, and a sender declared at boot without a name (`OS_EMAIL_FROM=no-reply@acme.com`, or `config.email.defaultFrom` with an `address` alone). Before, the first went out as `ObjectStack <…>` and the second with no display name.
- **Unchanged.** A From name somebody set always wins: one saved in Setup → Mail, or one declared at boot (`OS_EMAIL_FROM="Acme <no-reply@acme.com>"`, `config.email.defaultFrom.name`). A sender a send names itself, and a template's own sender, are never renamed. Under a walled tenancy posture, where Setup → Branding is not offered, the deployment's name applies.
- **`@objectstack/service-settings`.** Setup → Mail → From name no longer has the default `ObjectStack`: an unsaved field reads empty, and `GET /api/settings/mail` answers `from_name` as `value: null`, `source: 'default'`. The field's help says that an empty value uses the product name. A From name saved earlier is kept and still wins; clear the field to follow the product name.
