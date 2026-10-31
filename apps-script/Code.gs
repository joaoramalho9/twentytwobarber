/**
 * Twenty Two Barbershop — backend de marcações (Google Apps Script).
 *
 * Lê a disponibilidade do Google Calendar do barbeiro, cria a marcação como
 * evento no calendário, envia email de confirmação ao cliente (com botões
 * "Google Calendar" / "Outlook, iCal, outros", ficheiro .ics e link para
 * cancelar) e avisa o barbeiro.
 *
 * Instalação: ver README.md (secção "Marcações online").
 */

const CONFIG = {
  SHOP_NAME: 'Twenty Two Barbershop',
  CALENDAR_ID: 'primary',          // ou o ID de um calendário só para marcações
  TIME_ZONE: 'Europe/Lisbon',
  PHONE: '',                       // ex: '+351 912 345 678' (aparece no email)
  ADDRESS: '',                     // morada (aparece no evento e no email)
  NOTIFY_EMAIL: '',                // email que recebe aviso de cada marcação (vazio = dono do script)
  WEB_APP_URL: '',                 // opcional: URL /exec da Web App (se vazio é detetado)

  DAYS_AHEAD: 21,                  // até quantos dias à frente se pode marcar
  MIN_NOTICE_MINUTES: 60,          // antecedência mínima
  SLOT_STEP_MINUTES: 30,           // intervalo entre horários sugeridos
  CANCEL_MIN_HOURS: 2,             // até quantas horas antes se pode cancelar

  // Horário por dia da semana (0 = domingo ... 6 = sábado). null = fechado.
  // Vários intervalos permitem pausa de almoço: [['10:00','13:00'],['14:00','20:00']]
  HOURS: {
    0: null,
    1: [['10:00', '20:00']],
    2: [['10:00', '20:00']],
    3: [['10:00', '20:00']],
    4: [['10:00', '20:00']],
    5: [['10:00', '20:00']],
    6: [['09:00', '19:00']],
  },

  // id: usado pelo site; minutes: duração; price: texto opcional (ex: '12€')
  SERVICES: [
    { id: 'corte',       name: 'Corte',         minutes: 30, price: '' },
    { id: 'fade',        name: 'Fade',          minutes: 30, price: '' },
    { id: 'barba',       name: 'Barba',         minutes: 30, price: '' },
    { id: 'corte-barba', name: 'Corte + Barba', minutes: 60, price: '' },
  ],
};

/* ------------------------------------------------------------------ HTTP */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    switch (p.action) {
      case 'config':
        return json_(publicConfig_());
      case 'slots':
        return json_({ slots: getSlots_(p.date, findService_(p.service)) });
      case 'ics':
        return icsDownload_(p.id, p.token);
      case 'cancel':
        return cancelPage_(p.id, p.token);
      default:
        return json_({ ok: true, shop: CONFIG.SHOP_NAME });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_({ ok: true, booking: createBooking_(data) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/* ------------------------------------------------------------- Booking */

function publicConfig_() {
  const closed = [];
  for (let d = 0; d < 7; d++) if (!CONFIG.HOURS[d]) closed.push(d);
  return {
    shopName: CONFIG.SHOP_NAME,
    phone: CONFIG.PHONE,
    address: CONFIG.ADDRESS,
    daysAhead: CONFIG.DAYS_AHEAD,
    closedWeekdays: closed,
    services: CONFIG.SERVICES,
  };
}

function findService_(id) {
  const s = CONFIG.SERVICES.filter(function (x) { return x.id === id; })[0];
  if (!s) throw new Error('Serviço inválido.');
  return s;
}

function getSlots_(dateStr, svc) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) throw new Error('Data inválida.');
  const today = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  if (dateStr < today || dateStr > addDays_(today, CONFIG.DAYS_AHEAD)) return [];

  const ranges = CONFIG.HOURS[new Date(dateStr + 'T12:00:00Z').getUTCDay()];
  if (!ranges) return [];

  const events = calendar_().getEvents(at_(dateStr, '00:00'), at_(addDays_(dateStr, 1), '00:00'));
  const busy = events.map(function (ev) {
    return [ev.getStartTime().getTime(), ev.getEndTime().getTime()];
  });
  const earliest = Date.now() + CONFIG.MIN_NOTICE_MINUTES * 60000;
  const slots = [];

  ranges.forEach(function (r) {
    const open = toMin_(r[0]), close = toMin_(r[1]);
    for (let m = open; m + svc.minutes <= close; m += CONFIG.SLOT_STEP_MINUTES) {
      const label = fromMin_(m);
      const start = at_(dateStr, label).getTime();
      const end = start + svc.minutes * 60000;
      if (start < earliest) continue;
      const clash = busy.some(function (b) { return start < b[1] && end > b[0]; });
      if (!clash) slots.push(label);
    }
  });
  return slots;
}

function createBooking_(d) {
  if (d.website) throw new Error('Pedido inválido.'); // honeypot anti-spam
  const svc = findService_(d.service);
  const name = clean_(d.name, 80);
  const email = clean_(d.email, 120).toLowerCase();
  const phone = clean_(d.phone, 30);
  if (name.length < 2) throw new Error('Indica o teu nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email inválido.');
  if (!/^[+\d][\d\s-]{6,}$/.test(phone)) throw new Error('Telemóvel inválido.');
  if (!/^\d{2}:\d{2}$/.test(d.time || '')) throw new Error('Hora inválida.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (getSlots_(d.date, svc).indexOf(d.time) === -1) {
      throw new Error('Esse horário já não está disponível. Escolhe outro.');
    }
    const start = at_(d.date, d.time);
    const end = new Date(start.getTime() + svc.minutes * 60000);
    const token = Utilities.getUuid();

    const event = calendar_().createEvent(svc.name + ' — ' + name, start, end, {
      description: 'Cliente: ' + name + '\nTelemóvel: ' + phone + '\nEmail: ' + email +
                   '\n\nMarcado online.',
      location: CONFIG.ADDRESS,
    });
    event.setTag('token', token);
    event.setTag('email', email);
    event.setTag('name', name);
    event.setTag('service', svc.name);

    const booking = bookingInfo_(event, token);
    sendConfirmation_(booking, email);
    notifyShop_('Nova marcação: ' + svc.name + ' — ' + name,
      name + ' (' + phone + ', ' + email + ')\n' + svc.name + '\n' + booking.when);
    return booking;
  } finally {
    lock.releaseLock();
  }
}

