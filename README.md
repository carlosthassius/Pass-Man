# Pass-Man

Gerenciador local de senhas operacionais com uma identidade inspirada em jogos de labirinto. O projeto combina uma interface leve com controles criptográficos para guardar credenciais de ambientes OT sem enviar dados a serviços externos.

Projeto desenvolvido por **Carlos Thassius**.

> **Local-first:** o cofre existe somente no armazenamento do navegador. Limpar os dados do site, trocar de perfil/navegador ou remover o armazenamento local pode apagar o cofre. Exporte e guarde backups criptografados fora do navegador.

## Visão geral

O Pass-Man cadastra, pesquisa, edita e exclui credenciais compostas por título, login e senha. Os registros ficam em um cofre criptografado no navegador e só permanecem legíveis em memória enquanto a sessão está desbloqueada.

Principais recursos:

- gerador criptograficamente seguro de senhas;
- escolha de comprimento e classes de caracteres;
- avaliação de força e score educativo;
- backup criptografado completo ou seletivo;
- chave independente para cada backup;
- autoteste criptográfico antes do download;
- importação autenticada;
- classificação por criticidade, sistema, área, proprietário e fornecedor;
- limpeza programada da área de transferência após dois minutos;
- temas claro e escuro;
- orientações de gestão de credenciais;
- interface responsiva.

## Importância

Ambientes de tecnologia operacional possuem requisitos particulares de disponibilidade, segurança e rastreabilidade. Senhas fracas, reutilizadas ou compartilhadas ampliam o impacto de acessos indevidos a IHMs, estações de engenharia, sistemas SCADA e conexões de fornecedores.

O Pass-Man oferece organização, geração de credenciais fortes e feedback educativo. É um projeto local demonstrativo e não substitui uma solução corporativa auditada de PAM, IAM ou gestão de segredos.

## Execução

O projeto não exige build nem instalação de pacotes:

1. Baixe os arquivos.
2. Abra **index.html** em um navegador moderno.
3. No primeiro acesso, crie e confirme uma chave mestra com pelo menos 8 caracteres, incluindo letras maiúsculas e minúsculas, número e caractere especial.
4. Baixe e guarde a chave de recuperação gerada pelo Pass-Man. Ela é exigida caso a chave mestra seja perdida e é invalidada após cada recuperação.
5. Cadastre os acessos ou utilize o gerador.

Para maior consistência da Web Crypto API, sirva a pasta por localhost ou HTTPS:

    python -m http.server 8080

Depois acesse **http://localhost:8080**.

## Estrutura

    Pass-manager/
    ├── index.html    # estrutura, navegação, formulários e modais
    ├── styles.css    # temas, responsividade e identidade visual
    ├── app.js        # cofre, criptografia, backup, sessão e score
    └── README.md

## Arquitetura criptográfica

### Cofre local

Título, login, senha e metadados são serializados em um payload JSON e cifrados com **AES-256-GCM**, fornecendo confidencialidade e autenticação.

- AES-GCM com chave de 256 bits;
- IV aleatório de 96 bits, renovado em cada gravação;
- salt aleatório de 128 bits;
- PBKDF2-HMAC-SHA-256 com 600.000 iterações;
- chave AES criada como CryptoKey não exportável.

O armazenamento contém somente metadados criptográficos, salt, IV e ciphertext. Login e título recebem a mesma proteção da senha.

### Chave mestra e memória

A chave mestra não é salva. Ela protege uma chave interna do cofre, que por sua vez cifra os dados. A chave interna existe apenas em memória após o desbloqueio; as credenciais descriptografadas também são retiradas do estado e da tela no bloqueio.

No primeiro acesso, o aplicativo baixa uma chave de recuperação com identificador único. Esse arquivo é necessário para redefinir uma chave mestra perdida no mesmo cofre local. Ao concluir a recuperação, o arquivo utilizado é invalidado e uma nova chave de recuperação é baixada.

A sessão possui limite absoluto de uma hora. Recarregar a aplicação exige novo desbloqueio, pois a chave não é persistida no sessionStorage.

### Backups independentes

Cada exportação solicita uma chave exclusiva e permite selecionar todos os cards ou somente registros específicos. Para cada arquivo são criados novo salt, nova chave derivada e novo IV.

A chave mestra do cofre e a chave derivada nunca são incluídas no arquivo. Na importação, a senha do backup autentica e descriptografa o envelope. Os registros recuperados são imediatamente recifrados com a chave do cofre destinatário.

Estrutura resumida do envelope:

    {
      "app": "Pass-Man",
      "version": 2,
      "encryption": {
        "algorithm": "AES-256-GCM",
        "kdf": "PBKDF2-HMAC-SHA-256",
        "iterations": 600000
      },
      "salt": "base64",
      "iv": "base64",
      "ciphertext": "base64",
      "scope": "full",
      "itemCount": 10
    }

Alterações no ciphertext ou senhas incorretas fazem a autenticação AES-GCM falhar.

Antes de disponibilizar o download, a aplicação descriptografa em memória o envelope recém-criado e compara o conteúdo recuperado com os cards selecionados. O arquivo só é baixado se autenticação, descriptografia e comparação forem concluídas corretamente.

