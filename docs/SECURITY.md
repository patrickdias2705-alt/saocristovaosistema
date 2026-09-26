# Segurança

## Fronteiras de confiança

O navegador recebe somente a chave pública do Supabase. Tokens são validados pela API com `auth.getUser`; nenhum papel vindo de `user_metadata` participa da autorização. Condomínio e portaria enviados pelo cliente são pedidos de contexto, não permissões.

A API usa um login PostgreSQL dedicado que assume `sc_api` ou `sc_worker` dentro de cada transação. Em seguida define `request.jwt.claim.sub` apenas com a identidade já validada. RLS consulta memberships e user_gatehouses persistidos. Tabelas expostas não concedem acesso a `anon` ou `authenticated`.

## Dados pessoais e segredos

- PIN: seis dígitos gerados por CSPRNG, hash scrypt com salt e índice HMAC com pepper, condomínio e portaria. Não é armazenado em claro na encomenda.
- Payload de notificação: AES-256-GCM, chave server-side, retenção máxima de 24 horas. Envio Meta bem-sucedido remove o payload.
- Fotos: bucket privado, sem políticas de browser. Padrão de retenção zero; quando habilitadas, o caminho inclui condomínio e expiração de 1 a 30 dias.
- Logs técnicos: request ID, método, status e duração. Não registram nomes, telefones, etiqueta, PIN, bearer token ou resposta do provider.
- Chaves service role, Meta, pepper e criptografia nunca usam prefixo público do Next.js.

## Controles operacionais

Recebimento exige `recipientConfirmed: true` e vínculo consistente entre condomínio, portaria, unidade, morador e OCR. O pacote, eventos, auditoria e outbox são gravados na mesma transação. Idempotência evita duplicação por retry.

Retirada bloqueia a linha (`FOR UPDATE`), valida a transição e registra um único evento. Histórico e auditoria possuem trigger de imutabilidade. Cancelamento, devolução e ocorrência exigem motivo. Busca de PIN e OCR têm limites persistidos por usuário; há também rate limit HTTP por instância.

Webhook Meta verifica HMAC com `META_APP_SECRET`; atualizações de status são monotônicas. O worker usa lease e `SKIP LOCKED`. Uma queda depois de a Meta aceitar o envio e antes do commit local pode gerar duplicação, porque a API externa não oferece uma transação conjunta. Monitorar IDs do provider e informar essa limitação operacional.

## Produção

Usar TLS, secrets manager, senha PostgreSQL exclusiva, rotação de chaves, JWT curto e revogação de sessões em desligamento de funcionário. Rodar Supabase advisors, testes RLS nativos e restauração de backup antes do piloto. Separar worker da API quando houver mais de uma réplica e proteger Swagger fora de desenvolvimento.

O modo demo é uma fronteira explícita: loopback, identidade simulada, PostgreSQL embarcado e dados fictícios. Ele falha em produção e nunca habilita Meta.
