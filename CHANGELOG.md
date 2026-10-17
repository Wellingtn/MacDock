## 1.4.7
- refinamento visual completo da janela de configuração;
- remoção de referências visíveis de legado da interface;
- README reescrito para apresentação profissional do projeto no GitHub;
- inclusão de imagens do dock e do Liquid Glass para documentação;
- organização da documentação e limpeza do pacote.


## 1.4.6
- identidade visual própria para a janela maior do gerenciador;
- logo MacDock e textos da área Sobre atualizados;
- ajustes visuais no centro de controle sem alterar o funcionamento do dock;
- limpeza de arquivos temporários/obsoletos nas entregas.

## 1.4.4 — contraste da temperatura (17/10/2026)

- Corrige a temperatura branca que desaparecia sobre as nuvens brilhantes.
- Reativa sombra no texto do clima, removida por uma regra global ao final do CSS.
- Aplica um fundo escuro translúcido, discreto e arredondado somente à temperatura.
- Mantém intactos os cinco PNGs, a geometria dos cartões, a proporção e o dimensionamento.
- Não modifica os widgets de música, sistema ou calendário.

# 1.4.1 — 2026-10-17

- Corrige a reativação do detector da borda ao sair dos modos sempre visível e ocultação manual.
- Consulta a posição atual do mouse depois de agrupar eventos de movimento, evitando perder a chegada à borda.
- Cancela detecções pendentes ao trocar o modo de visibilidade.
- Regressão validada com ponteiro virtual no compositor GNOME 46 e sobreposição de janela simulada.

# 1.4 — 2026-10-17

- Renderização nativa dos widgets e escala HiDPI; música alinhada à altura dos aplicativos.
- Popups mantêm o dock visível e cancelam ocultações pendentes.
- Monitor do sistema com gráfico e novo ícone vetorial.
- Novo painel rápido e gerenciador com prévia interativa.
- Ordem preservada em reconstruções parciais e controles de reordenação nos dois sentidos.
- Testes de integração GNOME 46 isolados. Liquid Glass preservado.

# Changelog

## Segunda revisão — estabilidade e widgets refeitos

### Geometria (causa dos cartões "colados" na borda)
- Cartão tinha 60px e o ícone do app 48px (botão de app: 10px de folga em cima, 14px embaixo).
- Agora os cartões novos (clima, sistema, calendário) têm **altura == dash.iconSize**, topo alinhado ao
  ícone (folga lida do tema do botão de app) e o slot tem a altura do botão de app: o dock não cresce.
- Posições calculadas só a partir de números conhecidos (nada lido da alocação do Clutter).
- Música: tamanho 240x60 e posicionamento originais preservados (marcada como `legacy`).

### Estabilidade
- WidgetManager não recria mais todos os widgets quando QUALQUER extensão muda de estado
  (só `dock-music@local`); rajadas de eventos viram uma reconstrução única; mudanças de configuração do
  clima recriam só o clima.
- Corrigido `source_remove` duplo em `ResourceScope.every`.
- Nome do local do clima agora é configurável (`macdock-weather-place`, padrão "Santa Maria").

### Widgets refeitos (base 48px, raio 14, mesma linguagem visual)
- Clima 208x48, Sistema 188x48 (CPU/RAM com barras), Calendário 176x48 (bloco de data).

## Revisão de alinhamento, widgets e abrangência do Liquid Glass

### Corrigido
- **Widget de clima desalinhado na 1ª ativação.** Causa provável (hipótese; confirmar em sessão real):
  o `slot` no `BoxLayout` do dash tinha `y_align: FILL` e era esticado além de `width/height`, e a
  centralização só rodava em `notify::width/height` (propriedades pedidas), lendo valores que mudam
  de significado entre "pedido" e "alocado". Agora: slot com `x/y_align: CENTER`, centralização
  baseada na caixa de ALOCAÇÃO, reaplicada (adiada) em `notify::allocation`, `notify::mapped` e
  `icon-size-changed`, com pivô de escala explícito.

### Design
- Clima: raio interno 14px, sombra de texto, tiles horária/diária com mesma largura no popup.
- CPU/Sistema: duas métricas (CPU, RAM) com barra e cor por limiar (60%/85%).
- Calendário: bloco de data no cartão; grade de células fixas 32px; hoje/seleção/nota distintos.
- CSS de `.macdock-widget*`/calendário não existia no stylesheet de referência: foi criado.

### Liquid Glass
- Novos modos `liquid-glass-scope` (dock|custom|full) e `liquid-glass-surfaces`.
- Superfícies: painel, menus/pop-ups, configurações rápidas, calendário/data, notificações.
- Indisponíveis (exibidas como tal): visão geral, grade de apps, Arquivos, janelas de apps.
- Padrão `dock`: módulo `surfaces.js` nem é importado.

# 0.2.1-liquid-glass-test — 2026-10-14

- Isola a identidade da classe do dock para evitar injeção duplicada de fundo pelo Blur My Shell.
- Mantém o vidro abaixo do dock após reordenação de atores e invalida capturas antigas.
- Adiciona Liquid Glass ao seletor; Glass, Classic, Minimal e Custom removem o renderizador óptico.
- Sincroniza seletor/interruptor e agrupa transições para evitar recriações intermediárias.
- Corrige reset com Liquid Glass ativo e remove conversão automática de presets em Custom durante sincronização.
- Garante processamento da prontidão após a primeira pintura em cenas paradas, sem loop contínuo.
- Testa alternância repetida, ícones, atores abandonados e ordem de pintura.

# 0.2.0-liquid-glass-test — 2026-10-14

- Integra renderizador Liquid Glass anterior com captura do compositor, blur, refração e bordas.
- Adiciona GSettings/preferências, economia, diagnóstico e fallback convencional.
- Isola schema, GTypes, notas e cache do MacDock original.
- Corrige geometria, início do watchdog e limpeza de atores descartados.
- Amplia testes reais privados e fornece capturas comparativas e guia de recuperação.
- Versão experimental: consulte docs/LIQUID-GLASS-TEST.md para evidências e limitações.


## 0.1.1-dev — 2026-10-13 (fundação em validação)

- Auditoria da base recebida, roadmap 0.1–1.0 e arquitetura documentados.
- Migração procura schema local ou global; preserva destino, valida tipo/faixa e permite repetir após fonte indisponível ou falha de escrita.
- Namespace MacDock para GTypes herdados; rejeição de inicialização quando outras extensões de dock está ativo, sem desativá-lo.
- Indicador opcional na barra existente e controles de autohide, favoritos, aplicativos abertos e preferências.
- Instância do gerente alcançável durante inicialização; limpeza do painel/shutdown independente; ThemeManager idempotente, destruição do ator CSS temporário e pressure barrier.
- Preferências: monitores atualizados sem acúmulo, proteção para ausência de primário, desconexão de sinais e proxy ao fechar; identificação MacDock e créditos upstream explícitos.
- Metadata limitado ao alvo GNOME 46, sem anunciar testes concluídos; schema declarado.
- Build local com versões fixadas, checks, teste GJS em memória, ZIP determinístico e instruções próprias.

Esta é uma prévia de desenvolvimento, não a conclusão da etapa 0.1 nem a versão 1.0. Ver docs/TESTING.md para resultados e pendências. Não contém widgets nem Appearance Engine.

## 0.1 — base recebida

Base inicial com UUID/schema próprios, migração inicial e indicador básico. Sem histórico Git ou evidência de execução fornecidos.
