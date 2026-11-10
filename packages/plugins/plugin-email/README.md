# @objectstack/plugin-email

The email service: `IEmailService` with transport-pluggable outbound delivery and `sys_email` persistence of every message sent. `EmailServicePlugin` registers the service with the kernel.

```typescript
import { EmailServicePlugin } from '@objectstack/plugin-email';
```

Documentation: [Email service](https://objectstack.ai/docs/kernel/runtime-services/email-service)

## Deciding where SMTP may connect

`smtpConnect` lets the host decide where every SMTP transport the plugin builds may connect: the one built at boot, the one built from saved Mail settings, and the one a "Send test email" press builds. It is a constructor option, so it applies to a plugin instance the host registers itself; with that instance in the stack's `plugins`, `os serve` builds no second email plugin:

```typescript
import { EmailServicePlugin, type SmtpConnectPolicy } from '@objectstack/plugin-email';

const smtpConnect: SmtpConnectPolicy = {
  getSocket({ host, port }, callback) {
    // Refuse: callback(new Error('…')) — the failed send, and the test answer, carry this message.
    // Admit: open the socket yourself (openAllowedSocket is the host's own) and hand it back.
    const socket = openAllowedSocket(host, port);
    socket.once('connect', () => callback(null, { connection: socket }));
    socket.once('error', (err) => callback(err));
  },
};

new EmailServicePlugin({ provider: 'smtp', providerOptions: { host: 'smtp.example.com' }, smtpConnect });
```

- `getSocket` is asked for every connection, with the configured `host` and `port`. It admits a connection by handing back the socket it opened; TLS and STARTTLS still run against the configured host name.
- It is applied last, after any `transportOptions`. While it is set, `transportOptions` that choose the socket or the transport kind themselves (`proxy`, `url`, `sendmail`, `streamTransport`, `jsonTransport`, `SES`, `connection`, `socket`) and an OAuth2 `auth` are refused when the transport is built.
- Without it, SMTP connects exactly as before.
