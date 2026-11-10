---
"@object-ui/console": patch
---

Login page: a refused IdP-initiated SAML sign-in (`?error=unsolicited_response`) now tells the user to start sign-in from this system's login page instead of showing the generic single sign-on failure. The technical cause stays behind the details toggle.
