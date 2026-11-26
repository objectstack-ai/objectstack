---
'@objectstack/service-messaging': patch
'@objectstack/platform-objects': patch
---

Clause-②: no
Metadata-protocol: none

feat(messaging): Setup lists the Slack page where connector-slack is composed

- **Setup › Integrations › Slack.** Where connector-slack is composed, Setup now lists a Slack entry under Integrations. It opens the console's Slack page (`messaging:slack`), where an organization administrator installs or replaces the organization's Slack token, removes the install, and reviews or removes each member's Slack link. The entry asks `setup.write`, the capability every Slack administrator door asks. `MessagingServicePlugin` registers it in the same `kernel:ready` hook, and on the same condition, as the `slack` channel. Without connector-slack, Setup lists no Slack entry. The label is translated in every locale the platform ships. The bundle is exported as `SLACK_SETUP_UI_BUNDLE`, with `SLACK_SETUP_COMPONENT_REF`.
- **The Slack link removal topic, on every deployment.** `GET /api/v1/messaging/preference-options` and `GET /api/v1/messaging/me/preferences` list the topic `messaging.slack_link_removed` on every deployment, including one without connector-slack. It is emitted only where connector-slack is composed, when an administrator removes a person's Slack link or removes the organization's Slack install.
