// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user-facing sentence of `lint-connector-credential-literals.ts`'s
 * advisory finding (`connector-credential-literal`), in every platform locale
 * (`PLATFORM_LOCALE_TAGS`, `@objectstack/spec/system`). The finding mechanism
 * and the locale ladder are `finding-user-text.ts`'s; this file is the rule's
 * own half of it, kept beside the rule so its wording and its translations
 * change together.
 *
 * Who reads it: the person who saved a connector in Studio, in their own
 * language, once the save door composes `RuntimeAuthoringIssueSchema.userMessage`
 * from it. It says where the credential sits, why that is the wrong place, and
 * where it belongs instead: Connector credentials, the console's own page name
 * (`connectorCredentials.title`, `ui/packages/i18n`).
 *
 * Params, set at the three push sites in `lint-connector-credential-literals.ts`:
 * `connector`, `position` and, for a map entry, `name` (the header or
 * environment variable the value sits under). `position` picks the arm:
 * `header` and `env` (a literal in one of the four maps), `credential-env` (a
 * credential typed into `transport.credentialEnv`) and `stdio-auth` (a stdio
 * MCP server whose credential reaches nothing). ⛔ Never the value itself, for
 * the rule's module-note reason: the sentence travels into the save response.
 *
 * `finding-user-text.connector-permission-form.test.ts` renders it from the rule's
 * real findings in every platform locale, one per arm.
 */

import type { UserTextCatalog, UserTextParams, UserTextTemplate } from './finding-user-text.js';
import { CONNECTOR_CREDENTIAL_LITERAL } from './lint-connector-credential-literals.js';

type Arm = 'header' | 'env' | 'credential-env' | 'stdio-auth';
type Arms = Readonly<Record<Arm, UserTextTemplate>>;

const armOf = (p: UserTextParams): Arm =>
  p.position === 'env' || p.position === 'credential-env' || p.position === 'stdio-auth' ? p.position : 'header';

const byArm = (arms: Arms): UserTextTemplate => (p) => arms[armOf(p)](p);

