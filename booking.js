/* Twenty Two Barbershop — marcações online.
 *
 * API_URL: URL /exec da Web App do Google Apps Script (pasta apps-script/).
 * Enquanto estiver vazio, o site funciona em MODO DEMONSTRAÇÃO
 * (mostra horários fictícios e não guarda nada).
 */
const API_URL = '';

const TZ = 'Europe/Lisbon';
const DEMO_CONFIG = {
  shopName: 'Twenty Two Barbershop',
  phone: '',
  address: '',
  daysAhead: 21,
  closedWeekdays: [0],
  services: [
    { id: 'corte', name: 'Corte', minutes: 30, price: '' },
    { id: 'fade', name: 'Fade', minutes: 30, price: '' },
    { id: 'barba', name: 'Barba', minutes: 30, price: '' },
    { id: 'corte-barba', name: 'Corte + Barba', minutes: 60, price: '' },
  ],
};

(function () {
  const root = document.getElementById('booking');
  if (!root) return;
  const demo = !API_URL;
  const state = { config: null, service: null, date: null, time: null };
  const $ = (sel) => root.querySelector(sel);

  /* ---------- API ---------- */
  async function api(params, body) {
    const url = API_URL + '?' + new URLSearchParams(params);
    const res = body
      ? await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      : await fetch(url);
    const data = await res.json();
    if (data.ok === false) throw new Error(data.error || 'Erro inesperado.');
    return data;
  }

  async function loadConfig() {
    return demo ? DEMO_CONFIG : api({ action: 'config' });
  }

  async function loadSlots(date, service) {
    if (!demo) return (await api({ action: 'slots', date, service: service.id })).slots;
    // Demo: 10:00–20:00, alguns horários "ocupados" aleatoriamente
    const out = [];
    const now = Date.now() + 3600e3;
    for (let m = 600; m + service.minutes <= 1200; m += 30) {
      const t = hhmm(m);
      if (zonedDate(date, t).getTime() < now) continue;
      if ((hash(date + t) % 10) < 3) continue;
      out.push(t);
    }
    return out;
  }

  async function book(data) {
    if (!demo) return (await api({}, data)).booking;
    const start = zonedDate(data.date, data.time);
    const end = new Date(start.getTime() + state.service.minutes * 60e3);
    return { name: data.name, service: state.service.name, start: start.toISOString(), end: end.toISOString(), when: formatWhen(start), demo: true };
  }

  /* ---------- Render ---------- */
  function step(n) {
    root.querySelectorAll('.bk__step').forEach((el) => (el.hidden = +el.dataset.step !== n));
    root.querySelectorAll('.bk__progress li').forEach((li, i) => li.classList.toggle('is-on', i < n));
  }

  function renderServices() {
    const list = $('#bk-services');
    list.innerHTML = '';
    state.config.services.forEach((s) => {
      const b = el('button', 'bk__service');
      b.type = 'button';
      b.append(el('strong', '', s.name), el('span', '', s.minutes + ' min' + (s.price ? ' · ' + s.price : '')));
      b.onclick = () => { state.service = s; state.date = null; renderDates(); step(2); };
      list.append(b);
    });
  }

  function renderDates() {
    $('#bk-chosen-service').textContent = state.service.name;
    const row = $('#bk-dates');
    row.innerHTML = '';
    $('#bk-slots').innerHTML = '';
    $('#bk-slots-msg').textContent = 'Escolhe um dia.';
    const today = todayStr();
    let first = null;
    for (let i = 0; i <= state.config.daysAhead; i++) {
      const d = addDays(today, i);
      const wd = new Date(d + 'T12:00:00Z').getUTCDay();
      if (state.config.closedWeekdays.includes(wd)) continue;
      const dt = new Date(d + 'T12:00:00Z');
      const b = el('button', 'bk__date');
      b.type = 'button';
      b.append(
        el('small', '', dt.toLocaleDateString('pt-PT', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')),
        el('strong', '', String(dt.getUTCDate())),
        el('small', '', dt.toLocaleDateString('pt-PT', { month: 'short', timeZone: 'UTC' }).replace('.', ''))
      );
      b.onclick = () => selectDate(d, b);
      row.append(b);
      if (!first) first = [d, b];
    }
    if (first) selectDate(first[0], first[1]);
  }

  async function selectDate(d, btn) {
    state.date = d;
    root.querySelectorAll('.bk__date').forEach((b) => b.classList.toggle('is-active', b === btn));
    const grid = $('#bk-slots');
    const msg = $('#bk-slots-msg');
    grid.innerHTML = '';
    msg.textContent = 'A carregar horários…';
    try {
      const slots = await loadSlots(d, state.service);
      if (state.date !== d) return;
      msg.textContent = slots.length ? '' : 'Sem horários livres neste dia. Experimenta outro.';
      slots.forEach((t) => {
        const b = el('button', 'bk__slot', t);
        b.type = 'button';
        b.onclick = () => { state.time = t; renderSummary(); step(3); };
        grid.append(b);
      });
    } catch (e) {
      msg.textContent = e.message;
    }
  }

  function renderSummary() {
    const start = zonedDate(state.date, state.time);
    $('#bk-summary').textContent = state.service.name + ' · ' + formatWhen(start);
    $('#bk-error').textContent = '';
  }

  async function submit(ev) {
    ev.preventDefault();
    const form = ev.target;
    const btn = form.querySelector('button[type=submit]');
    const err = $('#bk-error');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'A confirmar…';
    try {
      const fd = new FormData(form);
      const b = await book({
        service: state.service.id, date: state.date, time: state.time,
        name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), website: fd.get('website'),
      });
      renderConfirmation(b);
      form.reset();
      step(4);
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      err.textContent = e.message;
      if (/disponível/.test(e.message)) { selectDate(state.date, root.querySelector('.bk__date.is-active')); }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirmar marcação';
    }
  }

  function renderConfirmation(b) {
    const start = new Date(b.start), end = new Date(b.end);
    const cfg = state.config;
    $('#bk-c-name').textContent = b.name;
    $('#bk-c-when').textContent = b.when || formatWhen(start);
    $('#bk-c-service').textContent = b.service;
    $('#bk-c-demo').hidden = !b.demo;
    $('#bk-c-email').hidden = !!b.demo;

    const title = b.service + ' — ' + cfg.shopName;
    $('#bk-c-google').href = b.googleUrl ||
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) +
      '&dates=' + icsDate(start) + '/' + icsDate(end) + '&location=' + encodeURIComponent(cfg.address || '') + '&ctz=' + TZ;

    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Twenty Two Barbershop//Marcacoes//PT', 'BEGIN:VEVENT',
      'UID:' + (b.id || Date.now() + '@twentytwo'), 'DTSTAMP:' + icsDate(new Date()),
      'DTSTART:' + icsDate(start), 'DTEND:' + icsDate(end),
      'SUMMARY:' + title.replace(/([,;\\])/g, '\\$1'), 'LOCATION:' + (cfg.address || '').replace(/([,;\\])/g, '\\$1'),
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const ical = $('#bk-c-ics');
    if (ical.dataset.url) URL.revokeObjectURL(ical.dataset.url);
    ical.dataset.url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    ical.href = ical.dataset.url;

    const cancel = $('#bk-c-cancel');
    cancel.hidden = !b.cancelUrl;
    if (b.cancelUrl) cancel.querySelector('a').href = b.cancelUrl;

    const help = $('#bk-c-help');
    help.hidden = !cfg.phone;
    if (cfg.phone) { const a = help.querySelector('a'); a.href = 'tel:' + cfg.phone.replace(/\s/g, ''); a.textContent = cfg.phone; }
  }

  /* ---------- Helpers ---------- */
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
  function todayStr() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
  function addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function icsDate(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  // Converte data/hora "de Lisboa" para um Date (UTC) correto.
  function zonedDate(dateStr, time) {
    const guess = new Date(dateStr + 'T' + time + ':00Z');
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(guess).reduce((o, p) => (o[p.type] = p.value, o), {});
    const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return new Date(guess.getTime() - (asLocal - guess.getTime()));
  }
  function formatWhen(d) {
    const s = d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
    const t = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
    return s.charAt(0).toUpperCase() + s.slice(1) + ' ' + t;
  }

  /* ---------- Init ---------- */
  root.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => step(+b.dataset.back)));
  $('#bk-form').addEventListener('submit', submit);
  $('#bk-again').onclick = () => { state.service = state.date = state.time = null; step(1); };
  $('#bk-demo-banner').hidden = !demo;

  loadConfig()
    .then((cfg) => { state.config = cfg; renderServices(); step(1); })
    .catch(() => { $('#bk-services').textContent = 'Não foi possível carregar as marcações. Tenta mais tarde.'; step(1); });
})();
