# Deploy no Vercel

O projeto usa Vercel Services para publicar três aplicações no mesmo domínio:

- `web`: Next.js em `apps/web`;
- `api`: NestJS em `apps/api`, exposta em `/api/*`;
- `ocr`: FastAPI em `apps/ocr`, privada e acessada pela API por service binding.

## Criar o projeto

1. Importe o repositório no Vercel.
2. Em **Build and Deployment > Framework Preset**, selecione **Services**.
3. Mantenha a raiz do projeto no diretório raiz do repositório. O arquivo `vercel.json` define os três serviços e as rotas.
4. Ative Fluid Compute. Projetos novos normalmente já recebem suporte a funções grandes; se o bundle Python ultrapassar o limite padrão, adicione `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` e faça um novo deploy.

## Variáveis obrigatórias

Cadastre estas variáveis nos ambientes Preview e Production. Copie os valores do `.env` local sem versioná-los:

```text
APP_MODE=supabase
DATABASE_URL=<session-pooler do Supabase na porta 5432>
DATABASE_SSL=true
DATABASE_SSL_CA=<conteúdo PEM de certs/supabase-prod-ca-2021.crt>
DATABASE_POOL_MAX=2
SUPABASE_URL=<URL do projeto>
SUPABASE_ANON_KEY=<chave pública/publishable>
PIN_PEPPER=<segredo de 32+ caracteres>
OUTBOX_ENCRYPTION_KEY=<64 caracteres hexadecimais>
OCR_SERVICE_TOKEN=<segredo de 32+ caracteres>
OCR_IMAGE_RETENTION_DAYS=0
WHATSAPP_PROVIDER=fake
```

Não configure `OCR_SERVICE_URL`: o binding entre os serviços injeta essa variável automaticamente. `SUPABASE_SERVICE_ROLE_KEY` só é necessário quando a retenção de imagens for maior que zero. Para WhatsApp real, adicione as variáveis `META_*` documentadas no `.env.example`.

Depois do primeiro deploy, configure `WEB_ORIGIN` com o domínio de produção, por exemplo `https://seu-projeto.vercel.app`, e faça novo deploy. Preview deployments usam chamadas same-origin e não dependem dessa variável.

## Verificação

Após o deploy:

1. Abra `/api/health` e confirme `{"status":"ok"}`.
2. Entre com o administrador criado no Supabase.
3. Abra **Fotografar etiqueta**, permita a câmera e faça uma leitura.
4. Confirme que o nome e a unidade continuam sendo sugestões e exigem confirmação humana.

O upload é limitado a 4 MB por causa do limite de payload da Vercel Function. No Vercel, o PaddleOCR usa `PP-OCRv5_mobile_det`; localmente, continua usando o detector server para maior precisão. Os modelos hospedados são baixados no build e incluídos no bundle, evitando download no primeiro atendimento.

As Functions não mantêm loops permanentes. No Vercel, a primeira tentativa de notificação é processada junto do recebimento. Retentativas recorrentes e limpeza de imagens com retenção maior que zero exigem um cron ou worker externo antes de uso em produção.
