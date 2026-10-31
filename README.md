# Twenty Two Barbershop

Site de [@twentytwo_22barber](https://www.instagram.com/twentytwo_22barber/) com marcações online
ligadas ao Google Calendar.

- `index.html`, `styles.css`, `booking.js` — o site (estático; pode ir para o GitHub Pages).
- `apps-script/` — o "backend" das marcações, corre grátis no Google Apps Script.

## Como funcionam as marcações

1. O cliente escolhe serviço → dia → hora (só aparecem horários livres no Google Calendar do barbeiro).
2. Preenche nome, email e telemóvel e confirma.
3. A marcação é criada como evento no Google Calendar do barbeiro, e o barbeiro recebe um email de aviso.
4. O cliente vê o ecrã "Marcação confirmada!" e recebe um email com os detalhes, botões
   **Google Calendar** / **Outlook, iCal, outros**, o ficheiro `.ics` e um link para **cancelar**.

Para bloquear horários (almoço, folgas, férias), basta criar um evento no Google Calendar.

Enquanto o `API_URL` em `booking.js` estiver vazio, o site está em **modo demonstração**
(horários fictícios, nada é guardado).

## Instalação (uma vez, ~10 minutos)

Com a conta Google **do barbeiro** (a do calendário onde as marcações devem aparecer):

1. Vai a <https://script.google.com> → **Novo projeto**. Dá-lhe o nome "Marcações Twenty Two".
2. Apaga o conteúdo de `Code.gs` e cola o conteúdo de [`apps-script/Code.gs`](apps-script/Code.gs).
3. (Recomendado) Em **Definições do projeto** ativa "Mostrar ficheiro de manifesto appsscript.json"
   e cola o conteúdo de [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. No topo de `Code.gs`, ajusta `CONFIG`: telefone, morada, horário (`HOURS`), serviços,
   durações e preços.
5. **Implementar → Nova implementação → Tipo: Aplicação Web**
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
6. Autoriza o acesso ao Calendar e ao Gmail quando pedido
   (aparece "app não verificada" → *Avançadas* → *Aceder*; é o teu próprio script).
7. Copia o **URL da aplicação Web** (termina em `/exec`) e cola-o em `booking.js`:
   ```js
   const API_URL = 'https://script.google.com/macros/s/XXXX/exec';
   ```
8. Faz commit/push. Pronto.

Sempre que alterares `Code.gs`: **Implementar → Gerir implementações → editar → Nova versão**
(assim o URL mantém-se igual).

Limites da conta Gmail gratuita: ~100 emails/dia enviados pelo script (chega para ~50 marcações/dia,
contando com o aviso ao barbeiro).
