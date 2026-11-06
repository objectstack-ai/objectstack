// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IEmailTransport } from '@objectstack/spec/contracts';
import { resolveLocale } from '@objectstack/core';
import { SmtpTransport } from './transports/smtp.js';
import { ResendTransport } from './transports/resend.js';
import { PostmarkTransport } from './transports/postmark.js';

/**
 * The statement Setup → Email makes about the LIVE transport. The page's form
 * shows what is stored, and that can differ from what is live: the out-of-the-box
 * `mail` namespace stores provider `smtp` with an empty host while every message
 * goes to the development log and is recorded as sent. The settings service
 * places this statement at the top of the page (`registerLiveStatus`).
 *
 * Same shape as service-settings' `SettingsLiveStatus`. It is restated here
 * because this plugin reaches the settings service through a structural surface
 * and takes no package dependency on it.
 */
export interface LiveMailTransportStatus {
  label: string;
  bannerText: string;
  bannerSeverity: 'info' | 'warning';
}

/** The part of `EmailService` the statement reads. */
export interface LiveMailTransportSource {
  /** `IEmailService.isConfigured`: does mail sent through the service get delivered? */
  isConfigured(): boolean;
  options: { transport: IEmailTransport };
}

/**
 * The words Setup → Email uses for the live transport and the "Send test
 * email" answer, one entry per language on the platform locale table.
 *
 * Kept here and not in a translation bundle: the sentences are composed per
 * request with the transport's name, the recipient and the message id, and the
 * console's banner lookup would replace a computed live-status text with a
 * fixed one (service-settings' `SETTINGS_LIVE_STATUS_BANNER_ID`). The settings
 * routes pass the caller's display language (`Accept-Language`, else
 * `?locale`); a language with no entry here is answered in English.
 */
export interface MailDeliveryCopy {
  hostTransport: string;
  noMailLabel: string;
  noMailText: string;
  deliveredLabel(name: string): string;
  deliveredText(name: string): string;
  /** "Send test email" succeeded; `via` names the form's transport when the test used it. */
  testSent(to: string, via: string | undefined, id: string): string;
  /** The transport refused or failed the test message, in its own words (`error`). */
  testFailed(via: string | undefined, error: string): string;
  /** The live transport is the development log, and the test used it. */
  testLoggedLive: string;
  /** The form's unsaved "None (log only)" was tested while `liveLabel` is live. */
  testLoggedForm(liveLabel: string): string;
}

/**
 * The keys of {@link MAIL_DELIVERY_COPY}: one per language on the platform
 * locale table (`@objectstack/spec/system` `PLATFORM_LOCALES`). `zh-CN`,
 * `ja-JP` and `es-ES` keep the codes the settings bundle uses; the rest are the
 * table's tags. Core's `resolveLocale` reads a caller's code through that
 * table, so `zh-TW` finds `zh-Hant`, never the Simplified entry.
 */
export type MailDeliveryCopyLocale =
  'en' | 'zh-CN' | 'zh-Hant' | 'es-ES' | 'ar' | 'fr' | 'pt-BR' | 'ru' | 'de' | 'ja-JP' | 'ko';

