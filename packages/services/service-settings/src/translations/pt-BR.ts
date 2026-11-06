// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { PlatformTranslationData } from '@objectstack/spec/system';
import { countryOptionLabels } from '../manifests/company.manifest.js';

/**
 * Português do Brasil (pt-BR) — built-in settings manifest translations.
 */
export const ptBR: PlatformTranslationData = {
  settingsCommon: {
    sourceLabels: { env: 'Ambiente', global: 'Global', tenant: 'Organização', user: 'Usuário', default: 'Padrão' },
  },
  settings: {
    mail: {
      title: 'Envio de e-mail',
      description: 'Configuração de SMTP e do provedor de e-mail transacional.',
      groups: {
        provider: { title: 'Provedor', description: 'Escolha como este sistema envia os e-mails de saída.' },
        smtp: { title: 'SMTP' },
        api_key: { title: 'Chave de API' },
        from_address: { title: 'Endereço do remetente' },
        delivery: { title: 'Entrega', description: 'Como os e-mails de saída são entregues ao provedor.' },
      },
      keys: {
        provider: {
          label: 'Provedor',
          help: 'Só aparecem os provedores pelos quais este servidor consegue de fato entregar. SendGrid e Amazon SES são configurados como SMTP.',
          options: {
            smtp: 'SMTP',
            resend: 'Resend',
            postmark: 'Postmark',
            log: 'Nenhum (apenas log — sem entrega real)',
          },
        },
        smtp_host: { label: 'Host', help: 'Exemplo: smtp.example.com' },
        smtp_port: { label: 'Porta' },
        smtp_secure: { label: 'Usar TLS' },
        smtp_user: { label: 'Nome de usuário' },
        smtp_password: { label: 'Senha' },
        api_key: { label: 'Chave de API' },
        from_email: { label: 'E-mail do remetente', help: 'Exemplo: no-reply@example.com' },
        from_name: {
          label: 'Nome do remetente',
          help: 'Deixe em branco para usar o nome do produto (Identidade visual) ou o nome com que esta implantação foi configurada.',
        },
        queue_delivery: {
          label: 'Entrega por fila durável',
          help: 'Entrega cada mensagem à fila de tarefas em vez de enviá-la diretamente, para que uma entrega com falha seja repetida com espera progressiva por um worker e sobreviva a uma reinicialização. Requer a capacidade de fila com um adaptador durável. "Enviar e-mail de teste" sempre envia diretamente.',
        },
      },
      actions: {
        test: { label: 'Enviar e-mail de teste' },
      },
    },
    sms: {
      title: 'Envio de SMS',
      description: 'Configuração do provedor de SMS para login por OTP, convites e notificações.',
      groups: {
        provider: { title: 'Provedor', description: 'Escolha como este sistema envia os SMS de saída.' },
        aliyun: { title: 'Aliyun SMS' },
        twilio: { title: 'Twilio' },
        limits: {
          title: 'Limites de gasto',
          description: 'Limita o volume de SMS de saída da implantação. SMS é um canal pago e cada envio custa dinheiro de verdade.',
        },
      },
      keys: {
        provider: {
          label: 'Provedor',
          options: { log: 'Nenhum (apenas log — sem entrega real)', aliyun: 'Aliyun SMS (阿里云短信)', twilio: 'Twilio' },
        },
        aliyun_access_key_id: { label: 'AccessKey ID' },
        aliyun_access_key_secret: { label: 'AccessKey Secret' },
        aliyun_sign_name: { label: 'Nome de assinatura (短信签名)' },
        aliyun_template_code: {
          label: 'Código de modelo padrão (短信模板)',
          help: 'Usado quando um envio não informa um modelo explícito. Um modelo genérico com uma única variável ${content} permite SMS de notificação genéricos.',
        },
        twilio_account_sid: { label: 'Account SID' },
        twilio_auth_token: { label: 'Token de autenticação' },
        twilio_from_number: {
          label: 'Número do remetente',
          help: 'Remetente no formato E.164, por exemplo +15005550006. Ou este ou um Messaging Service SID.',
        },
        twilio_messaging_service_sid: { label: 'Messaging Service SID' },
        daily_quota: {
          label: 'Limite diário de envio',
          help: 'Máximo de SMS que esta implantação pode enviar por dia UTC, somando login por OTP, convites e notificações. 0 significa sem limite. Envios acima do limite são recusados até 00:00 UTC.',
        },
      },
      actions: {
        test: { label: 'Enviar SMS de teste' },
      },
    },
    branding: {
      title: 'Identidade visual',
      description: 'O nome, o logotipo e a cor exibidos no console e na página de login. Um valor não definido usa a identidade visual da própria implantação.',
      groups: {
        identity: { title: 'Identidade' },
        appearance: { title: 'Aparência' },
      },
      keys: {
        workspace_name: {
          label: 'Nome do produto',
          help: 'O nome do produto no console, na página de login e no título do navegador, além dos e-mails de login, do aplicativo autenticador e do login MCP. Deixe em branco para usar o nome com que esta implantação foi configurada. Este não é o nome da própria organização, que é o Nome no registro da Organização.',
        },
        accent_color: {
          label: 'Cor de destaque',
          help: 'A cor de tema do navegador e do aplicativo instalado. Cada aplicativo mantém as próprias cores.',
        },
        logo_url: {
          label: 'URL do logotipo',
          help: 'Exibido na página de login, na tela de carregamento e no cabeçalho da página inicial. Exemplo: https://…/logo.svg',
        },
      },
    },
    company: {
      title: 'Empresa',
      description: 'Identidade da pessoa jurídica — razão social, endereço, identificações fiscais e contato principal.',
      groups: {
        identity: { title: 'Identificação' },
        address: { title: 'Endereço registrado' },
        contact: { title: 'Contato' },
      },
      keys: {
        legal_name: {
          label: 'Razão social',
          help: 'Nome jurídico registrado da organização, como aparece em contratos e faturas.',
        },
        registration_number: {
          label: 'Número de registro',
          help: 'Número de registro ou constituição da empresa (por exemplo, EIN).',
        },
        tax_id: { label: 'ID fiscal / IVA', help: 'Exibido nas faturas (por exemplo, VAT, GST, ABN).' },
        address_line1: { label: 'Endereço (linha 1)' },
        address_line2: { label: 'Endereço (linha 2)' },
        city: { label: 'Cidade' },
        state: { label: 'Estado / Província' },
        postal_code: { label: 'CEP' },
        country: {
          label: 'País',
          help: 'País do endereço registrado. Digite o nome de um país e escolha-o na lista.',
          options: countryOptionLabels('pt-BR'),
        },
        phone: { label: 'Telefone', help: 'Recomenda-se o formato E.164, por exemplo +55 11 5555 0100.' },
        website: { label: 'Site', help: 'Exemplo: https://example.com' },
        primary_contact_name: { label: 'Nome do contato principal' },
        primary_contact_email: { label: 'E-mail do contato principal', help: 'Exemplo: ops@example.com' },
      },
    },
    localization: {
      title: 'Localização',
      description: 'Fuso horário, idioma, país, moeda e ano fiscal padrão.',
      groups: {
        region: { title: 'Região' },
        finance: { title: 'Finanças' },
      },
      keys: {
        timezone: {
          label: 'Fuso horário padrão',
          help: 'Define o que "hoje" significa nas fórmulas, como os relatórios agrupam datas e como datas e horas são exibidas. Aceita qualquer nome de fuso horário IANA (por exemplo, America/Sao_Paulo). Este é o fuso em vigor para a organização: o campo Fuso horário no registro da Organização não o altera.',
          options: {
            UTC: 'UTC',
            'America/Los_Angeles': '(UTC−08/−07) Los Angeles',
            'America/Denver': '(UTC−07/−06) Denver',
            'America/Chicago': '(UTC−06/−05) Chicago',
            'America/New_York': '(UTC−05/−04) Nova York',
            'America/Sao_Paulo': '(UTC−03) São Paulo',
            'Europe/London': '(UTC±00/+01) Londres',
            'Europe/Paris': '(UTC+01/+02) Paris',
            'Europe/Berlin': '(UTC+01/+02) Berlim',
            'Europe/Moscow': '(UTC+03) Moscou',
            'Asia/Dubai': '(UTC+04) Dubai',
            'Asia/Kolkata': '(UTC+05:30) Calcutá',
            'Asia/Singapore': '(UTC+08) Singapura',
            'Asia/Shanghai': '(UTC+08) Xangai',
            'Asia/Tokyo': '(UTC+09) Tóquio',
            'Australia/Sydney': '(UTC+10/+11) Sydney',
            'Pacific/Auckland': '(UTC+12/+13) Auckland',
          },
        },
        locale: {
          label: 'Idioma padrão',
          help: 'Idioma BCP-47 dos catálogos de mensagens e da formatação de números e datas.',
        },
        default_country: {
          label: 'País padrão',
          help: 'Usado como padrão para endereços e telefones. Digite o nome de um país e escolha-o na lista.',
          options: countryOptionLabels('pt-BR'),
        },
        currency: {
          label: 'Moeda padrão',
          help: 'Código ISO 4217 aplicado quando um campo de moeda não informa o seu. Deixe sem valor para exibir valores sem código como números simples.',
          options: {
            USD: 'USD — Dólar americano',
            EUR: 'EUR — Euro',
            GBP: 'GBP — Libra esterlina',
            JPY: 'JPY — Iene japonês',
            CNY: 'CNY — Yuan chinês',
            INR: 'INR — Rupia indiana',
            AUD: 'AUD — Dólar australiano',
            CAD: 'CAD — Dólar canadense',
            BRL: 'BRL — Real brasileiro',
          },
        },
        fiscal_year_start: {
          label: 'Início do ano fiscal',
          help: 'Primeiro mês do ano fiscal — define "este trimestre / ano fiscal" nos relatórios.',
          options: {
            january: 'Janeiro',
            february: 'Fevereiro',
            march: 'Março',
            april: 'Abril',
            may: 'Maio',
            june: 'Junho',
            july: 'Julho',
            august: 'Agosto',
            september: 'Setembro',
            october: 'Outubro',
            november: 'Novembro',
            december: 'Dezembro',
          },
        },
      },
    },
    auth: {
      title: 'Autenticação',
      description: 'Controles de login, cadastro e recursos de autenticação integrados.',
      groups: {
        email_password: {
          title: 'E-mail e senha',
          description: 'Controla o login local por e-mail e senha e o cadastro por conta própria.',
        },
        membership: {
          title: 'Associação',
          description: 'A que um usuário recém-criado se junta. Funciona em conjunto com o cadastro por conta própria acima.',
        },
        audience: {
          title: 'Público',
          description: 'Quem pode se tornar usuário dos aplicativos deste sistema. Domínios de e-mail permitidos sempre exigem a verificação de e-mail. Aberto também a exige, a menos que a implantação a desative; um valor salvo neste console não pode desativá-la. Convites, usuários criados por administradores, provisionamento SCIM e SSO corporativo são aceitos em qualquer modo.',
        },
        password_policy: {
          title: 'Política de senhas',
          description: 'Limites de tamanho impostos pelo provedor de autenticação no cadastro e na redefinição de senha.',
        },
        anti_abuse: {
          title: 'Antiabuso',
          description: 'Proteção contra força bruta: bloqueio de conta por identidade e limite de taxa por IP nos endpoints de autenticação.',
        },
        multi_factor: {
          title: 'Multifator',
          description: 'Exige que os membros protejam a conta com um aplicativo autenticador (TOTP).',
        },
        sessions: { title: 'Sessões', description: 'Por quanto tempo uma sessão de login permanece válida.' },
        network: { title: 'Rede', description: 'Restringe de onde os usuários podem se autenticar.' },
        api_keys: {
          title: 'Chaves de API',
          description: 'Por quanto tempo as chaves de API pessoais valem. Uma chave expirada, sem uso além da janela de inatividade ou revogada é recusada com seu próprio código de erro, e a solução é sempre uma nova chave.',
        },
        social: {
          title: 'Login social',
          description: 'Configura o provedor de login integrado do Google. As credenciais definidas na configuração do servidor continuam prevalecendo.',
        },
      },
      keys: {
        email_password_enabled: {
          label: 'Ativar login por e-mail e senha',
          confirmOffText: 'Quem entra com senha vai precisar de outra forma de acesso.',
        },
        signup_enabled: {
          label: 'Permitir cadastro por e-mail',
          help: 'Abre o formulário de cadastro com e-mail e senha. Quem ele aceita é decidido pelo Público do cadastro próprio abaixo: em Somente por convite, apenas um endereço com convite pendente; em Domínios de e-mail permitidos, os domínios permitidos e os endereços convidados; em Aberto, qualquer pessoa. Desativado, o formulário fica fechado em qualquer público, inclusive para convites.',
        },
        require_email_verification: { label: 'Exigir verificação de e-mail' },
        membership_policy: {
          label: 'Associação de novos usuários',
          help: 'Automático vincula cada novo usuário à organização padrão. Somente por convite concede a associação apenas por um ato explícito — criar uma organização, aceitar um convite, ser adicionado por um administrador ou ser provisionado na hora pelo SSO.',
          options: {
            auto: 'Entrar automaticamente na organização padrão',
            'invite-only': 'Somente por convite — nunca entrar automaticamente',
          },
        },
        audience_posture: {
          label: 'Público do cadastro próprio',
          help: 'Somente por convite fecha o cadastro próprio: as pessoas só se tornam usuárias quando um administrador as convida, cria ou importa, ou por provisionamento de diretório (SCIM) ou login único corporativo. Domínios de e-mail permitidos o abre para os domínios listados abaixo. Aberto aceita qualquer pessoa. Tanto Domínios de e-mail permitidos quanto Aberto precisam do conjunto de permissões de cadastro próprio abaixo. Domínios de e-mail permitidos sempre exige verificação de e-mail. Aberto a exige, a menos que a configuração do servidor a desative; desativá-la neste console é recusado em Aberto.',
          options: {
            invite_only: 'Somente por convite — sem cadastro próprio (padrão)',
            email_domain: 'Somente domínios de e-mail permitidos',
            open: 'Aberto — qualquer pessoa pode se cadastrar',
          },
        },
        audience_allowed_email_domains: {
          label: 'Domínios de e-mail permitidos',
          help: 'Domínios simples, um por linha ou separados por vírgula (por exemplo, acme.com). A correspondência é exata e não diferencia maiúsculas de minúsculas; subdomínios precisam de entradas próprias; sem curingas.',
        },
        audience_self_registration_permission_set: {
          label: 'Conjunto de permissões do cadastro próprio',
          help: 'Nome do conjunto de permissões que cada usuário cadastrado por conta própria recebe. O conjunto padrão de membro serve; o conjunto completo de administrador é recusado. Obrigatório sempre que o público permite cadastro próprio.',
        },
        password_min_length: { label: 'Tamanho mínimo da senha' },
        password_max_length: {
          label: 'Tamanho máximo da senha',
          help: 'Protege contra negação de serviço por hash de senhas muito longas.',
        },
        password_reject_breached: {
          label: 'Recusar senhas vazadas',
          help: 'Bloqueia senhas encontradas em vazamentos públicos via Have I Been Pwned (verificação por faixa com k-anonimato; a senha nunca é enviada completa).',
        },
        password_require_complexity: {
          label: 'Exigir senhas complexas',
          help: 'Exige que as senhas misturem classes de caracteres (maiúsculas, minúsculas, dígitos, símbolos) no cadastro e na alteração ou redefinição de senha.',
        },
        password_min_classes: {
          label: 'Mínimo de classes de caracteres',
          help: 'Quantas das quatro classes (maiúscula / minúscula / dígito / símbolo) uma senha deve incluir.',
        },
        password_history_count: {
          label: 'Histórico de senhas (sem reutilização)',
          help: 'Impede reutilizar essa quantidade de senhas anteriores na alteração ou redefinição. 0 desativa a verificação.',
        },
        password_expiry_days: {
          label: 'Expiração da senha (dias)',
          help: 'Força a troca de senha após essa quantidade de dias. 0 desativa a expiração. Enquanto a senha estiver expirada, o usuário fica sem acesso aos dados até trocá-la.',
        },
        lockout_threshold: {
          label: 'Limite de bloqueio da conta',
          help: 'Bloqueia uma conta após essa quantidade de tentativas de login seguidas com falha — senhas erradas e códigos de dois fatores errados. Durante o bloqueio, o login é recusado mesmo com as credenciais corretas. 0 desativa o bloqueio na etapa da senha; a verificação em dois fatores mantém então seu limite integrado de 10 tentativas a cada 15 minutos, pois é a última verificação antes de emitir a sessão.',
        },
        lockout_duration_minutes: {
          label: 'Duração do bloqueio (minutos)',
          help: 'Por quanto tempo uma conta fica bloqueada após ultrapassar o limite, em qualquer etapa do login.',
        },
        rate_limit_max: {
          label: 'Limite de autenticação: máximo de requisições',
          help: 'Máximo de requisições por IP, por janela, aos endpoints de login / cadastro / redefinição de senha.',
        },
        rate_limit_window_seconds: {
          label: 'Limite de autenticação: janela (segundos)',
          help: 'Janela deslizante em que o limite de requisições acima é contado.',
        },
        mfa_required: {
          label: 'Exigir autenticação multifator',
          options: { off: 'Desativado', administrators: 'Administradores', everyone: 'Todos' },
          help: 'Usuários sem um autenticador cadastrado perdem o acesso aos dados quando o período de carência termina. Ativar isto também liga o recurso de dois fatores para que os usuários possam se cadastrar.',
        },
        mfa_grace_period_days: {
          label: 'Carência de MFA (dias)',
          help: 'Por quanto tempo os usuários podem adiar o cadastro antes do bloqueio. 0 bloqueia imediatamente.',
        },
        session_expiry_days: {
          label: 'Duração da sessão (dias)',
          help: 'Uma sessão expira essa quantidade de dias após o login.',
        },
        session_refresh_days: {
          label: 'Limite de renovação (dias)',
          help: 'Uma sessão ativa é estendida quando fica mais antiga que isso.',
        },
        session_idle_timeout_minutes: {
          label: 'Tempo limite de inatividade (minutos)',
          help: 'Desconecta o usuário após essa quantidade de minutos de inatividade. 0 desativa.',
        },
        session_absolute_max_hours: {
          label: 'Duração absoluta da sessão (horas)',
          help: 'Força nova autenticação essa quantidade de horas após o login, independentemente da atividade. 0 desativa.',
        },
        max_concurrent_sessions_per_user: {
          label: 'Máximo de sessões simultâneas por usuário',
          help: 'Limita as sessões simultâneas por usuário; as mais antigas são desconectadas além do limite. 0 = ilimitado.',
        },
        allowed_ip_ranges: {
          label: 'Faixas de IP permitidas',
          help: 'Faixas CIDR ou IPs exatos (um por linha ou separados por vírgula), por exemplo 203.0.113.0/24. Quando definido, o login de fora dessas faixas é recusado, assim como qualquer requisição cujo endereço de cliente o servidor não consiga determinar. Vazio = sem restrição. O endereço avaliado é o de origem da conexão; atrás de um proxy reverso, o servidor precisa ser configurado para confiar nesse proxy para que o endereço original do cliente seja avaliado.',
        },
        api_key_default_expiry_days: {
          label: 'Validade padrão da chave (dias)',
          help: 'Uma chave criada sem data de expiração expira essa quantidade de dias após a criação. Nunca mais que a validade máxima abaixo.',
        },
        api_key_max_expiry_days: {
          label: 'Validade máxima da chave (dias)',
          help: 'A data de expiração mais distante que uma nova chave pode pedir, contada a partir da criação. Uma maior é recusada; exatamente essa quantidade de dias é aceita.',
        },
        api_key_inactivity_days: {
          label: 'Expiração por inatividade (dias)',
          help: 'Uma chave sem uso registrado por essa quantidade de dias é recusada. Ela não é revogada; crie uma nova chave. Uma chave nunca usada conta a partir da criação, ou do início da política abaixo quando for mais antiga. 0 desativa a expiração por inatividade.',
        },
        api_key_policy_started_at: {
          label: 'Início da política de chaves',
          help: 'Registrado automaticamente (UTC, ISO 8601) na primeira vez que o servidor roda com esta política. Chaves criadas antes, sem data de expiração, expiram um ano depois disso; chaves sem uso registrado contam a inatividade a partir daí. Alterá-lo move as duas datas das chaves que ainda não as receberam.',
        },
        google_enabled: {
          label: 'Ativar login com Google',
          help: 'Oferece login com Google quando um ID do cliente e uma chave secreta do cliente estão disponíveis: salvos abaixo ou definidos na configuração do servidor, que prevalece sobre os valores salvos. Até que ambos estejam disponíveis, a página de login não mostra o botão do Google, mesmo com isto ativado. Desativado, retira o login com Google mesmo quando o servidor define ambos. Crie o cliente OAuth no Google Cloud Console.',
        },
        google_client_id: {
          label: 'ID do cliente Google',
          help: 'ID do cliente OAuth do Google Cloud Console. Também pode ser definido na configuração do servidor.',
        },
        google_client_secret: {
          label: 'Chave secreta do cliente Google',
          help: 'Armazenado criptografado. Também pode ser definido na configuração do servidor.',
        },
      },
    },
    access_policy: {
      title: 'Política de acesso',
      description: 'As restrições de login desta organização. As configurações de autenticação da implantação sempre se aplicam; estas só podem acrescentar restrições.',
      groups: {
        network: { title: 'Rede', description: 'De onde os membros desta organização podem fazer login.' },
        sessions: { title: 'Sessões', description: 'Por quanto tempo a sessão de um membro permanece válida. Cada limite só pode ser menor que o da implantação.' },
        multi_factor: { title: 'Multifator', description: 'Quem nesta organização deve proteger a conta com um aplicativo autenticador (TOTP).' },
      },
      fields: {
        allowed_ip_ranges: { label: 'Faixas de IP permitidas' },
        session_idle_timeout_minutes: { label: 'Tempo limite de inatividade (minutos)' },
        session_absolute_max_hours: { label: 'Duração máxima da sessão (horas)' },
        max_concurrent_sessions_per_user: { label: 'Máximo de sessões simultâneas por usuário' },
        mfa_required: {
          label: 'Exigir autenticação multifator',
          options: { off: 'Desativado', administrators: 'Administradores', everyone: 'Todos' },
        },
      },
    },

    storage: {
      title: 'Armazenamento de arquivos',
      description: 'Back-end usado para anexos, exportações e uploads dos usuários.',
      groups: {
        adapter: { title: 'Back-end', description: 'Escolha onde os arquivos enviados são armazenados.' },
        local: { title: 'Local' },
        s3: { title: 'S3' },
        limits: { title: 'Limites' },
      },
      keys: {
        adapter: {
          label: 'Adaptador',
          options: { local: 'Sistema de arquivos local', s3: 'S3 / compatível com S3' },
        },
        local_root: {
          label: 'Diretório raiz',
          help: 'Caminho do sistema de arquivos onde os arquivos são armazenados. Caminhos relativos são resolvidos a partir do CWD do servidor.',
        },
        s3_bucket: {
          label: 'Bucket',
          help: 'Bucket compartilhado do host. Os arquivos de cada ambiente ficam separados pelo prefixo projects/<environmentId>/.',
        },
        s3_region: { label: 'Região', help: 'Exemplo: us-east-1' },
        s3_endpoint: {
          label: 'Endpoint',
          help: 'Endpoint personalizado para provedores compatíveis com S3 (R2, MinIO, Wasabi). Deixe em branco para AWS S3.',
        },
        s3_access_key_id: { label: 'ID da chave de acesso' },
        s3_secret_access_key: { label: 'Chave de acesso secreta' },
        s3_force_path_style: {
          label: 'Forçar URLs no estilo de caminho',
          help: 'Ative para MinIO e a maioria dos provedores compatíveis com S3; desative para AWS S3.',
        },
        presigned_ttl: { label: 'Validade da URL pré-assinada (segundos)' },
        session_ttl: {
          label: 'Validade da sessão de upload (segundos)',
          help: 'Por quanto tempo uma sessão de upload em partes continua retomável.',
        },
        max_upload_mb: { label: 'Tamanho máximo de upload (MB)' },
      },
      actions: {
        test: { label: 'Testar conexão' },
      },
      banners: {
        adapter_switch_warning: {
          title: 'Os arquivos existentes não são migrados',
          text: 'Trocar de adaptador não migra os arquivos existentes — arquivos enviados pelo adaptador anterior ficam inacessíveis pelo novo.',
        },
      },
    },
    ai: {
      title: 'IA e Embedder',
      description: 'Provedor de LLM, modelo, credenciais e configuração do Embedder usados pelos serviços de IA e de conhecimento da plataforma.',
      groups: {
        provider: {
          title: 'Provedor',
          description: 'Escolha o back-end de LLM. O modo Memory devolve a entrada — útil para testes, nunca para produção.',
        },
        gateway: {
          title: 'Vercel AI Gateway',
          description: 'Roteador de vários provedores. O modelo é escrito como provider/model, por exemplo openai/gpt-4o.',
        },
        openai: { title: 'OpenAI' },
        anthropic: { title: 'Anthropic' },
        google: { title: 'Google' },
        deepseek: {
          title: 'DeepSeek',
          description: 'API compatível com OpenAI em https://api.deepseek.com. A Base URL é preenchida automaticamente.',
        },
        dashscope: {
          title: '阿里通义 DashScope',
          description: 'Endpoint compatível com OpenAI em dashscope.aliyuncs.com/compatible-mode/v1. A Base URL é preenchida automaticamente.',
        },
        cloudflare: {
          title: 'Cloudflare AI Gateway',
          description: 'Usa o endpoint /compat, então o modelo é escrito como provider/model (por exemplo openai/gpt-4o-mini, anthropic/claude-3-5-sonnet, deepseek/deepseek-chat). Observação: alibaba/qwen* NÃO é compatível com o Cloudflare /compat — use o provedor DashScope para o Qwen.',
        },
        siliconflow: {
          title: '硅基流动 SiliconFlow',
          description: 'Endpoint compatível com OpenAI em api.siliconflow.cn/v1. A Base URL é preenchida automaticamente.',
        },
        openrouter: {
          title: 'OpenRouter',
          description: 'Roteador de vários provedores em openrouter.ai/api/v1. A Base URL é preenchida automaticamente.',
        },
        titles: {
          title: 'Títulos das conversas',
          description: 'Gera automaticamente um título curto de resumo para novas conversas.',
        },
        defaults: {
          title: 'Padrões de geração',
          description: 'Aplicados quando uma requisição de agente ou de chat não informa o próprio valor.',
        },
        observability: { title: 'Observabilidade' },
        embedder: {
          title: 'Embedder',
          description: 'Provedor de texto → vetor usado pelas fontes de conhecimento e pelo RAG. Independente do provedor de chat acima.',
        },
      },
      keys: {
        provider: {
          label: 'Provedor',
          options: {
            memory: 'Memory (eco — apenas testes)',
            gateway: 'Vercel AI Gateway',
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google Generative AI',
            deepseek: 'DeepSeek (compatível com OpenAI)',
            dashscope: '阿里通义 DashScope (compatível com OpenAI)',
            cloudflare: 'Cloudflare AI Gateway (compatível com OpenAI)',
            siliconflow: '硅基流动 SiliconFlow (compatível com OpenAI)',
            openrouter: 'OpenRouter (compatível com OpenAI)',
          },
        },
        gateway_model: {
          label: 'Modelo do Gateway',
          help: 'Usado no lugar do modelo definido na configuração do servidor. Exemplo: openai/gpt-4o',
        },
        gateway_api_key: {
          label: 'Chave de API do Gateway',
          help: 'Opcional — necessária apenas se o gateway exigir autenticação.',
        },
        openai_api_key: {
          label: 'Chave de API do OpenAI',
          help: 'Usada no lugar da chave definida na configuração do servidor. Armazenada criptografada.',
        },
        openai_model: { label: 'Modelo', help: 'ID do modelo padrão. As substituições por agente têm precedência.' },
        openai_base_url: {
          label: 'Base URL',
          help: 'Substituição para Azure OpenAI ou gateways auto-hospedados. Deixe em branco para api.openai.com.',
        },
        anthropic_api_key: {
          label: 'Chave de API do Anthropic',
          help: 'Usada no lugar da chave definida na configuração do servidor. Armazenada criptografada.',
        },
        anthropic_model: { label: 'Modelo' },
        google_api_key: {
          label: 'Chave de API do Google',
          help: 'Usada no lugar da chave definida na configuração do servidor. Armazenada criptografada.',
        },
        google_model: { label: 'Modelo' },
        deepseek_api_key: { label: 'Chave de API do DeepSeek', help: 'sk-... — emitida em platform.deepseek.com.' },
        deepseek_model: { label: 'Modelo', help: 'Exemplos: deepseek-chat (V3), deepseek-reasoner (raciocínio R1).' },
        dashscope_api_key: {
          label: 'Chave de API do DashScope',
          help: 'sk-... — emitida em dashscope.console.aliyun.com.',
        },
        dashscope_model: { label: 'Modelo' },
        cloudflare_account_id: {
          label: 'ID da conta Cloudflare',
          help: 'O ID hexadecimal de 32 caracteres da URL do seu painel da Cloudflare.',
        },
        cloudflare_gateway_id: {
          label: 'ID do gateway',
          help: 'Nome do gateway configurado em Cloudflare → AI Gateway. O padrão é "default".',
        },
        cloudflare_api_key: {
          label: 'Token do Cloudflare AI Gateway',
          help: 'Emitido em AI Gateway → aba "API tokens" (cfut_… ou sk_…).',
        },
        cloudflare_model: { label: 'Modelo' },
        siliconflow_api_key: { label: 'Chave de API do SiliconFlow' },
        siliconflow_model: {
          label: 'Modelo',
          help: 'Exemplos: Qwen/Qwen2.5-72B-Instruct, deepseek-ai/DeepSeek-V3, meta-llama/Meta-Llama-3.1-8B-Instruct.',
        },
        openrouter_api_key: { label: 'Chave de API do OpenRouter', help: 'sk-or-...' },
        openrouter_model: {
          label: 'Modelo',
          help: 'Formato: provider/model (por exemplo anthropic/claude-3.5-sonnet, deepseek/deepseek-chat).',
        },
        title_generation_enabled: { label: 'Resumir automaticamente os títulos das conversas' },
        title_max_length: {
          label: 'Tamanho máximo do título (caracteres)',
          help: 'Limite rígido do título gerado. O que passar disso é truncado no servidor.',
        },
        temperature: { label: 'Temperatura', help: '0 = determinístico, 2 = altamente criativo.' },
        max_tokens: { label: 'Máximo de tokens de saída', help: 'Limite rígido de tokens gerados por resposta.' },
        request_timeout_ms: { label: 'Tempo limite da requisição (ms)' },
        trace_enabled: {
          label: 'Registrar rastros',
          help: 'Mantém um registro de cada requisição de IA e da resposta, para que uma conversa possa ser inspecionada e reproduzida quando algo der errado.',
        },
        log_prompts: {
          label: 'Registrar prompts completos',
          help: 'Inclui os prompts renderizados (não só os metadados) nas linhas de rastro.',
        },
        embedder_provider: {
          label: 'Provedor',
          options: {
            none: 'Desativado (sem embeddings)',
            openai: 'OpenAI',
            azure: 'Azure OpenAI',
            dashscope: '阿里通义 DashScope',
            zhipu: '智谱 BigModel',
            siliconflow: '硅基流动 SiliconFlow',
            doubao: '火山引擎 Doubao',
            minimax: 'MiniMax',
            ollama: 'Ollama (local)',
            custom: 'Personalizado (compatível com OpenAI)',
          },
        },
        embedder_api_key: {
          label: 'Chave de API do Embedder',
          help: 'Token Bearer enviado no cabeçalho Authorization. Para o Ollama, qualquer valor não vazio funciona.',
        },
        embedder_model: {
          label: 'Modelo',
          help: 'Exemplos — OpenAI: text-embedding-3-small · 阿里通义: text-embedding-v3 · 智谱: embedding-3 · 硅基流动: BAAI/bge-m3 · Ollama: bge-m3',
        },
        embedder_base_url: {
          label: 'Base URL',
          help: 'Raiz do endpoint (sem /embeddings). Preenchida a partir da predefinição; substitua para proxies ou gateways auto-hospedados.',
        },
        embedder_dimensions: {
          label: 'Dimensões',
          help: 'Substitui a dimensionalidade de saída (apenas modelos Matryoshka). Deixe em branco para usar o padrão do modelo.',
        },
        embedder_batch_size: {
          label: 'Tamanho do lote',
          help: 'Partes enviadas ao provedor de embeddings em uma requisição. Reduza se atingir os limites de taxa ou tamanho do provedor.',
        },
      },
      actions: {
        test: { label: 'Testar conexão' },
        test_embedder: { label: 'Testar Embedder' },
        reset: { label: 'Redefinir para os padrões do ambiente' },
      },
      banners: {
        log_prompts_warning: {
          title: 'Os prompts podem conter dados pessoais',
          text: 'Pode vazar dados pessoais — desative em ambientes regulados.',
        },
      },
    },
    knowledge: {
      title: 'Conhecimento',
      description: 'Back-end de armazenamento vetorial para RAG e fontes de conhecimento.',
      groups: {
        adapter: {
          title: 'Back-end',
          description: 'Escolha onde as partes dos documentos e seus vetores são armazenados.',
        },
        turso: { title: 'Turso / libSQL', description: 'Funciona com Turso gerenciado, arquivo local ou em memória.' },
        ragflow: {
          title: 'RAGFlow',
          description: 'Implantação externa do RAGFlow. Veja https://ragflow.io para instruções de auto-hospedagem.',
        },
        indexing: {
          title: 'Padrões de indexação',
          description: 'Um valor definido na própria fonte de conhecimento prevalece sobre estes padrões.',
        },
        permissions: { title: 'Permissões' },
      },
      keys: {
        adapter: {
          label: 'Adaptador',
          options: {
            memory: 'Em memória (apenas dev / teste)',
            turso: 'Turso / libSQL (nuvem ou local)',
            ragflow: 'RAGFlow (externo)',
          },
        },
        turso_url: {
          label: 'URL de conexão',
          help: 'Exemplos: libsql://your-tenant.turso.io · file:./.objectstack/knowledge.db · :memory:',
        },
        turso_auth_token: { label: 'Token de autenticação', help: 'Necessário apenas para URLs do Turso gerenciado.' },
        ragflow_base_url: { label: 'Base URL', help: 'Exemplo: http://localhost:9380' },
        ragflow_api_key: { label: 'Chave de API' },
        ragflow_default_dataset: {
          label: 'ID do conjunto de dados padrão',
          help: 'Usado quando uma fonte de conhecimento não indica o próprio conjunto de dados do RAGFlow.',
        },
        chunk_target: {
          label: 'Tamanho-alvo da parte (caracteres)',
          help: 'Limite flexível do tamanho da parte antes de entrar a divisão por tokens.',
        },
        chunk_overlap: {
          label: 'Sobreposição das partes (caracteres)',
          help: 'Caracteres mantidos da parte anterior para que o contexto atravesse o limite.',
        },
        over_fetch: {
          label: 'Multiplicador de busca extra',
          help: 'A busca obtém este múltiplo do número de resultados pedidos, para que sobrem resultados suficientes depois da filtragem pelos detalhes dos documentos.',
        },
        enforce_rls: {
          label: 'Aplicar RLS na busca',
          help: 'Verifica de novo cada resultado com as permissões em nível de registro de quem chamou.',
        },
      },
      actions: {
        test: { label: 'Testar conexão' },
      },
      banners: {
        adapter_switch_warning: {
          title: 'Os índices existentes não são migrados',
          text: 'Trocar de adaptador NÃO migra os índices existentes — documentos indexados pelo adaptador anterior ficam inacessíveis até serem reindexados.',
        },
        enforce_rls_warning: {
          title: 'Mantenha a RLS ativada em produção',
          text: 'Desativar pula a proteção exclusiva da plataforma contra vazamento de dados do armazenamento vetorial — mantenha ativada em produção.',
        },
      },
    },
    lifecycle: {
      title: 'Ciclo de vida dos dados',
      description: 'Por quanto tempo os dados do sistema são mantidos: substitua as janelas de retenção, limite a quantidade de linhas por tabela e receba alertas quando uma tabela cresce inesperadamente. A plataforma aplica isso na limpeza periódica.',
      keys: {
        enabled: {
          label: 'Aplicar políticas de ciclo de vida',
          help: 'Chave geral da limpeza periódica. Desativado = as políticas declaradas de retenção/TTL/rotação deixam de ser aplicadas (os dados voltam a crescer sem limite).',
        },
        retention_overrides: {
          label: 'Substituições de retenção',
          help: 'Substituições de janela por objeto: { "<object>": { "maxAge": "1y", "expireAfter": "30d" } }. As durações usam h/d/w/y. Definidas por organização, para que uma organização regulada guarde anos e uma de desenvolvimento guarde dias. Uma substituição mais curta que o mínimo exigido por um recurso da plataforma (por exemplo, a janela de detecção de duplicatas da fila de tarefas) é ignorada e registrada como erro, e a janela padrão continua valendo.',
        },
        quotas: {
          label: 'Cotas de linhas',
          help: 'Quantidade máxima de linhas por objeto: { "<object>": 1000000 }. Ultrapassar gera um alerta de governança — as cotas nunca excluem além da política declarada.',
        },
        quota_defaults: {
          label: 'Cotas padrão por classe',
          help: 'Cotas de reserva por classe de ciclo de vida: { "telemetry": 1000000, "transient": 500000, "event": 100000, "audit": 5000000 }.',
        },
        growth_alert_rows: {
          label: 'Limite de alerta de crescimento (linhas por varredura)',
          help: 'Alerta quando uma tabela com ciclo de vida declarado cresce mais do que essa quantidade de linhas entre duas varreduras. 0 desativa os alertas de crescimento.',
        },
      },
    },
  },
};
