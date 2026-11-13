# FUTSAL IQ

Plataforma local de análise de jogos de **futsal** com visão computacional open-source.
Custo: **0 €** — sem APIs pagas, sem subscrições, sem créditos de IA, nada enviado para a nuvem.

```
Vídeo ──► YOLO11 (pessoas + bola) ──► ByteTrack (IDs) ──► cor do equipamento (equipas)
      ──► homografia (imagem → campo em metros, com compensação do movimento da câmara)
      ──► posse, passes, remates, paragens/reinícios, golos candidatos, bolas paradas
      ──► sistemas (3-1, 4-0, 2-2, 1-2-1, power play), blocos, marcação, coberturas, transições
      ──► jogadas ensaiadas (repetição de padrões) ──► scouting individual ──► clips MP4 + relatório PDF
```

## Instalação

Requisitos: **Python 3.10+**, **Node.js 18+**, **FFmpeg** (para exportar clips e converter vídeos).

```bash
# Linux / macOS
./start.sh
# Windows
start.bat
```

O script cria um ambiente virtual Python, instala as dependências (`backend/requirements.txt`),
compila o frontend e arranca o servidor em **http://127.0.0.1:8000**. Na primeira análise o
modelo YOLO (`yolo11n.pt`, ~5 MB) é descarregado automaticamente.

Instalação manual / desenvolvimento:

```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run.py                       # API em :8000 (serve também frontend/dist se existir)

cd frontend && npm install
npm run dev                         # UI em :5173 com proxy /api -> :8000
```

GPU NVIDIA é usada automaticamente se o PyTorch com CUDA estiver instalado; em CPU um jogo de
40 min amostrado a 5 frames/s demora ~20–30 min (medido: ~9–10 frames/s em 4 núcleos com `yolo11n` a 960 px).

## Utilização

1. **Novo jogo** → nomes das equipas (e, opcionalmente, cores das camisolas) → carregar o ficheiro do jogo
   (ou associar um link do YouTube — ver limitação abaixo).
2. **Processamento** → escolher parâmetros (frames/s, modelo, câmara fixa/em movimento, intervalo) → *Iniciar análise*.
   Mostra progresso, velocidade e tempo restante; pode **interromper** e **retomar** (checkpoint em disco).
   Vídeos que o browser não reproduz (AVI, MPEG-4 Part 2, HEVC…) são convertidos para MP4 H.264 automaticamente.
3. **Calibração** → pausar num plano aberto → *Capturar frame* → clicar ≥ 4 referências (cantos, meio-campo,
   marcas de penálti, postes…). As linhas do campo projetadas e o erro de reprojeção permitem validar.
   Com câmara em movimento, adicionar calibrações em vários momentos. Depois: *Recalcular análise* (segundos, sem nova deteção).
4. **Projeto** → marcar o início da 2.ª parte (troca de campo).
5. **Jogadores** → clicar numa caixa no vídeo para localizar o jogador; renomear, mudar equipa/função,
   **fundir** fragmentos do mesmo jogador, ocultar; *Guardar e recalcular*.
6. **Eventos** → rever deteções automáticas (confirmar/rejeitar/editar) e **marcar manualmente** com o teclado
   (G golo, R remate, C canto, D/I livre direto/indireto, L lateral, F fundo, S saída de pressão, 5 jogada 5x4, …; 1/2 escolhe a equipa).
7. **Análise tática**, **Scouting individual**, **Biblioteca de clips** (gerar automaticamente, editar, exportar MP4/ZIP),
   **Estatísticas** e **Relatório** (*Exportar PDF* via impressão do browser).

## O que é medido, estimado e interpretado

Cada conclusão mostra a origem e a confiança:

