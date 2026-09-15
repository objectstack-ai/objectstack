---
'@objectstack/service-messaging': patch
---

Mount the email and SMS channels per lookup instead of deciding once at `kernel:ready`

The messaging plugin registered its email and SMS channels behind `if (getEmail())` /
`if (getSms())` inside a `kernel:ready` hook. That guard ran exactly once, so a transport
service that registered later in the same boot — from a plugin ordered after this one, from
`kernel:bootstrapped` / `kernel:listening`, or at runtime — never got its channel, and every
`notify` naming that channel was refused as "not registered" for the life of the process.

`MessagingService.registerChannelProvider(id, resolve)` mounts a channel that is resolved on
every lookup, and the plugin now mounts both channels through it: the mount tracks the
transport instead of recording a verdict about it, and the dispatcher — which has always
looked channels up dynamically — picks up a late transport without a restart. A composition
that never registers the transport is unchanged: the channel is not mounted, fan-out refuses
it, no delivery row is written, and nothing is recorded in
`sys_notification.suppressed_channels`.
