---
"@objectstack/service-cluster": patch
---

fix(service-cluster): stop `MetadataClusterBridgePlugin` reporting "bridged metadata.changed" over an in-process bus that fans out to nobody (#14021)

`Runtime` registers the `memory` cluster driver by default, so a `cluster`
service is present on an ordinary single-process boot. Lane 1 of the metadata
bridge attached and then logged, unconditionally:

```
MetadataClusterBridgePlugin: bridged metadata.changed → cluster.pubsub (node=<id>)
```

There was no driver check. On the memory driver that claim is a false positive:
the bus keeps its state inside one process, so the fan-out the line announces
reaches nobody. An operator reading it believes cross-node cache invalidation is
on when it is not.

Lane 1 now consults `isInProcessClusterDriver(cluster.driver)` before attaching,
and states the in-process case at `debug` instead:

```
MetadataClusterBridgePlugin: cluster driver "memory" is in-process; metadata.changed fan-out has no peers to reach, skipping
```

This is the shape already in the tree twice — `AuthzClusterBridgePlugin` (#11968)
and this same plugin's lane 2, which was born with the guard (#13331). Both skip
the attach rather than softening the log, and so does this. Nothing observable is
lost by skipping: the only subscriber of `metadata.changed` anywhere in the tree
is the same `MetadataManager` that publishes it, and its loopback guard discards
every message whose `originNode` matches its own node id — which, on an
in-process bus, is every message.

Deliberately unchanged:

- **The seam-missing warn still fires first.** `metadata service does not
  expose attachClusterPubSub(); cross-node cache invalidation disabled` is
  #13331's original boot symptom and other measurements match it byte-for-byte;
  the driver guard is evaluated after it, exactly as in lane 2, so an in-process
  boot with a fallback metadata slot still warns.
- **The level policy stays as ruled.** The authz bridge's header holds the two
  bridges to different bars on purpose: this bridge may stay quiet when a
  cluster service is *absent*, because a missed `metadata.changed` costs a stale
  schema and loses no data. That exemption is about silence and does not licence
  asserting "bridged" when a service is present-but-in-process. The in-process
  arm is therefore `debug`, matching lane 2 — no level is raised.
- **A cross-process driver still claims `bridged`, verbatim**, pinned by a
  reverse control alongside the new in-process pin.
