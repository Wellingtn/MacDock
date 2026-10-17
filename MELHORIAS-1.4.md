# MacDock 1.4 — widgets e personalização

## O que mudou

- Layout e fontes dos widgets desenhados no tamanho final, sem ampliação do cartão pronto. Dimensões físicas e escala do monitor tratadas separadamente.
- Música com a mesma altura dos ícones de aplicativos e dos demais widgets, capa recortada na resolução de exibição e controles proporcionais.
- Popups cancelam ocultações pendentes e mantêm o dock aberto até o fechamento. O lado de abertura acompanha a posição do dock.
- Sistema com ícone vetorial próprio, barras de CPU/RAM, histórico das últimas 60 amostras e detalhes de rede, disco e temperatura. CPU/RAM atualizam a cada 2 s; disco e sensores, no máximo a cada 15 s.
- Menu da barra superior refeito: prévia de tamanho, atalhos de posição, cartões de widgets e controles que permanecem abertos durante o ajuste.
- Gerenciador com página inicial “Meu dock”: prévia interativa, seletor visual de tamanho, modos de visibilidade e cartões de widgets. As opções técnicas anteriores continuam na aba Avançado.
- Reordenação de widgets nos dois sentidos, nomes em português e manutenção da ordem ao mudar apenas o clima.

O motor, os shaders, o material Liquid Glass e a forma externa do dock não foram alterados. Preferências e notas existentes são preservadas.

## Aplicar a versão instalada

A sessão Wayland mantém os módulos JavaScript já carregados. **Saia da sessão e entre novamente** para carregar o código atualizado. Não basta desligar e ligar a extensão. Salve seu trabalho antes de sair.

Abra o ícone do MacDock na barra superior → **Personalizar meu dock…**. O player aparece quando um aplicativo compatível com MPRIS possui mídia; a extensão Dock Music independente continua tendo prioridade quando ativa.

A prévia de configuração é ilustrativa. Ela mostra posição, proporção, widgets habilitados e ordem; o dock real se adapta à quantidade de aplicativos e ao espaço disponível.

## Verificação

- `node tools/check.mjs`: sintaxe dos módulos e validação do schema GSettings.
- `python3 tools/test-headless.py`: GNOME Shell 46 em barramento, diretórios e configurações privados; geometria nativa em quatro posições e três tamanhos, escala 2×, popups/autohide, desativação com popup aberto, controles rápidos, ordem após reconstrução parcial e gerenciador completo.
- O teste cria um player MPRIS sintético e um auxiliar **somente na sessão privada temporária**. Não instala nenhum auxiliar na sessão pessoal.
- Capturas e logs ficam no diretório temporário informado pelo teste. É necessário GNOME 46, GJS, GTK4/libadwaita, Python com PyGObject e acesso a um renderizador gráfico.

A validação isolada não substitui a avaliação visual no monitor e nos players reais após o próximo login.
