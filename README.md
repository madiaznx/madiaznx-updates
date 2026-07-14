# MadiaznX Hub

App desktop local para listar `.exe` publicados nos repositorios GitHub de um usuario, instalar a versao mais recente, atualizar quando houver diferenca e baixar versoes anteriores.

## Rodar

```powershell
npm.cmd install
npm.cmd start
```

No PowerShell deste Windows, use `npm.cmd` porque `npm.ps1` pode ser bloqueado pela politica de execucao.

## Gerar setup

```powershell
npm.cmd run build
```

O instalador sai em `dist\MadiaznX-Hub-Setup.exe`. Esse nome fica estavel para poder usar sempre o mesmo link de download no GitHub.
Tambem e criada uma copia com versao, por exemplo `dist\MadiaznX-Hub-Setup-v0.1.0.exe`.

## Publicar atualizacoes do Hub

O app esta configurado para buscar atualizacoes em `madiaznx/madiaznx-updates` via releases do GitHub. Para publicar uma nova versao:

```powershell
$env:GH_TOKEN = gh auth token
npm.cmd version patch
npm.cmd run publish
```

Ao reiniciar, o Hub tenta procurar atualizacao automaticamente. Quando uma atualizacao e baixada, ela e aplicada no proximo restart do app.

## Como funciona

- Ao abrir ou clicar em atualizar, o app consulta os repositorios do usuario configurado.
- Sem token, a abertura usa cache local recente para evitar bloqueio de rate limit do GitHub. O botao atualizar forca uma consulta nova.
- Releases do GitHub sao usadas como fonte principal de versoes.
- Se a opcao estiver marcada, repositorios sem release com `.exe` tambem sao verificados pela arvore de arquivos. Essa opcao fica desligada por padrao porque consome mais limite da API.
- `Instalar` baixa o `.exe` para uma pasta gerenciada em `%LOCALAPPDATA%\MadiaznX Hub\apps`.
- `Atualizar` aparece em azul quando a versao instalada e diferente da versao mais recente encontrada.
- `Desinstalar` remove a pasta instalada e a pasta de dados gerenciada daquele app.
- `Versoes` permite instalar ou baixar executaveis anteriores.
- As opcoes de instalador sao salvas por app. Da para manter o `.exe` gerenciado pelo Hub ou executar o instalador com argumentos como `/S`.

Para repositorios privados ou contas com muitos repositorios, informe um token GitHub com permissao de leitura de repositorios. Sem token, o GitHub pode bloquear temporariamente por IP com `API rate limit exceeded`.

## Observacao

O app remove com seguranca apenas arquivos que ele proprio colocou nas pastas gerenciadas. Se algum `.exe` for executado como instalador tradicional e gravar arquivos em outros lugares do Windows, essa instalacao externa nao e apagada automaticamente.