function bookingInfo_(event, token) {
  const id = event.getId();
  const base = webAppUrl_();
  const q = '?id=' + encodeURIComponent(id) + '&token=' + encodeURIComponent(token);
  const start = event.getStartTime(), end = event.getEndTime();
  return {
    id: id,
    name: event.getTag('name'),
    service: event.getTag('service'),
    start: start.toISOString(),
    end: end.toISOString(),
    when: formatWhen_(start),
    cancelUrl: base + q + '&action=cancel',
    icsUrl: base + q + '&action=ics',
    googleUrl: googleCalUrl_(event.getTag('service'), start, end),
  };
}

function findBooking_(id, token) {
  const event = id ? calendar_().getEventById(id) : null;
  if (!event || !token || event.getTag('token') !== token) return null;
  return event;
}

/* --------------------------------------------------------------- Cancel */

function cancelPage_(id, token) {
  const event = findBooking_(id, token);
  let body;
  if (!event) {
    body = '<h1>Marcação não encontrada</h1><p>Pode já ter sido cancelada.</p>';
  } else {
    const b = bookingInfo_(event, token);
    body =
      '<h1>Cancelar marcação?</h1>' +
      '<p><b>' + esc_(b.service) + '</b><br>' + esc_(b.when) + '</p>' +
      '<button id="go">Sim, cancelar</button><p id="msg"></p>' +
      '<script>document.getElementById("go").onclick=function(){var b=this;b.disabled=true;' +
      'google.script.run.withSuccessHandler(function(m){document.getElementById("msg").textContent=m;b.remove();})' +
      '.withFailureHandler(function(e){document.getElementById("msg").textContent=e.message;b.disabled=false;})' +
      '.cancelBooking(' + JSON.stringify(id) + ',' + JSON.stringify(token) + ');};</script>';
  }
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;max-width:420px;margin:40px auto;text-align:center">' +
    '<p style="font-weight:bold">' + esc_(CONFIG.SHOP_NAME) + '</p>' + body +
    '<style>button{background:#e4ff3a;border:0;border-radius:999px;padding:12px 24px;font-weight:bold;cursor:pointer}</style></div>'
  ).setTitle('Cancelar marcação').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Chamado a partir da página de cancelamento (google.script.run). */
function cancelBooking(id, token) {
  const event = findBooking_(id, token);
  if (!event) return 'Marcação não encontrada ou já cancelada.';
  if (event.getStartTime().getTime() - Date.now() < CONFIG.CANCEL_MIN_HOURS * 3600000) {
    throw new Error('Já não é possível cancelar online. Contacta-nos' +
      (CONFIG.PHONE ? ' pelo ' + CONFIG.PHONE : '') + '.');
  }
  const info = event.getTag('service') + ' — ' + event.getTag('name') + '\n' + formatWhen_(event.getStartTime());
  event.deleteEvent();
  notifyShop_('Marcação cancelada: ' + event.getTag('name'), info);
  return 'Marcação cancelada. Até breve!';
}

/* ------------------------------------------------------------ Calendar */

function icsDownload_(id, token) {
  const event = findBooking_(id, token);
  if (!event) return json_({ ok: false, error: 'Marcação não encontrada.' });
  return ContentService.createTextOutput(buildIcs_(event))
    .setMimeType(ContentService.MimeType.ICAL)
    .downloadAsFile('marcacao.ics');
}

