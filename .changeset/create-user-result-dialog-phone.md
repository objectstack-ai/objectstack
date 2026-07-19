---
'@objectstack/platform-objects': minor
---

feat(platform-objects): surface phone number in the create_user result dialog

`sys_user`'s `create_user` action now declares `user.phoneNumber` in its
`resultDialog.fields`, so admins creating phone-based accounts see the
sign-in phone number alongside the email and temporary password. The
create-user response carries `phoneNumber` only for phone-based users;
objectui's ActionResultDialog skips declared fields whose path is absent
from the payload, so email-only users see no extra row.
