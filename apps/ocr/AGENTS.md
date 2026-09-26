# OCR

- Consulte ../../docs/OCR.md antes de alterar providers/parser.
- OCR só retorna sugestões. Nunca acessa banco, Auth ou WhatsApp.
- Não registrar imagens, texto de etiquetas, tokens ou destinatários nos logs.
- Validar conteúdo, tamanho e dimensões antes de decodificar; endpoint interno autenticado.
- Executar ruff check e pytest. Testes de parser não comprovam inferência Paddle real.
