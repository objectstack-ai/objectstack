---
"@objectstack/plugin-auth": patch
"@objectstack/client": patch
---

fix(auth): single-source Console page-URL construction; correct SMS + OAuth-callback landing paths

Root-cause hardening after the invitation-link fixes. Every user-facing link
to a Console page is `${origin}${uiBasePath}${path}`, but that composition was
hand-written at each call site — which is how the scheme / `/_console` prefix
kept getting dropped one link at a time.

**plugin-auth**
- New single-source `getConsolePageUrl(path)` helper; `loginPage`,
  `consentPage`, device `verificationUri` and the invitation accept URL all
  compose through it, so future page links can't drift.
- Phone-invite SMS now links to the actual Console sign-in page
  (`${origin}${uiBasePath}/login`) via a new `{{loginUrl}}` template variable
  instead of the bare origin. `{{baseUrl}}` is still provided for backward
  compatibility with tenant-overridden templates.

**client**
- `signInWithProvider` now defaults `callbackURL` to the current page
  (`window.location.href`) instead of a hard-coded `origin + '/login'`. The
  SDK cannot know the app's mount path (Console lives under `/_console`), so
  returning the user to where they started is the only base-path-correct
  default; it also mirrors `linkSocial`. Pass an explicit `callbackURL` to
  override.
