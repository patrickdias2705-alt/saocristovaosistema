# Regras permanentes

- TypeScript strict; não usar `any` sem justificativa real.
- Regras de negócio e transições de status pertencem ao domínio da API, nunca ao React.
- Browser não executa operações privilegiadas; secrets nunca vão ao frontend/repositório.
- Entidades tenant-owned têm condominium_id; tabelas sensíveis têm RLS.
- Isolar condomínio e portaria também no banco; não confiar em roles do cliente.
- OCR é sugestão e nunca confirma destinatário sozinho.
- Mudanças operacionais geram evento/auditoria na mesma transação. Não excluir histórico.
- Consultar docs/ARCHITECTURE.md para arquitetura, DATABASE.md para banco, OCR.md para OCR e SECURITY.md para autenticação, autorização e dados pessoais.
- Antes de concluir alterações, executar lint, typecheck e testes relacionados; reportar limitações reais.