export const MAIL_DELIVERY_COPY: Record<MailDeliveryCopyLocale, MailDeliveryCopy> = {
  en: {
    hostTransport: 'a transport supplied by the host application',
    noMailLabel: 'No mail leaves this machine',
    noMailText: 'The live transport is the development log. Every message this server sends '
      + '(invitations, password resets, notifications) is recorded in `sys_email` as sent, '
      + 'but none is delivered to anyone. To deliver mail, choose a provider below, complete '
      + 'its settings and save.',
    deliveredLabel: (name) => `Mail is delivered through ${name}`,
    deliveredText: (name) => `The live transport is ${name}. Messages this server sends are handed to it for `
      + 'delivery. A single send can still fail; "Send test email" below reports the provider\'s own answer.',
    testSent: (to, via, id) => `Sent test email to ${to}${via ? ` via ${via}` : ''} (id=${id}).`,
    testFailed: (via, error) => `Test send failed${via ? ` via ${via}` : ''}: ${error}`,
    testLoggedLive: 'No delivery transport is active — the message was only logged and kept in the email log. '
      + 'Configure an SMTP host (or an API provider) and save before testing.',
    testLoggedForm: (liveLabel) => 'Nothing was delivered — the provider on the form is "None (log only)", so the test '
      + 'message was only logged and kept in the email log; no mail left this machine. The live transport was '
      + `not used (${liveLabel}); save the form to stop delivery.`,
  },
  'zh-CN': {
    hostTransport: '宿主应用提供的投递方式',
    noMailLabel: '当前不会发出任何邮件',
    noMailText: '当前的投递方式是开发日志：服务器发出的每封邮件（邀请、密码重置、通知）都会记入邮件日志并标记为已发送，'
      + '但不会送达任何人。要真正投递邮件，请在下方选择服务商，填好其设置并保存。',
    deliveredLabel: (name) => `邮件通过 ${name} 投递`,
    deliveredText: (name) => `当前的投递方式是 ${name}，服务器发出的邮件会交给它投递。`
      + '单次发送仍可能失败；下方的「发送测试邮件」会显示服务商自己的答复。',
    testSent: (to, via, id) => `测试邮件已发送至 ${to}${via ? `，经由 ${via}` : ''}（id=${id}）。`,
    testFailed: (via, error) => `测试发送失败${via ? `（经由 ${via}）` : ''}：${error}`,
    testLoggedLive: '当前没有可用的投递方式：测试邮件只记入了日志，并保存在邮件日志中。'
      + '请先配置 SMTP 主机（或 API 服务商）并保存，再进行测试。',
    testLoggedForm: (liveLabel) => '没有投递任何邮件：表单上的服务商是「不发送(仅记录日志,不真正投递)」，'
      + '测试邮件只记入了日志并保存在邮件日志中，没有邮件发出本机。'
      + `本次测试没有使用当前的投递方式（${liveLabel}）；保存表单后将停止投递。`,
  },
  'zh-Hant': {
    hostTransport: '主應用程式提供的傳送方式',
    noMailLabel: '目前不會寄出任何郵件',
    noMailText: '目前的傳送方式是開發記錄：伺服器寄出的每封郵件（邀請、密碼重設、通知）都會記入郵件記錄並標示為已寄出，'
      + '但不會送達任何人。要真正傳送郵件，請在下方選擇服務商，填好其設定並儲存。',
    deliveredLabel: (name) => `郵件透過 ${name} 傳送`,
    deliveredText: (name) => `目前的傳送方式是 ${name}，伺服器寄出的郵件會交給它傳送。`
      + '單次寄送仍可能失敗；下方的測試郵件按鈕會顯示服務商自己的回覆。',
    testSent: (to, via, id) => `測試郵件已寄至 ${to}${via ? `，經由 ${via}` : ''}（id=${id}）。`,
    testFailed: (via, error) => `測試寄送失敗${via ? `（經由 ${via}）` : ''}：${error}`,
    testLoggedLive: '目前沒有可用的傳送方式：測試郵件只記入了記錄，並保存在郵件記錄中。'
      + '請先設定 SMTP 主機（或 API 服務商）並儲存，再進行測試。',
    testLoggedForm: (liveLabel) => '沒有傳送任何郵件：表單上選的服務商只記錄、不寄送，'
      + '測試郵件只記入了記錄並保存在郵件記錄中，沒有郵件離開本機。'
      + `本次測試沒有使用目前的傳送方式（${liveLabel}）；儲存表單後將停止傳送。`,
  },
  'ja-JP': {
    hostTransport: 'ホストアプリケーションが提供する配信方法',
    noMailLabel: 'このマシンからメールは送信されません',
    noMailText: '現在の配信方法は開発用ログです。このサーバーが送信するすべてのメッセージ（招待、パスワードの再設定、通知）は'
      + 'メールログに送信済みとして記録されますが、誰にも届きません。メールを配信するには、下でプロバイダーを選び、'
      + '設定を入力して保存してください。',
    deliveredLabel: (name) => `メールは ${name} 経由で配信されます`,
    deliveredText: (name) => `現在の配信方法は ${name} です。このサーバーが送信するメッセージは配信のためにこれに渡されます。`
      + '個々の送信が失敗することはあります。下の「テストメール送信」はプロバイダー自身の応答を表示します。',
    testSent: (to, via, id) => `テストメールを ${to} に送信しました${via ? `（${via} 経由）` : ''}（id=${id}）。`,
    testFailed: (via, error) => `テスト送信に失敗しました${via ? `（${via} 経由）` : ''}: ${error}`,
    testLoggedLive: '有効な配信方法がありません。メッセージはログに記録され、メールログに保存されただけです。'
      + 'テストする前に SMTP ホスト（または API プロバイダー）を設定して保存してください。',
    testLoggedForm: (liveLabel) => '何も配信されていません。フォームのプロバイダーが「送信しない(ログのみ — 実際には配信されません)」の'
      + 'ため、テストメッセージはログに記録されてメールログに保存されただけで、このマシンからメールは送信されていません。'
      + `現在の配信方法（${liveLabel}）は使われていません。フォームを保存すると配信が止まります。`,
  },
  'es-ES': {
    hostTransport: 'un transporte proporcionado por la aplicación anfitriona',
    noMailLabel: 'No sale ningún correo de esta máquina',
    noMailText: 'El transporte activo es el registro de desarrollo. Cada mensaje que envía este servidor '
      + '(invitaciones, restablecimientos de contraseña, notificaciones) se registra en el registro de correo como '
      + 'enviado, pero no se entrega a nadie. Para entregar correo, elija un proveedor abajo, complete sus ajustes '
      + 'y guarde.',
    deliveredLabel: (name) => `El correo se entrega a través de ${name}`,
    deliveredText: (name) => `El transporte activo es ${name}. Los mensajes que envía este servidor se le entregan `
      + 'para su envío. Un envío concreto aún puede fallar; «Enviar correo de prueba», abajo, muestra la respuesta '
      + 'del propio proveedor.',
    testSent: (to, via, id) => `Correo de prueba enviado a ${to}${via ? ` a través de ${via}` : ''} (id=${id}).`,
    testFailed: (via, error) => `El envío de prueba ha fallado${via ? ` a través de ${via}` : ''}: ${error}`,
    testLoggedLive: 'No hay ningún transporte de entrega activo: el mensaje solo se registró y se guardó en el '
      + 'registro de correo. Configure un host SMTP (o un proveedor de API) y guarde antes de probar.',
    testLoggedForm: (liveLabel) => 'No se ha entregado nada: el proveedor del formulario es «Ninguno (solo registro — '
      + 'sin entrega real)», así que el mensaje de prueba solo se registró y se guardó en el registro de correo; no '
      + `salió ningún correo de esta máquina. No se usó el transporte activo (${liveLabel}); guarde el formulario para `
      + 'detener la entrega.',
  },
  ar: {
    hostTransport: 'وسيلة نقل يوفّرها التطبيق المضيف',
    noMailLabel: 'لا يخرج أي بريد من هذا الجهاز',
    noMailText: 'وسيلة النقل الفعّالة هي سجل التطوير. كل رسالة يرسلها هذا الخادم (الدعوات، وإعادة تعيين كلمات المرور، '
      + 'والإشعارات) تُسجَّل في سجل البريد على أنها أُرسلت، لكنها لا تصل إلى أحد. لتسليم البريد، اختر موفّرًا أدناه '
      + 'وأكمل إعداداته واحفظ.',
    deliveredLabel: (name) => `يُسلَّم البريد عبر ${name}`,
    deliveredText: (name) => `وسيلة النقل الفعّالة هي ${name}. تُسلَّم إليها الرسائل التي يرسلها هذا الخادم لإيصالها. `
      + 'قد يفشل إرسال بعينه مع ذلك؛ ويعرض زر البريد التجريبي أدناه ردّ الموفّر نفسه.',
    testSent: (to, via, id) => `أُرسل البريد التجريبي إلى ${to}${via ? ` عبر ${via}` : ''} (id=${id}).`,
    testFailed: (via, error) => `فشل الإرسال التجريبي${via ? ` عبر ${via}` : ''}: ${error}`,
    testLoggedLive: 'لا توجد وسيلة تسليم فعّالة، فقد سُجّلت الرسالة فقط وحُفظت في سجل البريد. '
      + 'اضبط مضيف SMTP (أو موفّر API) واحفظ قبل الاختبار.',
    testLoggedForm: (liveLabel) => 'لم يُسلَّم أي شيء: الموفّر المختار في النموذج يكتفي بالتسجيل دون إرسال، لذا '
      + 'سُجّلت الرسالة التجريبية فقط وحُفظت في سجل البريد، ولم يخرج أي بريد من هذا الجهاز. لم تُستخدم وسيلة النقل '
      + `الفعّالة (${liveLabel})؛ احفظ النموذج لإيقاف التسليم.`,
  },
  fr: {
    hostTransport: 'un transport fourni par l’application hôte',
    noMailLabel: 'Aucun e-mail ne quitte cette machine',
    noMailText: 'Le transport actif est le journal de développement. Chaque message envoyé par ce serveur '
      + '(invitations, réinitialisations de mot de passe, notifications) est enregistré comme envoyé dans le journal '
      + 'des e-mails, mais n’est remis à personne. Pour remettre les e-mails, choisissez un fournisseur ci-dessous, '
      + 'complétez ses paramètres et enregistrez.',
    deliveredLabel: (name) => `Les e-mails sont remis via ${name}`,
    deliveredText: (name) => `Le transport actif est ${name}. Les messages envoyés par ce serveur lui sont confiés `
      + 'pour remise. Un envoi isolé peut encore échouer ; le bouton d’e-mail de test ci-dessous affiche la réponse '
      + 'du fournisseur lui-même.',
    testSent: (to, via, id) => `E-mail de test envoyé à ${to}${via ? ` via ${via}` : ''} (id=${id}).`,
    testFailed: (via, error) => `L’envoi de test a échoué${via ? ` via ${via}` : ''} : ${error}`,
    testLoggedLive: 'Aucun transport de remise n’est actif : le message a seulement été journalisé et conservé dans '
      + 'le journal des e-mails. Configurez un hôte SMTP (ou un fournisseur d’API) et enregistrez avant de tester.',
    testLoggedForm: (liveLabel) => 'Rien n’a été remis : le fournisseur choisi dans le formulaire se contente de '
      + 'journaliser, si bien que le message de test a seulement été journalisé et conservé dans le journal des '
      + `e-mails ; aucun e-mail n’a quitté cette machine. Le transport actif n’a pas été utilisé (${liveLabel}) ; `
      + 'enregistrez le formulaire pour arrêter la remise.',
  },
  'pt-BR': {
    hostTransport: 'um transporte fornecido pelo aplicativo hospedeiro',
    noMailLabel: 'Nenhum e-mail sai desta máquina',
    noMailText: 'O transporte ativo é o log de desenvolvimento. Cada mensagem que este servidor envia (convites, '
      + 'redefinições de senha, notificações) é registrada no log de e-mails como enviada, mas não é entregue a '
      + 'ninguém. Para entregar e-mails, escolha um provedor abaixo, preencha as configurações dele e salve.',
    deliveredLabel: (name) => `Os e-mails são entregues por meio de ${name}`,
    deliveredText: (name) => `O transporte ativo é ${name}. As mensagens que este servidor envia são repassadas a ele `
      + 'para entrega. Um envio específico ainda pode falhar; o botão de e-mail de teste abaixo mostra a resposta do '
      + 'próprio provedor.',
    testSent: (to, via, id) => `E-mail de teste enviado para ${to}${via ? ` por meio de ${via}` : ''} (id=${id}).`,
    testFailed: (via, error) => `O envio de teste falhou${via ? ` por meio de ${via}` : ''}: ${error}`,
    testLoggedLive: 'Nenhum transporte de entrega está ativo: a mensagem foi apenas registrada e mantida no log de '
      + 'e-mails. Configure um host SMTP (ou um provedor de API) e salve antes de testar.',
    testLoggedForm: (liveLabel) => 'Nada foi entregue: o provedor escolhido no formulário apenas registra, então a '
      + 'mensagem de teste foi apenas registrada e mantida no log de e-mails; nenhum e-mail saiu desta máquina. O '
      + `transporte ativo não foi usado (${liveLabel}); salve o formulário para interromper a entrega.`,
  },
  ru: {
    hostTransport: 'транспорт, предоставленный приложением-хостом',
    noMailLabel: 'Почта с этой машины не отправляется',
    noMailText: 'Действующий транспорт — журнал разработки. Каждое сообщение, которое отправляет этот сервер '
      + '(приглашения, сброс пароля, уведомления), записывается в журнал почты как отправленное, но никому не '
      + 'доставляется. Чтобы доставлять почту, выберите поставщика ниже, заполните его настройки и сохраните.',
    deliveredLabel: (name) => `Почта доставляется через ${name}`,
    deliveredText: (name) => `Действующий транспорт — ${name}. Сообщения, которые отправляет этот сервер, передаются `
      + 'ему для доставки. Отдельная отправка всё равно может не удаться; кнопка тестового письма ниже показывает '
      + 'ответ самого поставщика.',
    testSent: (to, via, id) => `Тестовое письмо отправлено на ${to}${via ? ` через ${via}` : ''} (id=${id}).`,
    testFailed: (via, error) => `Тестовая отправка не удалась${via ? ` через ${via}` : ''}: ${error}`,
    testLoggedLive: 'Нет действующего транспорта доставки: сообщение только записано в журнал и сохранено в журнале '
      + 'почты. Перед проверкой настройте SMTP-хост (или API-поставщика) и сохраните.',
    testLoggedForm: (liveLabel) => 'Ничего не доставлено: выбранный в форме поставщик только ведёт журнал, поэтому '
      + 'тестовое сообщение лишь записано в журнал и сохранено в журнале почты; ни одно письмо не покинуло эту машину. '
      + `Действующий транспорт не использовался (${liveLabel}); сохраните форму, чтобы остановить доставку.`,
  },
  de: {
    hostTransport: 'ein von der Host-Anwendung bereitgestellter Transport',
    noMailLabel: 'Keine E-Mail verlässt diesen Rechner',
    noMailText: 'Der aktive Transport ist das Entwicklungsprotokoll. Jede Nachricht, die dieser Server sendet '
      + '(Einladungen, Passwortzurücksetzungen, Benachrichtigungen), wird im E-Mail-Protokoll als gesendet '
      + 'verzeichnet, aber niemandem zugestellt. Um E-Mails zuzustellen, wählen Sie unten einen Anbieter, vervollständigen '
      + 'Sie seine Einstellungen und speichern Sie.',
    deliveredLabel: (name) => `E-Mails werden über ${name} zugestellt`,
    deliveredText: (name) => `Der aktive Transport ist ${name}. Nachrichten, die dieser Server sendet, werden ihm zur `
      + 'Zustellung übergeben. Ein einzelner Versand kann trotzdem fehlschlagen; die Test-E-Mail-Schaltfläche unten '
      + 'zeigt die Antwort des Anbieters selbst.',
    testSent: (to, via, id) => `Test-E-Mail an ${to} gesendet${via ? ` über ${via}` : ''} (id=${id}).`,
    testFailed: (via, error) => `Testversand fehlgeschlagen${via ? ` über ${via}` : ''}: ${error}`,
    testLoggedLive: 'Kein Zustelltransport ist aktiv: Die Nachricht wurde nur protokolliert und im E-Mail-Protokoll '
      + 'gespeichert. Richten Sie vor dem Testen einen SMTP-Host (oder einen API-Anbieter) ein und speichern Sie.',
    testLoggedForm: (liveLabel) => 'Nichts wurde zugestellt: Der im Formular gewählte Anbieter protokolliert nur, '
      + 'daher wurde die Testnachricht nur protokolliert und im E-Mail-Protokoll gespeichert; keine E-Mail hat diesen '
      + `Rechner verlassen. Der aktive Transport wurde nicht verwendet (${liveLabel}); speichern Sie das Formular, um `
      + 'die Zustellung zu beenden.',
  },
  ko: {
    hostTransport: '호스트 애플리케이션이 제공하는 전송 방식',
    noMailLabel: '이 머신에서 메일이 나가지 않습니다',
    noMailText: '현재 전송 방식은 개발용 로그입니다. 이 서버가 보내는 모든 메시지(초대, 비밀번호 재설정, 알림)는 메일 '
      + '로그에 보냄으로 기록되지만 누구에게도 전달되지 않습니다. 메일을 전달하려면 아래에서 공급자를 선택하고 설정을 '
      + '입력한 뒤 저장하세요.',
    deliveredLabel: (name) => `메일은 ${name}을(를) 통해 전달됩니다`,
    deliveredText: (name) => `현재 전송 방식은 ${name}입니다. 이 서버가 보내는 메시지는 전달을 위해 여기에 넘겨집니다. `
      + '개별 발송은 여전히 실패할 수 있으며, 아래의 테스트 메일 버튼은 공급자 자신의 응답을 보여 줍니다.',
    testSent: (to, via, id) => `테스트 메일을 ${to}(으)로 보냈습니다${via ? `(${via} 사용)` : ''} (id=${id}).`,
    testFailed: (via, error) => `테스트 발송에 실패했습니다${via ? `(${via} 사용)` : ''}: ${error}`,
    testLoggedLive: '활성화된 전달 방식이 없습니다. 메시지는 로그에 기록되어 메일 로그에 보관되기만 했습니다. '
      + '테스트하기 전에 SMTP 호스트(또는 API 공급자)를 설정하고 저장하세요.',
    testLoggedForm: (liveLabel) => '아무것도 전달되지 않았습니다. 양식에서 선택한 공급자는 로그만 남기므로 테스트 '
      + '메시지는 로그에 기록되어 메일 로그에 보관되기만 했고, 이 머신에서 나간 메일은 없습니다. 현재 전송 '
      + `방식(${liveLabel})은 사용되지 않았습니다. 양식을 저장하면 전달이 중지됩니다.`,
  },
};

