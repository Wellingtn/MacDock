# Instalação e restauração — MacDock 1.4

UUID: `macdock-weather-revisado@local`. A versão 1.4 atualiza esse mesmo UUID e mantém suas configurações e anotações.

## Nesta máquina

Os arquivos atualizados são instalados em:
`~/.local/share/gnome-shell/extensions/macdock-weather-revisado@local/`

No GNOME/Wayland, salve seu trabalho, saia da sessão e entre novamente para carregar os módulos novos. Desativar e reativar a extensão não limpa o cache de módulos do Shell.

## Instalar pelo pacote

Na pasta do projeto:

```bash
gnome-extensions install --force dist/MacDock-Clima-v1.4.1.zip
```

Saia e entre na sessão. Se necessário, habilite:

```bash
gnome-extensions enable macdock-weather-revisado@local
```

Mantenha apenas uma extensão de dock ativa. Não altere as configurações do Liquid Glass para aplicar esta atualização: o material original foi preservado.

## Restaurar a versão anterior

Backup criado antes da instalação:
`~/.local/share/macdock-backups/antes-da-versao-1.4-2026-10-17/`

```bash
gnome-extensions disable macdock-weather-revisado@local
tar -xzf ~/.local/share/macdock-backups/antes-da-versao-1.4-2026-10-17/extensao-1.3.tar.gz -C ~/.local/share/gnome-shell/extensions/
```

Saia e entre na sessão; então habilite a extensão. Os arquivos adicionais da versão nova não são importados pela versão antiga.

O backup `configuracoes.dconf` registra as configurações anteriores. A atualização não modifica essas configurações; só restaure esse arquivo se também quiser desfazer escolhas feitas posteriormente:

```bash
dconf load /org/gnome/shell/extensions/macdock-weather-prototype/ < ~/.local/share/macdock-backups/antes-da-versao-1.4-2026-10-17/configuracoes.dconf
```

## Testes

```bash
node tools/check.mjs
python3 tools/test-headless.py
```

O segundo comando usa um GNOME temporário e um player de teste, em sessão privada. Nenhum auxiliar de testes é instalado na sessão pessoal. Veja também [MELHORIAS-1.4.md](MELHORIAS-1.4.md).
