---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record drawer's per-field save asks for the fields a change makes required

Clause-②: no
Metadata-protocol: none

In the record overlay (`RecordDetailPanel`, and `RecordDetailDrawer` around it), a change that made another field required (`requiredWhen`) while that field was empty went straight to the host's `onFieldSave` and came back refused by the server. The overlay now asks first, in the same fill-in dialog the record page, the list cell and the kanban open: Save writes the change and the typed values in one update guarded with `If-Match` at the version the edit began on, Cancel writes nothing and keeps the edit. A change that makes nothing required still saves at once through `onFieldSave`.

The ask needs one write to put the values in, so `InlineEditSaveBar` asks in its callback mode only when it is also given `dataSource`, `objectName`, `recordId` and `data`; `RecordDetailPanel` now passes them, with a record context naming the object's fields. That one write goes through the data source, not through `onFieldSave`; a host that patches its own list in `onFieldSave` sees it through the data source's mutation event. Without a data source the overlay saves field by field as before.
