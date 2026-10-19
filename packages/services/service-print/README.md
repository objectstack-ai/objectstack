# @objectstack/service-print

Prints a record's print page to a PDF in headless Chromium, as the requesting
user, and archives it as a file attached to the record.

```ts
import { PrintServicePlugin } from '@objectstack/service-print';

plugins: [new PrintServicePlugin()];
```

| Setting | Option | |
|:---|:---|:---|
| `OS_PRINT_CHROMIUM_PATH` | `chromiumPath` | A local Chromium executable (local placement) |
| `OS_PRINT_BROWSER_ENDPOINT` | `browserEndpoint` | A remote browser's DevTools WebSocket endpoint (remote placement) |
| `OS_PRINT_CONSOLE_URL` | `consoleUrl` | The console's URL as that browser reaches it, `/_console` included |

Configure one placement. The plugin probes the engine at startup and reports an
absent, misconfigured or unreachable one once, with the setting to fix.

```ts
const print = kernel.getService<IPrintService>('print');
await print.printRecordToFile({ app, object, recordId, page }, context);
```

The plugin also mounts `POST /api/v1/print/records` on the kernel's HTTP server:
the same request as a JSON body, printed as the signed-in caller, answering
`201` with the stored file. A console `type: 'api'` action targets it.

Documentation: [Print Pages](https://objectstack.ai/docs/ui/print-pages).
