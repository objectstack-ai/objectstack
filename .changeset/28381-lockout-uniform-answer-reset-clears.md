---
'@objectstack/plugin-auth': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

fix(plugin-auth): a locked account is answered like a wrong password, a password reset clears the lock, and attempts are counted before they are checked

Clause-②: yes (widening)
Metadata-protocol: none

- **A locked account answers like a wrong password.** A password sign-in for an account the ADR-0069 D2 lockout holds was refused `403 ACCOUNT_LOCKED`. Only an account that exists can be locked, so that answer told anyone who typed an address whether it has an account. It is now refused exactly as a wrong password is: `401 INVALID_EMAIL_OR_PASSWORD`, the same body, and the same password check before the answer. The lock still holds against the correct password, and the account's `login_failed` audit row still records the reason `ACCOUNT_LOCKED`. A deployment that wants the explicit answer sets the new `AuthManagerOptions.lockoutRefusal: 'explicit'` (default `'uniform'`), and is answered `403 ACCOUNT_LOCKED` as before. A sign-in reached outside better-auth's endpoint pipeline cannot be answered uniformly; it is refused `403 ACCOUNT_LOCKED` and logged as a degradation.
- **A completed password reset clears the lock.** A reset through the emailed link or the phone code now clears `failed_login_count` and `locked_until`, so the new password signs in at once. Before, the lock stayed until it ran out or an administrator unlocked it. The second factor's own lock is not cleared by a reset; the administrator's Unlock action still clears both.
- **Attempts that arrive together cannot outrun the lock.** Each attempt is now counted before its password is checked, in one atomic write that also sets the lock when the count reaches the threshold, so at most the threshold's number of attempts reach the password check before the lock holds. A successful sign-in still clears the count, and a refusal that comes after the password passed (an organization's IP list, a ban, an unverified address) still neither counts nor clears. Attempts on a locked account are now counted too; the lock's expiry does not move.
- **The console names the pause.** The sign-in refusal copy (`auth.login.errors.invalidCredentials`) now says that repeated failures pause sign-in for a while and that resetting the password signs in right away, in all 11 console locales (`en`, `zh-Hans`, `zh-Hant`, `ja`, `ar`, `de`, `es`, `fr`, `ko`, `pt-BR`, `ru`).
