---
"@objectstack/spec": minor
---

Retire the "ObjectOS" layer name from the spec's public surface — the control layer is the **Kernel**; ObjectOS now exclusively names the commercial runtime environment.

Renames (deprecated aliases kept for one release, so existing imports keep compiling):

- `ObjectOSCapabilitiesSchema` → `KernelCapabilitiesSchema`
- `ObjectOSCapabilities` (type) → `KernelCapabilities`
- `ObjectOSKernel` (interface) → `IKernel` (`PluginContext.os` is now typed as `IKernel`)

Migration: replace the old names with the new ones — a find/replace of the three identifiers above is sufficient; runtime behavior, schema shapes, and JSON output are unchanged. TSDoc and generated reference docs now say "the ObjectStack runtime" / "Kernel" instead of "ObjectOS" (product mentions like ObjectOS Cloud in the Cloud protocol domain are unchanged).
