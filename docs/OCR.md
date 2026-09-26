# OCR

O serviço FastAPI é interno, autenticado por `X-Service-Token` e limitado a uma inferência simultânea por processo. Aceita JPEG, PNG e WebP até 4 MB e 16 megapixels, respeitando o limite de payload das Vercel Functions. A API principal valida o tipo real, corrige orientação EXIF, reduz para no máximo 2000 px e converte para JPEG antes de chamar o OCR.

PaddleOCR PP-OCRv5 em português/latim extrai linhas e scores. O parser separa semanticamente as seções de destinatário e remetente. Quando encontra um marcador como `Destinatário`, `Recebedor`, `Entrega para` ou `Ship to`, nome, bloco, apartamento e endereço são extraídos apenas dessa seção. Rastreamento e transportadora continuam globais porque descrevem a remessa. Se a etiqueta identificar somente o remetente, os campos do destinatário ficam `null` para conferência manual. Confidence é o score do modelo limitado ao intervalo 0..1 e não representa probabilidade calibrada.

O modelo aquece no lifespan do FastAPI antes de `/health` responder com `modelLoaded: true`. Em falha ou baixa legibilidade, a interface oferece nova foto e cadastro manual. Todo resultado é sugestão: somente o operador cria o pacote após selecionar morador/unidade e marcar a confirmação.

`test_parser.py` cobre parser, imagem inválida e autenticação. `smoke.py` executa o modelo real sobre `docs/demo-label.png`; esse smoke baixa modelos na primeira execução e depende da plataforma. O teste E2E usa o mesmo arquivo pelo navegador e atravessa a API real.
