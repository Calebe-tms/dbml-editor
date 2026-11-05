# DBML Editor

Editor e visualizador de diagramas ER para arquivos **DBML**, estilo dbdiagram.io, que roda localmente no Windows.
Dê um duplo clique num `.dbml` e ele abre no Chrome (ou Edge): código à esquerda, diagrama à direita.

- Arraste as tabelas para organizar o diagrama (as posições ficam salvas por arquivo).
- Clique numa tabela e o código rola até ela; mova o cursor no código e a tabela é destacada.
- O diagrama atualiza enquanto você digita; erros de sintaxe aparecem com a linha.
- `Ctrl+S` grava direto no `.dbml`. Se o arquivo mudar em disco, o editor recarrega.
- Sem dependências: parser DBML próprio, tudo offline, nenhum npm.

## Instalação (Windows 10/11)

```powershell
git clone <url-deste-repositorio>
cd <pasta>\dbml-viewer
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

O instalador compila um launcher `DbmlViewer.exe` (com o `csc.exe` que já vem no Windows) e associa `.dbml` ao seu usuário, sem admin.
No primeiro duplo clique escolha **DBML Editor** e **Sempre**. Para desfazer: `.\install.ps1 -Uninstall`.
Não mova a pasta depois de instalar; se mover, rode o instalador de novo.

Para testar sem instalar: `powershell -File dbml-viewer\open-dbml.ps1 -Path dbml-viewer\sample.dbml`.

## Como funciona

`open-dbml.ps1` sobe um servidor HTTP local (só `127.0.0.1`, com token aleatório na URL) que serve a página e grava o arquivo;
ele encerra sozinho ao fechar a janela. Layout e preferências ficam em `%APPDATA%\dbml-viewer`.

Navegador: Chrome, ou Edge se não houver Chrome (configurável no topo de `open-dbml.ps1`).

## Suporte DBML

`Table` (alias, `headercolor`, notas, `indexes`), `Enum`, `Ref` (`>`, `<`, `-`, `<>`, inline, em bloco, compostas), schemas e nomes entre aspas.
`Project` e `TableGroup` são lidos mas não desenhados; `TablePartial` é ignorado.

## Estrutura

| Arquivo | Função |
|---|---|
| `dbml-viewer/viewer.html` | página e estilos |
| `dbml-viewer/js/parser.js` | tokenizer e parser DBML |
| `dbml-viewer/js/layout.js` | organização automática das tabelas |
| `dbml-viewer/js/editor.js` | editor de código com realce |
| `dbml-viewer/js/app.js` | diagrama, arrastar, salvar, sincronização código ↔ diagrama |
| `dbml-viewer/open-dbml.ps1` | servidor local + abre o navegador |
| `dbml-viewer/DbmlViewer.cs` | launcher sem janela usado no duplo clique |
| `dbml-viewer/install.ps1` | associação de arquivos |
