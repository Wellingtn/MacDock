# Instalação e restauração — MacDock 1.4.7

Este guia se refere à edição **pública**. O código-fonte pode ser consultado diretamente no [GitHub](https://github.com/Wellingtn/MacDock).

- **Nome:** MacDock
- **Versão:** 1.4.7
- **UUID público:** `macdock@wellingtn.github.io`
- **GNOME Shell:** 46 (outras versões ainda não validadas)
- **Download:** anexo `MacDock-v1.4.7-INSTALAR.zip` na página [Releases](https://github.com/Wellingtn/MacDock/releases), **quando disponível**

## Atenção antes de instalar

O UUID público é diferente do UUID das versões de desenvolvimento (`macdock-weather-revisado@local`). Portanto, o GNOME trata os dois como **extensões distintas**. O pacote novo não substitui automaticamente a instalação antiga e não migra necessariamente suas configurações.

Não execute duas extensões de dock simultaneamente. Faça backup de sua instalação e configurações se desejar poder voltar à versão de desenvolvimento.

## Instalar

Baixe o **anexo instalável** da Release, não o arquivo automático *Source code (zip)*. Com o ZIP na pasta Downloads:

```bash
gnome-extensions install --force "$HOME/Downloads/MacDock-v1.4.7-INSTALAR.zip"
```

No GNOME/Wayland, encerre a sessão e entre novamente. Se necessário:

```bash
gnome-extensions enable macdock@wellingtn.github.io
```

Se outra extensão de dock estiver ativa, desative-a pelo gerenciador de extensões antes de habilitar o MacDock público.

## Backup e retorno à instalação anterior

A versão pública usa a pasta:

```text
~/.local/share/gnome-shell/extensions/macdock@wellingtn.github.io/
```

A edição antiga de desenvolvimento usa:

```text
~/.local/share/gnome-shell/extensions/macdock-weather-revisado@local/
```

Para voltar à versão antiga, desative o MacDock público e reative a extensão de desenvolvimento **somente se ela ainda estiver instalada**:

```bash
gnome-extensions disable macdock@wellingtn.github.io
gnome-extensions enable macdock-weather-revisado@local
```

Encerre a sessão e entre novamente. Este procedimento não sobrescreve as configurações; não restaure valores do `dconf` sem necessidade.

## Status de validação

A presença do código no GitHub não comprova a compatibilidade em todas as instalações. Antes de publicar no GNOME Extensions, confirme pelo menos instalação, ativação, abertura das preferências, widgets e desativação no GNOME 46. Relate problemas em [Issues](https://github.com/Wellingtn/MacDock/issues).
