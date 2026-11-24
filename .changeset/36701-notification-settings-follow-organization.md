---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): Notification Settings offers "Follow organization setting" for digest and quiet hours

Clause-②: no
Metadata-protocol: none

Once a member has saved a digest or quiet hours of their own, the Notification Settings page now offers a "Follow organization setting" action beside each one. It empties that field on the member's own general preference (the same empty the Setup grid writes), so the organization's default decides again, including any later change to it. The page then shows the value in force as the organization default. The action appears only where the field is the member's own choice; where there is nothing to clear, it is not drawn.

The member's own general preference itself stays, and so does its on/off; per-topic and per-channel choices are not reset by this action.

New strings `notificationSettings.followOrganization` and `notificationSettings.followOrganizationFor` in all eleven built-in locales.