export const CONNECTOR_CREDENTIAL_LITERALS_USER_TEXT: UserTextCatalog = Object.freeze({
  [CONNECTOR_CREDENTIAL_LITERAL]: {
    en: byArm({
      header: (p) =>
        `Connector "${p.connector}" has a credential written directly into its header "${p.name}", so the ` +
        `credential is stored in the connector's metadata rather than in Connector credentials. Save it in ` +
        `Connector credentials and remove the header: the connector then sends the stored credential for you.`,
      env: (p) =>
        `Connector "${p.connector}" has a credential written directly into the environment variable "${p.name}" ` +
        `of its MCP server, so the credential is stored in the connector's metadata rather than in Connector ` +
        `credentials. Save it in Connector credentials, put the variable's name in "credentialEnv" and remove the ` +
        `entry: the connector then passes the stored credential to the server for you.`,
      'credential-env': (p) =>
        `Connector "${p.connector}" has a credential in "credentialEnv", which should hold only the name of an ` +
        `environment variable and is shown to everyone who can read the connector. Save the credential in ` +
        `Connector credentials and put the variable's name in "credentialEnv" instead.`,
      'stdio-auth': (p) =>
        `Connector "${p.connector}" has a credential set, but its MCP server never receives it: a server that runs ` +
        `as a local process gets the credential only through the environment variable named in "credentialEnv", ` +
        `and none is named. Put the name of the variable the server reads in "credentialEnv", or remove the ` +
        `credential if the server needs none.`,
    }),
    'zh-Hans': byArm({
      header: (p) =>
        `连接器“${p.connector}”的请求头“${p.name}”中直接写入了凭据，因此该凭据保存在连接器的元数据里，而不是连接器凭据中。` +
        `请将它保存到连接器凭据，并删除该请求头：连接器会自动发送已保存的凭据。`,
      env: (p) =>
        `连接器“${p.connector}”的 MCP 服务器环境变量“${p.name}”中直接写入了凭据，因此该凭据保存在连接器的元数据里，` +
        `而不是连接器凭据中。请将它保存到连接器凭据，在“credentialEnv”中填写该变量名，并删除这一项：` +
        `连接器会自动把已保存的凭据传给服务器。`,
      'credential-env': (p) =>
        `连接器“${p.connector}”在“credentialEnv”中写入了凭据。该项只应填写环境变量的名称，并且所有能读取该连接器的人都能看到它。` +
        `请将凭据保存到连接器凭据，并改为在“credentialEnv”中填写变量名。`,
      'stdio-auth': (p) =>
        `连接器“${p.connector}”设置了凭据，但它的 MCP 服务器永远收不到：以本地进程运行的服务器只能通过“credentialEnv”` +
        `指定的环境变量获得凭据，而这里没有指定。请在“credentialEnv”中填写服务器读取的变量名；如果服务器不需要凭据，请删除该凭据。`,
    }),
    'zh-Hant': byArm({
      header: (p) =>
        `聯結器「${p.connector}」的請求標頭「${p.name}」中直接寫入了憑據，因此該憑據儲存在聯結器的中繼資料裡，而不是聯結器憑據中。` +
        `請將它儲存到聯結器憑據，並刪除該請求標頭：聯結器會自動傳送已儲存的憑據。`,
      env: (p) =>
        `聯結器「${p.connector}」的 MCP 伺服器環境變數「${p.name}」中直接寫入了憑據，因此該憑據儲存在聯結器的中繼資料裡，` +
        `而不是聯結器憑據中。請將它儲存到聯結器憑據，在「credentialEnv」中填寫該變數名稱，並刪除這一項：` +
        `聯結器會自動把已儲存的憑據傳給伺服器。`,
      'credential-env': (p) =>
        `聯結器「${p.connector}」在「credentialEnv」中寫入了憑據。該項只應填寫環境變數的名稱，而且所有能讀取該聯結器的人都看得到它。` +
        `請將憑據儲存到聯結器憑據，並改為在「credentialEnv」中填寫變數名稱。`,
      'stdio-auth': (p) =>
        `聯結器「${p.connector}」設定了憑據，但它的 MCP 伺服器永遠收不到：以本機處理程序執行的伺服器只能透過「credentialEnv」` +
        `指定的環境變數取得憑據，而這裡沒有指定。請在「credentialEnv」中填寫伺服器讀取的變數名稱；如果伺服器不需要憑據，請刪除該憑據。`,
    }),
    es: byArm({
      header: (p) =>
        `El conector "${p.connector}" tiene una credencial escrita directamente en su encabezado "${p.name}", así ` +
        `que la credencial se guarda en los metadatos del conector y no en Credenciales de conectores. Guárdela en ` +
        `Credenciales de conectores y elimine el encabezado: el conector enviará la credencial guardada por usted.`,
      env: (p) =>
        `El conector "${p.connector}" tiene una credencial escrita directamente en la variable de entorno ` +
        `"${p.name}" de su servidor MCP, así que la credencial se guarda en los metadatos del conector y no en ` +
        `Credenciales de conectores. Guárdela en Credenciales de conectores, escriba el nombre de la variable en ` +
        `"credentialEnv" y elimine la entrada: el conector pasará la credencial guardada al servidor por usted.`,
      'credential-env': (p) =>
        `El conector "${p.connector}" tiene una credencial en "credentialEnv", que solo debe contener el nombre de ` +
        `una variable de entorno y que ve cualquiera que pueda leer el conector. Guarde la credencial en ` +
        `Credenciales de conectores y escriba en "credentialEnv" el nombre de la variable.`,
      'stdio-auth': (p) =>
        `El conector "${p.connector}" tiene una credencial configurada, pero su servidor MCP nunca la recibe: un ` +
        `servidor que se ejecuta como proceso local solo obtiene la credencial mediante la variable de entorno ` +
        `indicada en "credentialEnv", y no se indica ninguna. Escriba en "credentialEnv" el nombre de la variable ` +
        `que lee el servidor, o elimine la credencial si el servidor no la necesita.`,
    }),
    ar: byArm({
      header: (p) =>
        `يحتوي الموصل "${p.connector}" على بيانات اعتماد مكتوبة مباشرة في الترويسة "${p.name}"، لذا تُخزَّن ` +
        `بيانات الاعتماد في البيانات الوصفية للموصل بدلًا من بيانات اعتماد الموصلات. احفظها في بيانات اعتماد ` +
        `الموصلات واحذف الترويسة: سيرسل الموصل بيانات الاعتماد المحفوظة نيابةً عنك.`,
      env: (p) =>
        `يحتوي الموصل "${p.connector}" على بيانات اعتماد مكتوبة مباشرة في متغير البيئة "${p.name}" لخادم MCP ` +
        `الخاص به، لذا تُخزَّن بيانات الاعتماد في البيانات الوصفية للموصل بدلًا من بيانات اعتماد الموصلات. ` +
        `احفظها في بيانات اعتماد الموصلات، واكتب اسم المتغير في "credentialEnv"، واحذف هذا الإدخال: سيمرّر ` +
        `الموصل بيانات الاعتماد المحفوظة إلى الخادم نيابةً عنك.`,
      'credential-env': (p) =>
        `يحتوي الموصل "${p.connector}" على بيانات اعتماد في "credentialEnv"، وهو حقل يجب أن يحمل اسم متغير بيئة ` +
        `فقط ويراه كل من يستطيع قراءة الموصل. احفظ بيانات الاعتماد في بيانات اعتماد الموصلات واكتب اسم المتغير ` +
        `في "credentialEnv" بدلًا منها.`,
      'stdio-auth': (p) =>
        `للموصل "${p.connector}" بيانات اعتماد مضبوطة، لكن خادم MCP الخاص به لا يتلقاها أبدًا: الخادم الذي يعمل ` +
        `كعملية محلية لا يحصل على بيانات الاعتماد إلا عبر متغير البيئة المسمّى في "credentialEnv"، ولم يُسمَّ ` +
        `أي متغير. اكتب في "credentialEnv" اسم المتغير الذي يقرؤه الخادم، أو احذف بيانات الاعتماد إذا كان ` +
        `الخادم لا يحتاج إليها.`,
    }),
    fr: byArm({
      header: (p) =>
        `Le connecteur « ${p.connector} » contient un identifiant secret écrit directement dans son en-tête ` +
        `« ${p.name} » : il est donc stocké dans les métadonnées du connecteur et non dans Identifiants des ` +
        `connecteurs. Enregistrez-le dans Identifiants des connecteurs et supprimez l’en-tête : le connecteur ` +
        `enverra lui-même l’identifiant enregistré.`,
      env: (p) =>
        `Le connecteur « ${p.connector} » contient un identifiant secret écrit directement dans la variable ` +
        `d’environnement « ${p.name} » de son serveur MCP : il est donc stocké dans les métadonnées du connecteur ` +
        `et non dans Identifiants des connecteurs. Enregistrez-le dans Identifiants des connecteurs, indiquez le ` +
        `nom de la variable dans « credentialEnv » et supprimez l’entrée : le connecteur transmettra lui-même ` +
        `l’identifiant enregistré au serveur.`,
      'credential-env': (p) =>
        `Le connecteur « ${p.connector} » contient un identifiant secret dans « credentialEnv », qui ne doit ` +
        `contenir que le nom d’une variable d’environnement et que voit toute personne pouvant lire le connecteur. ` +
        `Enregistrez l’identifiant dans Identifiants des connecteurs et indiquez plutôt le nom de la variable dans ` +
        `« credentialEnv ».`,
      'stdio-auth': (p) =>
        `Le connecteur « ${p.connector} » a un identifiant configuré, mais son serveur MCP ne le reçoit jamais : un ` +
        `serveur exécuté comme processus local ne reçoit l’identifiant que par la variable d’environnement nommée ` +
        `dans « credentialEnv », et aucune n’est nommée. Indiquez dans « credentialEnv » le nom de la variable que ` +
        `lit le serveur, ou supprimez l’identifiant si le serveur n’en a pas besoin.`,
    }),
    'pt-BR': byArm({
      header: (p) =>
        `O conector "${p.connector}" tem uma credencial escrita diretamente no cabeçalho "${p.name}", então a ` +
        `credencial fica guardada nos metadados do conector e não em Credenciais de conectores. Guarde-a em ` +
        `Credenciais de conectores e remova o cabeçalho: o conector envia a credencial guardada por você.`,
      env: (p) =>
        `O conector "${p.connector}" tem uma credencial escrita diretamente na variável de ambiente "${p.name}" do ` +
        `seu servidor MCP, então a credencial fica guardada nos metadados do conector e não em Credenciais de ` +
        `conectores. Guarde-a em Credenciais de conectores, coloque o nome da variável em "credentialEnv" e remova ` +
        `a entrada: o conector passa a credencial guardada ao servidor por você.`,
      'credential-env': (p) =>
        `O conector "${p.connector}" tem uma credencial em "credentialEnv", que deve conter apenas o nome de uma ` +
        `variável de ambiente e é visível para qualquer pessoa que possa ler o conector. Guarde a credencial em ` +
        `Credenciais de conectores e coloque em "credentialEnv" o nome da variável.`,
      'stdio-auth': (p) =>
        `O conector "${p.connector}" tem uma credencial configurada, mas o servidor MCP dele nunca a recebe: um ` +
        `servidor executado como processo local só recebe a credencial pela variável de ambiente indicada em ` +
        `"credentialEnv", e nenhuma foi indicada. Coloque em "credentialEnv" o nome da variável que o servidor lê, ` +
        `ou remova a credencial se o servidor não precisar dela.`,
    }),
    ru: byArm({
      header: (p) =>
        `В заголовок «${p.name}» коннектора «${p.connector}» учётные данные записаны напрямую, поэтому они ` +
        `хранятся в метаданных коннектора, а не в разделе «Учётные данные коннекторов». Сохраните их в разделе ` +
        `«Учётные данные коннекторов» и удалите заголовок: коннектор сам будет отправлять сохранённые учётные данные.`,
      env: (p) =>
        `В переменную окружения «${p.name}» MCP-сервера коннектора «${p.connector}» учётные данные записаны ` +
        `напрямую, поэтому они хранятся в метаданных коннектора, а не в разделе «Учётные данные коннекторов». ` +
        `Сохраните их в разделе «Учётные данные коннекторов», укажите имя переменной в «credentialEnv» и удалите ` +
        `эту запись: коннектор сам передаст сохранённые учётные данные серверу.`,
      'credential-env': (p) =>
        `В поле «credentialEnv» коннектора «${p.connector}» записаны учётные данные, хотя это поле должно содержать ` +
        `только имя переменной окружения и его видит каждый, кто может читать коннектор. Сохраните учётные данные ` +
        `в разделе «Учётные данные коннекторов», а в «credentialEnv» укажите имя переменной.`,
      'stdio-auth': (p) =>
        `У коннектора «${p.connector}» заданы учётные данные, но его MCP-сервер их никогда не получает: сервер, ` +
        `работающий как локальный процесс, получает учётные данные только через переменную окружения, указанную в ` +
        `«credentialEnv», а она не указана. Укажите в «credentialEnv» имя переменной, которую читает сервер, или ` +
        `удалите учётные данные, если они серверу не нужны.`,
    }),
    de: byArm({
      header: (p) =>
        `Der Connector „${p.connector}“ enthält Zugangsdaten, die direkt in seinen Header „${p.name}“ geschrieben ` +
        `sind. Sie werden daher in den Metadaten des Connectors gespeichert statt unter Connector-Zugangsdaten. ` +
        `Speichern Sie sie unter Connector-Zugangsdaten, und entfernen Sie den Header: Der Connector sendet die ` +
        `gespeicherten Zugangsdaten dann selbst.`,
      env: (p) =>
        `Der Connector „${p.connector}“ enthält Zugangsdaten, die direkt in die Umgebungsvariable „${p.name}“ ` +
        `seines MCP-Servers geschrieben sind. Sie werden daher in den Metadaten des Connectors gespeichert statt ` +
        `unter Connector-Zugangsdaten. Speichern Sie sie unter Connector-Zugangsdaten, tragen Sie den Namen der ` +
        `Variable in „credentialEnv“ ein, und entfernen Sie den Eintrag: Der Connector übergibt die gespeicherten ` +
        `Zugangsdaten dann selbst an den Server.`,
      'credential-env': (p) =>
        `Der Connector „${p.connector}“ enthält Zugangsdaten in „credentialEnv“. Dieses Feld darf nur den Namen ` +
        `einer Umgebungsvariable enthalten und ist für jeden sichtbar, der den Connector lesen darf. Speichern Sie ` +
        `die Zugangsdaten unter Connector-Zugangsdaten, und tragen Sie stattdessen den Namen der Variable in ` +
        `„credentialEnv“ ein.`,
      'stdio-auth': (p) =>
        `Für den Connector „${p.connector}“ sind Zugangsdaten festgelegt, aber sein MCP-Server erhält sie nie: Ein ` +
        `Server, der als lokaler Prozess läuft, erhält Zugangsdaten nur über die in „credentialEnv“ genannte ` +
        `Umgebungsvariable, und es ist keine genannt. Tragen Sie in „credentialEnv“ den Namen der Variable ein, die ` +
        `der Server liest, oder entfernen Sie die Zugangsdaten, wenn der Server keine braucht.`,
    }),
    ja: byArm({
      header: (p) =>
        `コネクタ「${p.connector}」のヘッダー「${p.name}」に認証情報が直接書き込まれているため、認証情報がコネクタ認証情報ではなく` +
        `コネクタのメタデータに保存されています。コネクタ認証情報に保存し、このヘッダーを削除してください。` +
        `保存した認証情報はコネクタが自動的に送信します。`,
      env: (p) =>
        `コネクタ「${p.connector}」の MCP サーバーの環境変数「${p.name}」に認証情報が直接書き込まれているため、` +
        `認証情報がコネクタ認証情報ではなくコネクタのメタデータに保存されています。コネクタ認証情報に保存し、` +
        `「credentialEnv」に変数名を指定して、このエントリを削除してください。保存した認証情報はコネクタが自動的にサーバーへ渡します。`,
      'credential-env': (p) =>
        `コネクタ「${p.connector}」の「credentialEnv」に認証情報が書き込まれています。この項目には環境変数の名前だけを指定するもので、` +
        `コネクタを読み取れる人なら誰でも見ることができます。認証情報はコネクタ認証情報に保存し、「credentialEnv」には変数名を指定してください。`,
      'stdio-auth': (p) =>
        `コネクタ「${p.connector}」には認証情報が設定されていますが、MCP サーバーには渡されません。ローカルプロセスとして動くサーバーは` +
        `「credentialEnv」で指定された環境変数からしか認証情報を受け取れず、その指定がないためです。` +
        `「credentialEnv」にサーバーが読み取る変数名を指定するか、サーバーに認証情報が不要なら削除してください。`,
    }),
    ko: byArm({
      header: (p) =>
        `커넥터 "${p.connector}"의 헤더 "${p.name}"에 자격 증명이 직접 작성되어 있어, 자격 증명이 커넥터 자격 증명이 아니라 ` +
        `커넥터의 메타데이터에 저장되어 있습니다. 커넥터 자격 증명에 저장하고 이 헤더를 삭제하세요. 저장된 자격 증명은 ` +
        `커넥터가 대신 보냅니다.`,
      env: (p) =>
        `커넥터 "${p.connector}"의 MCP 서버 환경 변수 "${p.name}"에 자격 증명이 직접 작성되어 있어, 자격 증명이 커넥터 ` +
        `자격 증명이 아니라 커넥터의 메타데이터에 저장되어 있습니다. 커넥터 자격 증명에 저장하고, "credentialEnv"에 변수 ` +
        `이름을 적은 뒤 이 항목을 삭제하세요. 저장된 자격 증명은 커넥터가 대신 서버에 전달합니다.`,
      'credential-env': (p) =>
        `커넥터 "${p.connector}"의 "credentialEnv"에 자격 증명이 작성되어 있습니다. 이 항목에는 환경 변수의 이름만 적어야 ` +
        `하며, 커넥터를 읽을 수 있는 사람은 누구나 볼 수 있습니다. 자격 증명은 커넥터 자격 증명에 저장하고, ` +
        `"credentialEnv"에는 변수 이름을 적으세요.`,
      'stdio-auth': (p) =>
        `커넥터 "${p.connector}"에 자격 증명이 설정되어 있지만 MCP 서버는 이를 받지 못합니다. 로컬 프로세스로 실행되는 ` +
        `서버는 "credentialEnv"에 지정된 환경 변수로만 자격 증명을 받는데, 지정된 변수가 없습니다. "credentialEnv"에 ` +
        `서버가 읽는 변수 이름을 적거나, 서버에 자격 증명이 필요 없다면 삭제하세요.`,
    }),
  },
});
