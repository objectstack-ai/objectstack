---
'@object-ui/app-shell': patch
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

fix(console): every object route words an object you cannot open the same neutral way, and the list filter's empty state is translated

Clause-②: no
Metadata-protocol: none

The server answers an object you cannot read exactly like a name that does not exist, so the console never tells them apart. But the sentence it drew still said the object does not exist. That sentence was spread over two keys: one for the list and data routes, and another, longer one for the record and create routes. All four routes now draw one key, `console.objectView.objectNotFoundDescription`, and it says what is true in both cases: "The object "NAME" does not exist, or you do not have access to it." It is translated in all eleven built-in languages (zh-Hans: 对象"NAME"不存在，或者您无权访问它。). `empty.objectNotFoundDescription` is retired from every pack. The list route's hint and the disabled-package sentence are unchanged.

A list's dropdown filter for a field with no options showed a hard-coded English "No options", even in a Chinese console. It now reads the pack's `fields.options.empty` ("No options available", 暂无可选项), the same key the form's options empty state uses.
