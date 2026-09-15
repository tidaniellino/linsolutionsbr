// =============================================================================
// LinSolutions — Calendar Integration Module
// Sincronização em tempo real com Calendário GoDaddy (iCal / CalDAV / Appointments)
// =============================================================================

const ical = require('node-ical');
const fs = require('fs');
const path = require('path');

const STANDARD_SLOTS = [
  '09:00', '10:00', '11:00',
  '14:00', '15:00', '16:00', '17:00'
];

// Cache em memória do feed ICS para otimizar tempo de resposta (TTL: 60s)
let icsCache = {
  data: null,
  timestamp: 0
};
const CACHE_TTL_MS = 60 * 1000;

/**
 * Lê o arquivo appointments.json local (se existir)
 */
function getLocalAppointments() {
  try {
    const dbPath = path.join(process.cwd(), 'appointments.json');
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[Calendar] Erro ao ler appointments.json local:', err.message);
  }
  return [];
}

/**
 * Salva um novo agendamento no appointments.json local (se em ambiente com escrita)
 */
function saveLocalAppointment(appointment) {
  try {
    const dbPath = path.join(process.cwd(), 'appointments.json');
    let list = [];
    if (fs.existsSync(dbPath)) {
      list = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }
    list.push(appointment);
    fs.writeFileSync(dbPath, JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn('[Calendar] Não foi possível salvar em appointments.json (ambiente somente-leitura ou Vercel):', err.message);
    return false;
  }
}

/**
 * Busca e analisa o feed iCal (.ics) do calendário GoDaddy / Titan / Webmail
 */
async function fetchGoDaddyCalendarEvents() {
  const icsUrl = process.env.GODADDY_CALENDAR_ICS_URL || process.env.CALENDAR_ICS_URL;
  if (!icsUrl) {
    return null;
  }

  const now = Date.now();
  if (icsCache.data && (now - icsCache.timestamp) < CACHE_TTL_MS) {
    return icsCache.data;
  }

  try {
    const events = await ical.async.fromURL(icsUrl);
    icsCache = {
      data: events,
      timestamp: now
    };
    return events;
  } catch (err) {
    console.error('[Calendar] Erro ao buscar feed ICS da GoDaddy:', err.message);
    // Se o cache anterior existir, usa-o como fallback
    if (icsCache.data) return icsCache.data;
    return null;
  }
}

/**
 * Retorna todos os períodos ocupados (busy periods) para uma data YYYY-MM-DD
 * no fuso horário de Brasília (UTC-3)
 */
async function getBusyPeriodsForDate(dateString) {
  const busy = [];

  // Início e fim do dia em Brasília (UTC-3)
  const dayStart = new Date(`${dateString}T00:00:00-03:00`);
  const dayEnd = new Date(`${dateString}T23:59:59-03:00`);

  // 1. Verificar eventos do calendário GoDaddy
  const calendarEvents = await fetchGoDaddyCalendarEvents();
  if (calendarEvents) {
    for (const key in calendarEvents) {
      const ev = calendarEvents[key];
      if (!ev || ev.type !== 'VEVENT' || ev.status === 'CANCELLED') continue;

      const evStart = new Date(ev.start);
      const evEnd = new Date(ev.end || ev.start);

      // Eventos recorrentes (RRULE)
      if (ev.rrule) {
        try {
          const recurrences = ev.rrule.between(dayStart, dayEnd, true);
          const duration = evEnd.getTime() - evStart.getTime();

          for (const recDate of recurrences) {
            const recStart = new Date(recDate);
            const recEnd = new Date(recStart.getTime() + (duration > 0 ? duration : 45 * 60 * 1000));
            busy.push({
              start: recStart,
              end: recEnd,
              summary: ev.summary || 'Compromisso GoDaddy'
            });
          }
        } catch (rErr) {
          console.warn('[Calendar] Erro ao processar rrule:', rErr.message);
        }
      } else {
        // Evento único
        if (evEnd > dayStart && evStart < dayEnd) {
          busy.push({
            start: evStart,
            end: evEnd,
            summary: ev.summary || 'Compromisso GoDaddy'
          });
        }
      }
    }
  }

  // 2. Verificar agendamentos registrados no sistema local (appointments.json)
  const localAppointments = getLocalAppointments();
  const dayAppointments = localAppointments.filter(a => a.date === dateString);

  for (const appt of dayAppointments) {
    if (appt.time) {
      const apptStart = new Date(`${dateString}T${appt.time}:00-03:00`);
      const apptEnd = new Date(apptStart.getTime() + 45 * 60 * 1000);
      busy.push({
        start: apptStart,
        end: apptEnd,
        summary: `Reunião LinSolutions: ${appt.name || 'Cliente'}`
      });
    }
  }

  return busy;
}

/**
 * Verifica se um slot específico está livre
 */
function isSlotFree(dateString, slotTime, busyPeriods) {
  const slotStart = new Date(`${dateString}T${slotTime}:00-03:00`);
  const slotEnd = new Date(slotStart.getTime() + 45 * 60 * 1000);
  const now = new Date();

  // Bloquear horários passados no mesmo dia
  if (slotStart.getTime() <= now.getTime()) {
    return { available: false, reason: 'Horário já decorrido' };
  }

  // Verificar se colide com algum período ocupado
  for (const period of busyPeriods) {
    const pStart = period.start.getTime();
    const pEnd = period.end.getTime();
    const sStart = slotStart.getTime();
    const sEnd = slotEnd.getTime();

    // Condição de sobreposição
    if (pStart < sEnd && pEnd > sStart) {
      return { available: false, reason: 'Horário ocupado na agenda' };
    }
  }

  return { available: true };
}

/**
 * Retorna os slots disponíveis para uma data YYYY-MM-DD
 */
async function getAvailability(dateString) {
  // Validar formato YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    throw new Error('Formato de data inválido. Use YYYY-MM-DD.');
  }

  const [year, month, day] = dateString.split('-').map(Number);
  const targetDate = new Date(year, month - 1, day);
  const dayOfWeek = targetDate.getDay();

  // Fim de semana (0 = Domingo, 6 = Sábado)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return {
      date: dateString,
      isBusinessDay: false,
      message: 'Atendimento de consultoria disponível apenas de Segunda a Sexta-feira.',
      slots: []
    };
  }

  const busyPeriods = await getBusyPeriodsForDate(dateString);
  const hasGoDaddySync = Boolean(process.env.GODADDY_CALENDAR_ICS_URL || process.env.CALENDAR_ICS_URL);

  const slots = STANDARD_SLOTS.map(time => {
    const check = isSlotFree(dateString, time, busyPeriods);
    return {
      time,
      available: check.available,
      ...(check.reason ? { reason: check.reason } : {})
    };
  });

  return {
    date: dateString,
    isBusinessDay: true,
    timezone: 'America/Sao_Paulo (BRT)',
    godaddySync: hasGoDaddySync,
    slots
  };
}

module.exports = {
  STANDARD_SLOTS,
  getAvailability,
  getBusyPeriodsForDate,
  isSlotFree,
  saveLocalAppointment,
  getLocalAppointments
};