| Etiqueta | Significado | Exemplos |
|---|---|---|
| **medição** | valor medido diretamente | cobertura de calibração, % bola detetada, marcações do analista |
| **deteção** | evento detetado por regra objetiva | canto/lateral pela posição da bola no reinício, pico de som |
| **estimativa** | valor com incerteza conhecida | posse, passes, remates, distâncias, velocidades |
| **interpretação** | leitura tática derivada | sistema 3-1, pressão alta, marcação à zona, jogada ensaiada |
| **manual** | introduzido pelo analista | eventos marcados, avaliações 1–5, notas |

Regras de honestidade aplicadas:
- Golos automáticos são sempre **candidatos** (pontapé de saída a meio do jogo) e só contam depois de confirmados.
- Uma bola parada só é **jogada ensaiada** se o padrão de movimentos se **repetir** noutra execução da mesma equipa.
- Scouting: percentis apenas com amostra mínima; caso contrário «evidência insuficiente». Itens não mensuráveis
  (receção, drible, leitura de jogo, decisão, antecipação…) são avaliados pelo analista, identificados como tal.
- Distância/velocidade só com calibração e apenas sobre o tempo em que o jogador foi visto; sem extrapolação.
- Sem leitura de números de camisola: identificadores provisórios (Jogador A, B, …) + correção manual.

## YouTube

O leitor oficial incorporado (IFrame API) é a integração permitida para vídeos públicos, mas **não dá acesso
aos frames**, e os Termos do YouTube não permitem descarregar vídeos sem autorização. Por isso:

- **Só com o link**: o jogo é visto no leitor oficial e analisado por **marcação manual** (eventos, clips por
  timestamps, relatório). Sem visão computacional e sem exportação MP4. Funciona até sem o backend ligado
  (projeto guardado só no browser).
- **Análise automática**: carregar o ficheiro do jogo; ou, se o vídeo for seu/da sua equipa, tiver autorização
  ou licença Creative Commons, ativar a **importação** (yt-dlp, a correr no seu computador) confirmando os direitos.

## Armazenamento

- **Browser (IndexedDB)**: lista de projetos, análises (cópia), revisões de eventos, eventos manuais, clips,
  avaliações, notas. Exportar/importar cópia de segurança em *Definições*.
- **Backend (`backend/data/projects/<id>/`)**: vídeo, deteções (`frames.jsonl`, append-only com checkpoint),
  calibrações e correções (`project.json`), resultado (`analysis.json`), clips exportados.

## Limitações conhecidas

- Pesos YOLO genéricos (COCO): a bola de futsal é pequena e detetada de forma intermitente; passes/posse/remates
  dependem disso (a percentagem de deteção da bola é sempre mostrada). Árbitros/suplentes são filtrados por cor e
  pela calibração (fora do campo).
- Separação de equipas por k-means sobre a cor do tronco; com equipamentos parecidos indique as cores.
- Compensação de câmara por homografias ORB+RANSAC entre keyframes: aproximada; repetições/planos fechados
  criam novos segmentos que precisam de calibração própria (ou são re-localizados automaticamente quando a câmara
  principal regressa).
- Livre direto vs. indireto não é distinguível pela imagem → «Livre» + correção manual.
- Compensações defensivas e intenção dos jogadores não são medidas automaticamente.

## Testes

```bash
cd backend && python -m pytest -q
```

Os testes de análise usam um **jogo simulado** com verdade conhecida (`tests/sim.py`: sistema 3-1, bloco baixo,
dois cantos com o mesmo movimento, remate e golo seguido de pontapé de saída) para validar equipas, guarda-redes,
posse, passes, cantos, padrão ensaiado, remate, golo candidato, sistema tático e plausibilidade física.
A deteção/tracking real (YOLO + ByteTrack + upload + conversão + exportação MP4) foi testada ponta-a-ponta com vídeo real.

## Licenças

Código desta aplicação: uso livre pelo autor do projeto. Dependências: Ultralytics YOLO (**AGPL-3.0** — uso
gratuito; distribuir uma versão modificada como serviço implica publicar o código), OpenCV (Apache-2.0),
FastAPI (MIT), React (MIT), yt-dlp (Unlicense), FFmpeg (LGPL/GPL).
