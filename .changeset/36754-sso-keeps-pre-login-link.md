---
'@object-ui/auth': patch
---

fix(auth): "Sign in with SSO" brings a signed-out person back to the link they opened

Clause-②: no
Metadata-protocol: none

A person who opened a record link while signed out is sent to the sign-in page, which remembers the link. Password and provider-button sign-in took them to it afterwards; signing in with SSO by work email took them to their last app instead. The SSO sign-in now comes back to the sign-in page with that link, the same way the provider buttons do, and the page then takes the person to it. Only a link inside this site is kept: a full web address or one pointing at another host is dropped, and the person lands where any sign-in does. With no link, nothing changes.