## Migração

Versões anteriores utilizavam **passman_credentials_v1**. Após um desbloqueio válido, registros antigos são migrados para **passman_encrypted_vault_v2**, e a cópia em texto aberto é removida.

## Gerador

O gerador utiliza **crypto.getRandomValues()**, não Math.random(). O usuário escolhe comprimento entre 6 e 64 caracteres, letras maiúsculas, minúsculas, números e símbolos. O algoritmo garante ao menos um caractere de cada classe selecionada e embaralha o resultado.

## Score

O score é calculado em tempo real e não é persistido:

- cada card soma 100 pontos;
- a força soma até 300 pontos por card;
- comprimento e variedade elevam a avaliação;
- padrões previsíveis e repetições reduzem a força;
- reutilização gera recomendações.

| Pontos | Nível |
|---:|---|
| 0 | Iniciante |
| 500 | Básico |
| 1.500 | Intermediário |
| 3.000 | Avançado |
| 6.000 | Expert |
| 9.000 | Master |

O score é educativo e não representa certificação ou garantia de segurança.

### Indicador visual de força

O indicador do card usa uma escala mais tolerante, baseada no comprimento, variedade de caracteres e padrões previsíveis:

- **Fraca**: abaixo de 40 pontos — monstrinho vermelho;
- **Média**: de 40 a 64 pontos — monstrinho amarelo;
- **Forte**: 65 pontos ou mais — carinha feliz.

Como referência, uma senha de 8 caracteres que mistura maiúscula, minúscula, número e símbolo tende a ficar como média; a partir de aproximadamente 9 caracteres com essa mesma variedade, ela passa para forte. Sequências comuns, repetições e termos como `senha`, `password`, `admin`, `1234` ou `qwerty` reduzem a pontuação.

## Privacidade

Não existe backend, telemetria ou envio de credenciais. Dados sensíveis permanecem no navegador e nos backups escolhidos pelo usuário.

A aplicação não referencia fontes, scripts, estilos ou imagens hospedados externamente. Utiliza fontes do sistema e uma Content Security Policy que define **connect-src 'none'**, bloqueando conexões iniciadas pela página. Os arquivos executáveis foram verificados estaticamente para confirmar a ausência de URLs e importações externas.

Dados locais:

- envelope criptografado do cofre, incluindo credenciais e classificações;
- salt, IV e parâmetros criptográficos públicos;
- preferência de tema;
- horário de expiração da sessão;
- nenhuma chave mestra persistida.

## Área de transferência

Depois de copiar login ou senha, o Pass-Man agenda a substituição da área de transferência por conteúdo vazio após dois minutos. Navegadores podem recusar essa operação quando a página perde foco ou a permissão de clipboard é retirada; nesse caso, a aplicação informa a falha. O comportamento não substitui políticas de clipboard do sistema operacional.

## Classificação operacional

Cada card pode receber:

- criticidade: baixa, média, alta ou crítica;
- sistema;
- área;
- proprietário;
- fornecedor.

Esses campos são incluídos dentro do payload criptografado e participam da busca local. Não são gravados separadamente em texto aberto.

## Validação offline

O teste estático confirmou que **index.html**, **styles.css** e **app.js** não possuem referências HTTP, importações de fontes ou recursos externos. A CSP bloqueia conexões de saída da aplicação. Como teste de aceitação, recomenda-se também abrir, cadastrar, bloquear, desbloquear, exportar e importar um cofre em uma estação com os adaptadores de rede desativados.

## Limitações e modelo de ameaça

Criptografia em repouso não protege o conteúdo enquanto o cofre está aberto. Código malicioso na mesma origem, extensões comprometidas, malware, captura de teclado ou uma estação já comprometida ainda podem acessar informações.

Para produção, considere CSP restritiva, hospedagem HTTPS, revisão independente, MFA, trilhas de auditoria, integração com PAM, segmentação OT, endurecimento da estação e procedimentos de recuperação e rotação de chaves.

### Nota importante sobre recuperação

A chave de recuperação redefine a chave mestra apenas enquanto o cofre local ainda existe. Ela não substitui um backup: se os dados do navegador forem apagados, restaure a partir de um backup criptografado exportado anteriormente.

## Tecnologias

- HTML5 semântico;
- CSS responsivo;
- JavaScript sem frameworks;
- Web Crypto API;
- Web Storage API;
- SVG próprio.

## Identidade visual

A marca utiliza personagem circular original, labirintos e pontos de percurso como referência genérica a jogos arcade. Nenhum sprite, logotipo ou ativo oficial de terceiros é distribuído.

## Autor

**Carlos Thassius**

Projeto criado para estudo, portfólio e conscientização sobre gestão de credenciais operacionais.

## Código aberto

O projeto é distribuído sob a [Licença MIT](LICENSE). Veja [CONTRIBUTING.md](CONTRIBUTING.md) para contribuir, [SECURITY.md](SECURITY.md) para reportar vulnerabilidades e [docs/screenshots](docs/screenshots/README.md) para preparar as imagens do repositório.
