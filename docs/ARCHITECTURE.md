# Arquitetura

O Pass-Man não requer build nem servidor para funcionar: `index.html` pode ser aberto diretamente no navegador. Os módulos em `src/` documentam e isolam regras reutilizáveis do domínio; `app.js` mantém cópias compatíveis dessas regras para preservar o uso direto por `file://`.

| Módulo | Responsabilidade |
|---|---|
| `src/crypto.js` | primitivas Web Crypto e conversão Base64 |
| `src/storage.js` | chaves e acesso seguro ao armazenamento local |
| `src/vault.js` | operações de ordenação do cofre |
| `src/recovery.js` | formato da chave de recuperação |
| `src/ui.js` | comportamentos reutilizáveis de interface |
| `app.js` | orquestração, renderização, eventos e camada de compatibilidade para execução direta |

Essa separação permite testar regras do domínio sem depender do DOM e manter a interface desacoplada das estruturas de armazenamento.
