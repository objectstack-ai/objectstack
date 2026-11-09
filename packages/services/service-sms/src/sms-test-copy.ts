// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveLocale } from '@objectstack/core';

/**
 * The sentences Setup → SMS → "Send test SMS" (`sms/test`) answers with, one
 * entry per language on the platform locale table
 * (`@objectstack/spec/system` `PLATFORM_LOCALES`).
 *
 * The console prints the action's `message` as the toast, bare, so the
 * sentence is the administrator's whole answer. The settings action route
 * hands the handler the caller's display language (`Accept-Language`, else
 * `?locale`) as the input's `locale`; an absent locale, or one naming no
 * language here, is answered in English, the sentence every caller got before.
 * The four languages the settings bundle ships keep its codes (`zh-CN`,
 * `ja-JP`, `es-ES`); the rest use the table's tags. Core's `resolveLocale`
 * reads a caller's code through that table, so `zh-TW` finds `zh-Hant`, never
 * the Simplified entry.
 *
 * Only the sentences the product writes live here. A provider's or the data
 * engine's own error text is passed through verbatim: on its own in English,
 * as it always was; in another language behind a lead-in that says what
 * failed. The operator log lines stay English.
 */
export interface SmsTestCopy {
  /** An API caller's `to` is not a phone number. */
  invalidTo: string;
  /** No one is signed in on the call, so there is no admin number to send to. */
  noSignedIn: string;
  /** No data engine is up to read the caller's number. */
  noEngine: string;
  /** Reading the caller's number failed; `reason` is the engine's own text. */
  readFailed(reason: string): string;
  /** The caller's account carries no phone number. */
  noNumber: string;
  /** The form's provider lacks a credential (`key`, the settings key). */
  missing(provider: string, key: string): string;
  /** The provider's transport could not be built; `reason` is its own text. */
  buildFailed(provider: string, reason: string): string;
  /** The live transport is the log, so nothing was sent. */
  logOnly: string;
  /** Sent to the masked number; `via` the form's provider, absent for the deployment's configured transport. */
  sent(to: string, via: string | undefined, id: string): string;
  /** The send failed; `reason` is the provider's own text, when it gave one. */
  failed(reason: string | undefined): string;
}

/** The table's keys: the platform locale table's languages, three under the settings bundle's codes. */
export type SmsTestCopyLocale =
  'en' | 'zh-CN' | 'zh-Hant' | 'es-ES' | 'ar' | 'fr' | 'pt-BR' | 'ru' | 'de' | 'ja-JP' | 'ko';