function buildIcs_(event) {
  const fmt = function (d) { return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); };
  const txt = function (s) { return String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); };
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Twenty Two Barbershop//Marcacoes//PT', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + event.getId(),
    'DTSTAMP:' + fmt(new Date()),
    'DTSTART:' + fmt(event.getStartTime()),
    'DTEND:' + fmt(event.getEndTime()),
    'SUMMARY:' + txt(event.getTag('service') + ' — ' + CONFIG.SHOP_NAME),
    'LOCATION:' + txt(CONFIG.ADDRESS),
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

function googleCalUrl_(service, start, end) {
  const fmt = function (d) { return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); };
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(service + ' — ' + CONFIG.SHOP_NAME) +
    '&dates=' + fmt(start) + '/' + fmt(end) +
    '&location=' + encodeURIComponent(CONFIG.ADDRESS) +
    '&ctz=' + encodeURIComponent(CONFIG.TIME_ZONE);
}

/* --------------------------------------------------------------- Email */

function sendConfirmation_(b, email) {
  const event = calendar_().getEventById(b.id);
  const row = function (label, value) {
    return '<tr><td style="padding:16px 0;border-top:1px solid #eee">' +
      '<div style="color:#888;font-size:14px">' + label + '</div>' +
      '<div style="color:#111;font-size:16px;margin-top:4px">' + value + '</div></td></tr>';
  };
  const btn = function (href, label) {
    return '<a href="' + href + '" style="display:block;background:#111;color:#e4ff3a;text-decoration:none;' +
      'font-weight:bold;text-align:center;padding:12px;border-radius:6px;margin:10px 0">' + label + '</a>';
  };
  const html =
    '<div style="background:#f2f2f2;padding:24px 12px;font-family:Arial,sans-serif">' +
    '<table role="presentation" width="100%" style="max-width:460px;margin:0 auto;background:#fff;border-radius:10px;padding:24px">' +
    '<tr><td style="text-align:center;font-weight:bold;font-size:18px;padding-bottom:16px">' + esc_(CONFIG.SHOP_NAME) + '</td></tr>' +
    '<tr><td style="text-align:center;padding:16px 0;border-top:1px solid #eee">' +
      '<div style="width:64px;height:64px;line-height:64px;border-radius:50%;background:#e4ff3a;color:#111;font-size:34px;margin:0 auto">&#10003;</div>' +
      '<div style="color:#111;font-size:20px;font-weight:bold;margin-top:12px">Marcação confirmada!</div></td></tr>' +
    row('Nome', esc_(b.name)) +
    row('Data / hora', esc_(b.when)) +
    row('Serviço', esc_(b.service)) +
    (CONFIG.ADDRESS ? row('Morada', esc_(CONFIG.ADDRESS)) : '') +
    '<tr><td style="padding:16px 0;border-top:1px solid #eee;text-align:center;color:#888">Adicione ao seu calendário:' +
      btn(b.googleUrl, 'Google Calendar') + btn(b.icsUrl, 'Outlook, iCal, outros') + '</td></tr>' +
    row('Precisa de cancelar?', '<a href="' + b.cancelUrl + '" style="color:#111;font-weight:bold">Cancelar marcação</a>') +
    (CONFIG.PHONE ? row('Precisa de ajuda?', '<a href="tel:' + CONFIG.PHONE.replace(/\s/g, '') + '" style="color:#111;font-weight:bold">' + esc_(CONFIG.PHONE) + '</a>') : '') +
    '<tr><td style="padding:16px 0;border-top:1px solid #eee;color:#888;font-size:14px">Obrigado,<br>Este email foi enviado automaticamente, por favor não responda.</td></tr>' +
    '</table></div>';

  MailApp.sendEmail({
    to: email,
    subject: 'Marcação confirmada — ' + CONFIG.SHOP_NAME,
    htmlBody: html,
    name: CONFIG.SHOP_NAME,
    attachments: [Utilities.newBlob(buildIcs_(event), 'text/calendar', 'marcacao.ics')],
  });
}

function notifyShop_(subject, body) {
  const to = CONFIG.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  if (to) MailApp.sendEmail(to, subject, body);
}

/* ------------------------------------------------------------- Helpers */

function calendar_() {
  const cal = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID) || CalendarApp.getDefaultCalendar();
  return cal;
}
function webAppUrl_() { return CONFIG.WEB_APP_URL || ScriptApp.getService().getUrl(); }
function at_(dateStr, hhmm) { return Utilities.parseDate(dateStr + ' ' + hhmm, CONFIG.TIME_ZONE, 'yyyy-MM-dd HH:mm'); }
function addDays_(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function toMin_(hhmm) { const p = hhmm.split(':'); return +p[0] * 60 + +p[1]; }
function fromMin_(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function formatWhen_(d) {
  const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const tz = CONFIG.TIME_ZONE;
  const wd = +Utilities.formatDate(d, tz, 'u') % 7; // 1=seg ... 7=dom
  return days[wd] + ', ' + Utilities.formatDate(d, tz, 'd') + ' de ' +
    months[+Utilities.formatDate(d, tz, 'M') - 1] + ' de ' + Utilities.formatDate(d, tz, 'yyyy HH:mm');
}
function clean_(s, max) { return String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max); }
function esc_(s) {
  return String(s || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
