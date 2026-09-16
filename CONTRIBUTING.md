# Como contribuir

Obrigado por contribuir com o Pass-Man.

## Ambiente local

Não há dependências nem etapa de build. Sirva a pasta por localhost:

```bash
python -m http.server 8080
```

Depois abra `http://localhost:8080` em um navegador moderno.

## Fluxo de contribuição

1. Crie uma branch curta e descritiva.
2. Faça uma alteração por objetivo.
3. Teste os fluxos de primeiro acesso, desbloqueio, criação/edição de cards, backup, importação e recuperação.
4. Não use credenciais reais em screenshots, testes ou commits.
5. Descreva no pull request o problema, a solução e como foi validada.

## Regras de segurança

- Não registre chaves, senhas, texto descriptografado ou conteúdo de backups no console.
- Preserve a compatibilidade dos formatos criptografados existentes ou forneça uma migração explícita.
- Não introduza recursos externos sem necessidade e sem atualizar a Content Security Policy.
- Relatos de vulnerabilidade devem seguir [SECURITY.md](SECURITY.md), não issues públicas.

## Estilo

Use JavaScript, HTML e CSS nativos. Prefira funções pequenas, nomes claros, mudanças acessíveis por teclado e textos em português do Brasil.
