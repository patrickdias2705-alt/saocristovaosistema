# Banco de dados

`condominium_id` está presente em toda entidade pertencente ao cliente. Chaves estrangeiras compostas impedem relacionar portaria, unidade, morador, OCR, pacote, evento ou notificação de condomínios diferentes. Todas as FKs usadas em busca/join têm índice correspondente.

## Núcleo

- `profiles`, `memberships`, `user_gatehouses`: identidade e autorização persistida;
- `condominiums`, `gatehouses`, `blocks`, `units`, `residents`: cadastro multi-condomínio;
- `package_ocr_results`: resultado estruturado e caminho privado opcional da foto;
- `packages`: registro atual e invariantes de transição;
- `package_events`, `audit_logs`: históricos imutáveis;
- `notifications`: outbox com lease, retry, status Meta e payload cifrado;
- `rate_limits`: limites sensíveis por identidade.

Estados de pacote: `WAITING_PICKUP`, `PICKED_UP`, `INCIDENT`, `RETURNED`, `CANCELED`. O trigger aceita apenas transições declaradas. Eventos usam `sequence_no` para preservar a ordem causal mesmo quando vários registros compartilham o timestamp da transação.

## RLS

`private.is_member`, `private.is_admin` e `private.can_gate` têm `SECURITY DEFINER` e `search_path` vazio. Operador e supervisor veem somente portarias associadas; administrador vê o condomínio; super-admin é um atributo server-managed de `profiles`. O worker tem políticas próprias e não depende de uma identidade humana.

Migrations são versionadas em `supabase/migrations`. `supabase db reset` aplica migrations e `seed.sql`. O modo demo mantém uma tabela interna de migrations para evoluir o PostgreSQL embarcado sem descartar dados fictícios.