const COPY_LOCALES = Object.keys(MAIL_DELIVERY_COPY);

/** The copy for a caller's display language: exact, then by language, else English. */
export function mailDeliveryCopy(locale: string | undefined): MailDeliveryCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return MAIL_DELIVERY_COPY[(picked ?? 'en') as keyof typeof MAIL_DELIVERY_COPY];
}

/** A name an administrator recognises for the live transport. */
function transportName(transport: IEmailTransport, copy: MailDeliveryCopy): string {
  if (transport instanceof SmtpTransport) {
    const { host, port } = transport.describe() as { host?: unknown; port?: unknown };
    return `SMTP (${String(host)}:${String(port)})`;
  }
  if (transport instanceof ResendTransport) return 'Resend';
  if (transport instanceof PostmarkTransport) return 'Postmark';
  return copy.hostTransport;
}

/**
 * Describe the live transport from `isConfigured()`, read at call time, so the
 * statement follows a transport rebuilt from the `mail` namespace, in the
 * caller's display `locale` ({@link mailDeliveryCopy}).
 *
 * `isConfigured()` decides the branch: `false` means no mail leaves this machine,
 * whatever the form says. The transport is read only to name it.
 */
export function describeLiveMailTransport(
  source: LiveMailTransportSource,
  locale?: string,
): LiveMailTransportStatus {
  const copy = mailDeliveryCopy(locale);
  if (!source.isConfigured()) {
    return { label: copy.noMailLabel, bannerSeverity: 'warning', bannerText: copy.noMailText };
  }
  const name = transportName(source.options.transport, copy);
  return { label: copy.deliveredLabel(name), bannerSeverity: 'info', bannerText: copy.deliveredText(name) };
}
