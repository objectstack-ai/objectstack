---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

Clause-②: no
Metadata-protocol: none

feat(app-shell): connect your Slack account on the notification settings page, and an admin Slack page in Setup

The console side of Slack direct-message delivery (step 3 of the Slack DM work; the server doors shipped with `@objectstack/service-messaging`'s Slack link routes).

- **Notification Settings: your Slack link.** Where the preference door lists the `slack` channel (only on a deployment that composes connector-slack), the page shows a Slack section. Without an install, or with an install whose token Slack refused, it says so and offers nothing. Otherwise **Connect Slack** asks `POST /api/v1/messaging/me/slack-link/proposal`; the page shows what the door answers: that a Slack user with your verified email was found (never whom), with **Confirm** (`…/confirm`) and **Cancel** (`DELETE /api/v1/messaging/me/slack-link`); or, when nothing was proposed, a sentence naming every reason the door does not tell apart (no verified email, no Slack user with it, or that Slack user linked to someone else). A confirmed link shows the Slack user and **Disconnect**. A refusal is shown in the server's own words (its `userMessage` when it carries one), and the section then reads the door again.
- **Setup's Slack page** (component `messaging:slack`, `/apps/setup/component/messaging/slack`): for an organization administrator holding `setup.write`, the capability the doors ask; anyone else sees what is needed and no door is read. It installs or sets again the organization's bot token (`PUT /api/v1/messaging/slack/account`) through a password input that always starts empty, removes the install after a confirm that says every linked person is told, and lists every link as served (person, Slack user once confirmed, when) with a confirmed **Remove** per link. When the list reaches the 10,000 links the server answers, the page says it may be incomplete.
- Every new sentence is in all eleven built-in locales (`slackLink`, `slackSetup`).
