# Arquitetura e decisões

Monorepo pnpm: Next.js/React (web), NestJS REST (api), FastAPI/PaddleOCR/OpenCV (ocr). Contratos Zod compartilhados. Sem Turborepo, Redis ou TanStack Query neste slice: não trazem benefício que justifique mais infraestrutura.

Web → API autenticada → serviços de domínio → transação PostgreSQL. A API usa Supabase Auth para validar cada access token com getUser; autorização é lida de memberships/user_gatehouses, nunca de user_metadata. A conexão da API assume sc_api com SET LOCAL ROLE em cada transação e define somente a identidade validada. RLS calcula condomínio/portarias pela associação persistida.

O condomínio e a portaria selecionados são contexto solicitado, não permissão. Mesmo sem filtro na consulta, RLS impede vazamento. SUPER_ADMIN tem acesso explícito de plataforma; operadores e supervisores só operam portarias associadas. Admins abrangem o condomínio.

Recebimento só existe após confirmação humana. Rascunhos são transitórios; o primeiro estado persistido é WAITING_PICKUP. Criação, confirmação, outbox e auditoria são atômicos. Retirada usa lock de linha e comando de domínio; cancelamento exige motivo. Incidentes preservam o pacote e podem ser resolvidos. Não há exclusão operacional.

Notificações: outbox PostgreSQL, worker com lease e SKIP LOCKED, backoff limitado, payload AES-GCM. Envio fora da transação. Falha não desfaz pacote. Sem garantia exactly-once externa: uma queda após aceitação Meta e antes do commit pode duplicar o aviso. Monitorar e comunicar essa limitação.

Modo demo explícito: PostgreSQL WASM (PGlite) persistente e identidade simulada, somente loopback e nunca NODE_ENV=production. Executa as mesmas migrations, RLS e serviços de domínio. Não substitui validação Supabase/PostgreSQL nativo nem teste de concorrência com múltiplas réplicas. OCR real continua em processo Python separado; fixture OCR só em teste automatizado.

Decisões visuais: operação sem sidebar, recebimento dominante, navegação curta, PIN como comprovante temporário. Administração separada, métricas simples. pt-BR, teclado e tablet, verde escuro institucional, números tabulares. Atualização periódica leve enquanto visível, sem infraestrutura realtime inicial.