export const SMS_TEST_COPY: Record<SmsTestCopyLocale, SmsTestCopy> = {
  en: {
    invalidTo: 'Provide a valid "to" phone number (E.164 recommended).',
    noSignedIn: 'No recipient — nothing was sent. The test SMS goes to the signed-in admin\'s own phone number, '
      + 'and no one is signed in on this call. Sign in as an admin whose account has a phone number, then '
      + 'press Send test SMS again.',
    noEngine: 'No data engine is available to read your account\'s phone number — nothing was sent. '
      + 'The test SMS goes to the signed-in admin\'s own number, so it can be sent only once that number '
      + 'can be read; press Send test SMS again when the data service is up.',
    readFailed: (reason) => `Could not read your account's phone number to send the test SMS to (${reason}) `
      + '— nothing was sent. The test SMS goes to the signed-in admin\'s own number; press Send test SMS '
      + 'again once your account can be read.',
    noNumber: 'Your account has no phone number, and the test SMS is sent to the signed-in admin\'s own number '
      + '— nothing was sent. A number is on an account only where phone sign-in is enabled: press Send test SMS '
      + 'while signed in as an admin whose account has a phone number.',
    missing: (provider, key) => `${provider}: missing ${key}.`,
    buildFailed: (provider, reason) => `Failed to build ${provider} transport: ${reason}`,
    logOnly: 'No SMS delivery transport is active (provider: None — log only), so the test SMS was NOT sent. '
      + 'Pick a provider, fill in its credentials and save before testing.',
    sent: (to, via, id) => `Sent test SMS to ${to} via ${via ?? 'the deployment\'s configured transport'} (id=${id}).`,
    failed: (reason) => reason ?? 'Send failed.',
  },
  'zh-CN': {
    invalidTo: '请提供有效的 "to" 手机号码（建议使用 E.164 格式）。',
    noSignedIn: '没有收件人，未发送任何短信。测试短信会发到当前登录管理员自己的手机号，而这次调用没有登录用户。'
      + '请以账户里有手机号的管理员身份登录，再点击「发送测试短信」。',
    noEngine: '没有可用的数据引擎来读取你账户的手机号，未发送任何短信。测试短信会发到当前登录管理员自己的手机号，'
      + '只有能读到该号码时才能发送；请在数据服务可用后再点击「发送测试短信」。',
    readFailed: (reason) => `无法读取你账户的手机号来发送测试短信（${reason}），未发送任何短信。`
      + '测试短信会发到当前登录管理员自己的手机号；请在能读取你的账户后再点击「发送测试短信」。',
    noNumber: '你的账户没有手机号，而测试短信会发到当前登录管理员自己的手机号，因此未发送任何短信。'
      + '只有启用了手机号登录，账户上才会有号码：请以账户里有手机号的管理员身份登录后再点击「发送测试短信」。',
    missing: (provider, key) => `${provider}：缺少 ${key}。`,
    buildFailed: (provider, reason) => `无法创建 ${provider} 投递方式：${reason}`,
    logOnly: '当前没有可用的短信投递方式（服务商：无，仅记录日志），因此测试短信没有发送。'
      + '请先选择服务商、填写其凭据并保存，再进行测试。',
    sent: (to, via, id) => `测试短信已发送至 ${to}，经由${via ? ` ${via}` : '部署配置的投递方式'}（id=${id}）。`,
    failed: (reason) => (reason ? `测试短信发送失败：${reason}` : '测试短信发送失败。'),
  },
  'zh-Hant': {
    invalidTo: '請提供有效的 "to" 手機號碼（建議使用 E.164 格式）。',
    noSignedIn: '沒有收件人，未傳送任何簡訊。測試簡訊會傳到目前登入管理員自己的手機號碼，而這次呼叫沒有登入使用者。'
      + '請以帳戶中有手機號碼的管理員身分登入，再按一次傳送測試簡訊。',
    noEngine: '沒有可用的資料引擎來讀取你帳戶的手機號碼，未傳送任何簡訊。測試簡訊會傳到目前登入管理員自己的手機號碼，'
      + '只有能讀到該號碼時才能傳送；請在資料服務可用後再按一次傳送測試簡訊。',
    readFailed: (reason) => `無法讀取你帳戶的手機號碼來傳送測試簡訊（${reason}），未傳送任何簡訊。`
      + '測試簡訊會傳到目前登入管理員自己的手機號碼；請在能讀取你的帳戶後再按一次傳送測試簡訊。',
    noNumber: '你的帳戶沒有手機號碼，而測試簡訊會傳到目前登入管理員自己的手機號碼，因此未傳送任何簡訊。'
      + '只有啟用了手機號碼登入，帳戶上才會有號碼：請以帳戶中有手機號碼的管理員身分登入後再按傳送測試簡訊。',
    missing: (provider, key) => `${provider}：缺少 ${key}。`,
    buildFailed: (provider, reason) => `無法建立 ${provider} 傳送方式：${reason}`,
    logOnly: '目前沒有可用的簡訊傳送方式（服務商：無，僅記錄），因此測試簡訊沒有傳送。'
      + '請先選擇服務商、填寫其憑證並儲存，再進行測試。',
    sent: (to, via, id) => `測試簡訊已傳送至 ${to}，經由${via ? ` ${via}` : '部署設定的傳送方式'}（id=${id}）。`,
    failed: (reason) => (reason ? `測試簡訊傳送失敗：${reason}` : '測試簡訊傳送失敗。'),
  },
  'ja-JP': {
    invalidTo: '有効な "to" 電話番号を指定してください（E.164 形式を推奨）。',
    noSignedIn: '宛先がないため、何も送信されていません。テスト SMS はサインイン中の管理者自身の電話番号に送られますが、'
      + 'この呼び出しには誰もサインインしていません。電話番号が登録されたアカウントの管理者としてサインインし、'
      + 'もう一度「テスト SMS を送信」を押してください。',
    noEngine: 'アカウントの電話番号を読み取るデータエンジンがないため、何も送信されていません。テスト SMS はサインイン中の'
      + '管理者自身の番号に送られるため、その番号を読み取れるようになるまで送信できません。データサービスが起動してから、'
      + 'もう一度「テスト SMS を送信」を押してください。',
    readFailed: (reason) => `テスト SMS の送信先としてアカウントの電話番号を読み取れませんでした（${reason}）。`
      + '何も送信されていません。テスト SMS はサインイン中の管理者自身の番号に送られます。アカウントを読み取れるように'
      + 'なってから、もう一度「テスト SMS を送信」を押してください。',
    noNumber: 'アカウントに電話番号がなく、テスト SMS はサインイン中の管理者自身の番号に送られるため、何も送信されていません。'
      + '電話番号ログインが有効な場合にのみアカウントに番号が登録されます。電話番号が登録されたアカウントの管理者として'
      + 'サインインした状態で「テスト SMS を送信」を押してください。',
    missing: (provider, key) => `${provider}: ${key} が指定されていません。`,
    buildFailed: (provider, reason) => `${provider} の配信方法を作成できませんでした: ${reason}`,
    logOnly: '有効な SMS 配信方法がない（プロバイダー: なし — ログのみ）ため、テスト SMS は送信されていません。'
      + 'テストする前にプロバイダーを選び、認証情報を入力して保存してください。',
    sent: (to, via, id) => `テスト SMS を ${to} に送信しました（${via ?? 'デプロイで設定された配信方法'} 経由、id=${id}）。`,
    failed: (reason) => (reason ? `テスト SMS の送信に失敗しました: ${reason}` : 'テスト SMS の送信に失敗しました。'),
  },
  ko: {
    invalidTo: '유효한 "to" 전화번호를 입력하세요(E.164 형식 권장).',
    noSignedIn: '수신자가 없어 아무것도 보내지 않았습니다. 테스트 SMS는 로그인한 관리자 본인의 전화번호로 보내지는데, '
      + '이 호출에는 로그인한 사용자가 없습니다. 계정에 전화번호가 있는 관리자로 로그인한 뒤 테스트 SMS 보내기 버튼을 '
      + '다시 누르세요.',
    noEngine: '계정의 전화번호를 읽을 데이터 엔진이 없어 아무것도 보내지 않았습니다. 테스트 SMS는 로그인한 관리자 본인의 '
      + '번호로 보내지므로, 그 번호를 읽을 수 있어야 보낼 수 있습니다. 데이터 서비스가 실행되면 테스트 SMS 보내기 버튼을 '
      + '다시 누르세요.',
    readFailed: (reason) => `테스트 SMS를 보낼 계정 전화번호를 읽을 수 없어(${reason}) 아무것도 보내지 않았습니다. `
      + '테스트 SMS는 로그인한 관리자 본인의 번호로 보내집니다. 계정을 읽을 수 있게 되면 테스트 SMS 보내기 버튼을 다시 '
      + '누르세요.',
    noNumber: '계정에 전화번호가 없고 테스트 SMS는 로그인한 관리자 본인의 번호로 보내지므로 아무것도 보내지 않았습니다. '
      + '전화번호 로그인이 켜져 있는 곳에서만 계정에 번호가 있습니다. 계정에 전화번호가 있는 관리자로 로그인한 상태에서 '
      + '테스트 SMS 보내기 버튼을 누르세요.',
    missing: (provider, key) => `${provider}: ${key}이(가) 없습니다.`,
    buildFailed: (provider, reason) => `${provider} 전송 방식을 만들지 못했습니다: ${reason}`,
    logOnly: '활성화된 SMS 전달 방식이 없어(공급자: 없음 — 로그만) 테스트 SMS를 보내지 않았습니다. 테스트하기 전에 '
      + '공급자를 선택하고 자격 증명을 입력한 뒤 저장하세요.',
    sent: (to, via, id) => `테스트 SMS를 ${to}(으)로 보냈습니다(${via ?? '배포에 설정된 전송 방식'} 사용, id=${id}).`,
    failed: (reason) => (reason ? `테스트 SMS 발송에 실패했습니다: ${reason}` : '테스트 SMS 발송에 실패했습니다.'),
  },
  'es-ES': {
    invalidTo: 'Indique un número de teléfono "to" válido (se recomienda E.164).',
    noSignedIn: 'No hay destinatario: no se ha enviado nada. El SMS de prueba se envía al número de teléfono del propio '
      + 'administrador que ha iniciado sesión, y en esta llamada no hay nadie con la sesión iniciada. Inicie sesión como '
      + 'un administrador cuya cuenta tenga número de teléfono y vuelva a pulsar «Enviar SMS de prueba».',
    noEngine: 'No hay ningún motor de datos disponible para leer el número de teléfono de su cuenta: no se ha enviado '
      + 'nada. El SMS de prueba se envía al número del propio administrador que ha iniciado sesión, así que solo puede '
      + 'enviarse cuando ese número se pueda leer; vuelva a pulsar «Enviar SMS de prueba» cuando el servicio de datos '
      + 'esté disponible.',
    readFailed: (reason) => 'No se pudo leer el número de teléfono de su cuenta para enviarle el SMS de prueba '
      + `(${reason}): no se ha enviado nada. El SMS de prueba se envía al número del propio administrador que ha `
      + 'iniciado sesión; vuelva a pulsar «Enviar SMS de prueba» cuando se pueda leer su cuenta.',
    noNumber: 'Su cuenta no tiene número de teléfono y el SMS de prueba se envía al número del propio administrador '
      + 'que ha iniciado sesión: no se ha enviado nada. Una cuenta solo tiene número donde está habilitado el inicio de '
      + 'sesión por teléfono: pulse «Enviar SMS de prueba» con la sesión iniciada como un administrador cuya cuenta '
      + 'tenga número de teléfono.',
    missing: (provider, key) => `${provider}: falta ${key}.`,
    buildFailed: (provider, reason) => `No se pudo crear el transporte ${provider}: ${reason}`,
    logOnly: 'No hay ningún transporte de entrega de SMS activo (proveedor: Ninguno — solo registro), así que el SMS de '
      + 'prueba NO se ha enviado. Elija un proveedor, complete sus credenciales y guarde antes de probar.',
    sent: (to, via, id) =>
      `SMS de prueba enviado a ${to} ${via ? `a través de ${via}` : 'a través del transporte configurado en la implementación'} (id=${id}).`,
    failed: (reason) => (reason ? `El envío del SMS de prueba ha fallado: ${reason}` : 'El envío del SMS de prueba ha fallado.'),
  },
  ar: {
    invalidTo: 'أدخل رقم هاتف صالحًا في "to" (يُوصى بصيغة E.164).',
    noSignedIn: 'لا يوجد مستلم، ولم يُرسل أي شيء. تُرسل رسالة SMS التجريبية إلى رقم هاتف المسؤول المسجّل دخوله نفسه، '
      + 'ولا يوجد مستخدم مسجّل دخوله في هذا الطلب. سجّل الدخول بحساب مسؤول يحتوي على رقم هاتف، ثم اضغط زر إرسال رسالة '
      + 'SMS التجريبية مرة أخرى.',
    noEngine: 'لا يتوفر محرك بيانات لقراءة رقم هاتف حسابك، ولم يُرسل أي شيء. تُرسل رسالة SMS التجريبية إلى رقم المسؤول '
      + 'المسجّل دخوله نفسه، لذا لا يمكن إرسالها إلا بعد أن تصبح قراءة هذا الرقم ممكنة؛ اضغط زر إرسال رسالة SMS '
      + 'التجريبية مرة أخرى عندما تعمل خدمة البيانات.',
    readFailed: (reason) => `تعذّرت قراءة رقم هاتف حسابك لإرسال رسالة SMS التجريبية إليه (${reason})، ولم يُرسل أي `
      + 'شيء. تُرسل رسالة SMS التجريبية إلى رقم المسؤول المسجّل دخوله نفسه؛ اضغط زر إرسال رسالة SMS التجريبية مرة '
      + 'أخرى عندما تصبح قراءة حسابك ممكنة.',
    noNumber: 'لا يحتوي حسابك على رقم هاتف، وتُرسل رسالة SMS التجريبية إلى رقم المسؤول المسجّل دخوله نفسه، لذا لم '
      + 'يُرسل أي شيء. لا يحمل الحساب رقمًا إلا حيث يكون تسجيل الدخول برقم الهاتف مفعّلًا: اضغط زر إرسال رسالة SMS '
      + 'التجريبية وأنت مسجّل الدخول بحساب مسؤول يحتوي على رقم هاتف.',
    missing: (provider, key) => `${provider}: ${key} مفقود.`,
    buildFailed: (provider, reason) => `تعذّر إنشاء وسيلة النقل ${provider}: ${reason}`,
    logOnly: 'لا توجد وسيلة فعّالة لتسليم رسائل SMS (الموفّر: لا شيء، التسجيل فقط)، لذا لم تُرسل رسالة SMS '
      + 'التجريبية. اختر موفّرًا واملأ بيانات اعتماده واحفظ قبل الاختبار.',
    sent: (to, via, id) => `أُرسلت رسالة SMS التجريبية إلى ${to} عبر ${via ?? 'وسيلة النقل المضبوطة في النشر'} (id=${id}).`,
    failed: (reason) => (reason ? `فشل إرسال رسالة SMS التجريبية: ${reason}` : 'فشل إرسال رسالة SMS التجريبية.'),
  },
  fr: {
    invalidTo: 'Indiquez un numéro de téléphone « to » valide (format E.164 recommandé).',
    noSignedIn: 'Aucun destinataire : rien n’a été envoyé. Le SMS de test est envoyé au numéro de téléphone de '
      + 'l’administrateur connecté lui-même, et personne n’est connecté pour cet appel. Connectez-vous en tant '
      + 'qu’administrateur dont le compte a un numéro de téléphone, puis appuyez de nouveau sur le bouton d’envoi du '
      + 'SMS de test.',
    noEngine: 'Aucun moteur de données n’est disponible pour lire le numéro de téléphone de votre compte : rien n’a été '
      + 'envoyé. Le SMS de test est envoyé au numéro de l’administrateur connecté lui-même ; il ne peut donc partir '
      + 'qu’une fois ce numéro lisible. Appuyez de nouveau sur le bouton d’envoi du SMS de test quand le service de '
      + 'données sera disponible.',
    readFailed: (reason) => 'Impossible de lire le numéro de téléphone de votre compte pour y envoyer le SMS de test '
      + `(${reason}) : rien n’a été envoyé. Le SMS de test est envoyé au numéro de l’administrateur connecté lui-même ; `
      + 'appuyez de nouveau sur le bouton d’envoi du SMS de test une fois votre compte lisible.',
    noNumber: 'Votre compte n’a pas de numéro de téléphone, et le SMS de test est envoyé au numéro de l’administrateur '
      + 'connecté lui-même : rien n’a été envoyé. Un compte n’a de numéro que là où la connexion par téléphone est '
      + 'activée : appuyez sur le bouton d’envoi du SMS de test en étant connecté en tant qu’administrateur dont le '
      + 'compte a un numéro de téléphone.',
    missing: (provider, key) => `${provider} : ${key} manquant.`,
    buildFailed: (provider, reason) => `Impossible de créer le transport ${provider} : ${reason}`,
    logOnly: 'Aucun transport de remise de SMS n’est actif (fournisseur : aucun, journal uniquement), le SMS de test '
      + 'n’a donc PAS été envoyé. Choisissez un fournisseur, renseignez ses identifiants et enregistrez avant de tester.',
    sent: (to, via, id) =>
      `SMS de test envoyé à ${to} ${via ? `via ${via}` : 'par le transport configuré pour le déploiement'} (id=${id}).`,
    failed: (reason) => (reason ? `L’envoi du SMS de test a échoué : ${reason}` : 'L’envoi du SMS de test a échoué.'),
  },
  'pt-BR': {
    invalidTo: 'Informe um número de telefone "to" válido (recomenda-se o formato E.164).',
    noSignedIn: 'Nenhum destinatário: nada foi enviado. O SMS de teste vai para o número de telefone do próprio '
      + 'administrador conectado, e ninguém está conectado nesta chamada. Entre como um administrador cuja conta tenha '
      + 'número de telefone e clique novamente no botão de envio do SMS de teste.',
    noEngine: 'Nenhum mecanismo de dados está disponível para ler o número de telefone da sua conta: nada foi enviado. '
      + 'O SMS de teste vai para o número do próprio administrador conectado, então só pode ser enviado quando esse '
      + 'número puder ser lido; clique novamente no botão de envio do SMS de teste quando o serviço de dados estiver '
      + 'disponível.',
    readFailed: (reason) => `Não foi possível ler o número de telefone da sua conta para enviar o SMS de teste (${reason}): `
      + 'nada foi enviado. O SMS de teste vai para o número do próprio administrador conectado; clique novamente no '
      + 'botão de envio do SMS de teste quando a sua conta puder ser lida.',
    noNumber: 'A sua conta não tem número de telefone, e o SMS de teste vai para o número do próprio administrador '
      + 'conectado: nada foi enviado. Uma conta só tem número onde o login por telefone está ativado: clique no botão '
      + 'de envio do SMS de teste conectado como um administrador cuja conta tenha número de telefone.',
    missing: (provider, key) => `${provider}: falta ${key}.`,
    buildFailed: (provider, reason) => `Não foi possível criar o transporte ${provider}: ${reason}`,
    logOnly: 'Nenhum transporte de entrega de SMS está ativo (provedor: nenhum, apenas registro), então o SMS de teste '
      + 'NÃO foi enviado. Escolha um provedor, preencha as credenciais dele e salve antes de testar.',
    sent: (to, via, id) =>
      `SMS de teste enviado para ${to} ${via ? `por meio de ${via}` : 'por meio do transporte configurado na implantação'} (id=${id}).`,
    failed: (reason) => (reason ? `O envio do SMS de teste falhou: ${reason}` : 'O envio do SMS de teste falhou.'),
  },
  ru: {
    invalidTo: 'Укажите действительный номер телефона в поле "to" (рекомендуется формат E.164).',
    noSignedIn: 'Нет получателя — ничего не отправлено. Тестовое SMS отправляется на номер телефона самого вошедшего '
      + 'администратора, а в этом вызове никто не вошёл в систему. Войдите как администратор, у учётной записи которого '
      + 'есть номер телефона, и снова нажмите кнопку отправки тестового SMS.',
    noEngine: 'Нет механизма данных, чтобы прочитать номер телефона вашей учётной записи, — ничего не отправлено. '
      + 'Тестовое SMS отправляется на номер самого вошедшего администратора, поэтому его можно отправить, только когда '
      + 'этот номер удастся прочитать; снова нажмите кнопку отправки тестового SMS, когда служба данных заработает.',
    readFailed: (reason) => 'Не удалось прочитать номер телефона вашей учётной записи, чтобы отправить на него '
      + `тестовое SMS (${reason}), — ничего не отправлено. Тестовое SMS отправляется на номер самого вошедшего `
      + 'администратора; снова нажмите кнопку отправки тестового SMS, когда вашу учётную запись удастся прочитать.',
    noNumber: 'У вашей учётной записи нет номера телефона, а тестовое SMS отправляется на номер самого вошедшего '
      + 'администратора, — ничего не отправлено. Номер есть у учётной записи только там, где включён вход по номеру '
      + 'телефона: нажмите кнопку отправки тестового SMS, войдя как администратор, у учётной записи которого есть номер '
      + 'телефона.',
    missing: (provider, key) => `${provider}: не указано ${key}.`,
    buildFailed: (provider, reason) => `Не удалось создать транспорт ${provider}: ${reason}`,
    logOnly: 'Нет действующего транспорта доставки SMS (поставщик: нет — только журнал), поэтому тестовое SMS НЕ '
      + 'отправлено. Перед проверкой выберите поставщика, заполните его учётные данные и сохраните.',
    sent: (to, via, id) => `Тестовое SMS отправлено на ${to} через ${via ?? 'транспорт, настроенный в развёртывании'} (id=${id}).`,
    failed: (reason) => (reason ? `Не удалось отправить тестовое SMS: ${reason}` : 'Не удалось отправить тестовое SMS.'),
  },
  de: {
    invalidTo: 'Geben Sie eine gültige "to"-Telefonnummer an (E.164 empfohlen).',
    noSignedIn: 'Kein Empfänger – es wurde nichts gesendet. Die Test-SMS geht an die eigene Telefonnummer des '
      + 'angemeldeten Administrators, und bei diesem Aufruf ist niemand angemeldet. Melden Sie sich als Administrator '
      + 'an, dessen Konto eine Telefonnummer hat, und klicken Sie dann erneut auf die Schaltfläche zum Senden der '
      + 'Test-SMS.',
    noEngine: 'Es ist keine Daten-Engine verfügbar, um die Telefonnummer Ihres Kontos zu lesen – es wurde nichts '
      + 'gesendet. Die Test-SMS geht an die eigene Nummer des angemeldeten Administrators und kann daher erst gesendet '
      + 'werden, wenn diese Nummer gelesen werden kann; klicken Sie erneut auf die Schaltfläche zum Senden der Test-SMS, '
      + 'sobald der Datendienst läuft.',
    readFailed: (reason) => 'Die Telefonnummer Ihres Kontos konnte nicht gelesen werden, um die Test-SMS an sie zu '
      + `senden (${reason}) – es wurde nichts gesendet. Die Test-SMS geht an die eigene Nummer des angemeldeten `
      + 'Administrators; klicken Sie erneut auf die Schaltfläche zum Senden der Test-SMS, sobald Ihr Konto gelesen '
      + 'werden kann.',
    noNumber: 'Ihr Konto hat keine Telefonnummer, und die Test-SMS geht an die eigene Nummer des angemeldeten '
      + 'Administrators – es wurde nichts gesendet. Ein Konto hat nur dort eine Nummer, wo die Anmeldung per '
      + 'Telefonnummer aktiviert ist: Klicken Sie auf die Schaltfläche zum Senden der Test-SMS, während Sie als '
      + 'Administrator angemeldet sind, dessen Konto eine Telefonnummer hat.',
    missing: (provider, key) => `${provider}: ${key} fehlt.`,
    buildFailed: (provider, reason) => `Der ${provider}-Transport konnte nicht erstellt werden: ${reason}`,
    logOnly: 'Kein SMS-Zustelltransport ist aktiv (Anbieter: keiner – nur Protokoll), daher wurde die Test-SMS NICHT '
      + 'gesendet. Wählen Sie vor dem Testen einen Anbieter, tragen Sie seine Zugangsdaten ein und speichern Sie.',
    sent: (to, via, id) =>
      `Test-SMS an ${to} gesendet über ${via ?? 'den in der Bereitstellung konfigurierten Transport'} (id=${id}).`,
    failed: (reason) => (reason ? `Senden der Test-SMS fehlgeschlagen: ${reason}` : 'Senden der Test-SMS fehlgeschlagen.'),
  },
};

const COPY_LOCALES = Object.keys(SMS_TEST_COPY);

/** The copy for a caller's display language: through the platform locale table, else English. */
export function smsTestCopy(locale: string | undefined): SmsTestCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return SMS_TEST_COPY[(picked ?? 'en') as SmsTestCopyLocale];
}
