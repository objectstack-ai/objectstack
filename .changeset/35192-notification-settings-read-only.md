---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): Notification Settings is read-only, with its reason, for a caller who cannot change their notification preferences

Clause-②: no
Metadata-protocol: none

An external member (the `org_external` identity, `external_default` permission set) could open the Account app's Notification Settings page and was shown every switch, the digest choice and the quiet hours as editable, yet each change answered `403`: that set grants no create or edit on `sys_notification_preference`. The page now reads the caller's own grant on that object from the console's permission answer (`/me/permissions`, through `usePermissions()`), and when the caller holds neither a create nor an edit grant it draws the same settings read-only: every control disabled, one visible line saying why (`notificationSettings.readOnly`, in every built-in locale), named by each disabled control as its accessible description, and no write sent.

What does not change: a member and an organization administrator see and use the page as before. With no permission answer mounted, the page stays writable and the server's refusal decides, as every other console grant read does. No metadata key, value, default or permission changes; the server's refusal is unchanged.
