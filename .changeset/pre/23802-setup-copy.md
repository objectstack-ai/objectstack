---
'@objectstack/platform-objects': patch
'@objectstack/metadata-core': patch
'@objectstack/service-messaging': patch
---

Clause-②: no

Setup pages describe their records in plain admin sentences. Business Units now reads "Your
company structure — divisions, departments, regions and offices — used to scope data and
reports.", Notification Events "Every notification the platform sent, one row per event.",
Notification Preferences "Which topics and channels each user receives; admins set the
defaults.", Notification Templates "The subject and body each notification topic sends, per
channel and language." and HTTP Deliveries "Outgoing HTTP calls made by webhooks and flows, one
row per call, with its delivery status." Field help on Users, Organizations, Invitations and SSO
Providers, and the metadata-storage and notification-delivery object descriptions, no longer
carry design-record numbers; those references stay in the code comments. The zh-CN, ja-JP and
es-ES translations follow. Wording only: no field, permission or behaviour changes.
