const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const ics = require('ics');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'contato@linsolutionsbr.com';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ------------------------------------------------------------------------------
// BANCO DE DADOS EM MEMÓRIA / ARQUIVO LOCAL (Para controle de concorrência)
// ------------------------------------------------------------------------------
const DB_FILE = path.join(__dirname, 'appointments.json');

function loadAppointments() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Erro ao ler appointments.json:', err.message);
  }
  return [];
}

function saveAppointments(appointments) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(appointments, null, 2), 'utf8');
  } catch (err) {
    console.error('Erro ao salvar appointments.json:', err.message);
  }
}

let appointments = loadAppointments();

// Horários padrão de atendimento da LinSolutions (Segunda a Sexta, 09h às 18h)
const STANDARD_SLOTS = [
  '09:00', '10:00', '11:00',
  '14:00', '15:00', '16:00', '17:00'
];

// ------------------------------------------------------------------------------
// CONFIGURAÇÃO DO TRANSPORTE DE E-MAIL (SMTP)
// ------------------------------------------------------------------------------
let transporter = null;

if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  console.log('✓ Serviço SMTP configurado para:', process.env.SMTP_USER);
} else {
  console.log('ℹ Variáveis SMTP não preenchidas. Operando em modo de simulação com logs em tempo real.');
}

// ------------------------------------------------------------------------------
// ------------------------------------------------------------------------------
// ROTAS DA API
// ------------------------------------------------------------------------------
const { getAvailability, getBusyPeriodsForDate, isSlotFree } = require('./api/_calendar');

/**
 * GET /api/availability
 * Retorna a disponibilidade de horários para a data especificada (YYYY-MM-DD)
 * integrando com o calendário da GoDaddy e agendamentos locais
 */
app.get('/api/availability', async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'O parâmetro date é obrigatório (formato YYYY-MM-DD).' });
  }

  try {
    const result = await getAvailability(date);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Erro ao processar disponibilidade.' });
  }
});

/**
 * POST /api/schedule
 * Agenda uma nova reunião, verifica agenda, bloqueia horário e dispara os e-mails
 */
app.post('/api/schedule', async (req, res) => {
  try {
    const { name, email, phone, date, time, interest, notes } = req.body;

    if (!name || !email || !phone || !date || !time) {
      return res.status(400).json({ error: 'Por favor, preencha todos os campos obrigatórios.' });
    }

    // 1. Verificar se o horário na agenda GoDaddy ou local já está ocupado
    const busyPeriods = await getBusyPeriodsForDate(date);
    const slotCheck = isSlotFree(date, time, busyPeriods);
    if (!slotCheck.available) {
      return res.status(409).json({
        error: slotCheck.reason ? `Não foi possível agendar: ${slotCheck.reason}.` : `O horário das ${time} no dia ${date} já está ocupado na agenda.`
      });
    }


    const appointmentId = 'LS-' + Date.now().toString(36).toUpperCase();
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);

    const newAppointment = {
      id: appointmentId,
      name,
      email,
      phone,
      date,
      time,
      interest: interest || 'Automação Geral com IA',
      notes: notes || '',
      createdAt: new Date().toISOString(),
      status: 'CONFIRMED'
    };

    // 2. Inserir na agenda / base
    appointments.push(newAppointment);
    saveAppointments(appointments);

    // 3. Gerar convite de calendário (.ics) com formato RFC 5545 REQUEST nativo
    const eventDetails = {
      productId: 'LinSolutions/Calendar//PT',
      method: 'REQUEST',
      status: 'CONFIRMED',
      busyStatus: 'BUSY',
      sequence: 0,
      start: [year, month, day, hour, minute],
      duration: { hours: 0, minutes: 45 },
      title: `Consultoria Estratégica IA: LinSolutions & ${name}`,
      description: `Reunião de Diagnóstico de Automação & Inteligência Artificial.\nCliente: ${name}\nE-mail: ${email}\nTelefone/WhatsApp: ${phone}\nInteresse: ${newAppointment.interest}\n\nLink da Reunião (Google Meet): meet.google.com/lin-solu-ia`,
      location: 'Google Meet (meet.google.com/lin-solu-ia)',
      url: 'https://meet.google.com/lin-solu-ia',
      organizer: { name: 'LinSolutions IA', email: ADMIN_EMAIL },
      attendees: [
        { name, email, rsvp: true, role: 'REQ-PARTICIPANT' },
        { name: 'LinSolutions Equipe Técnica', email: ADMIN_EMAIL, rsvp: true, role: 'CHAIR' }
      ]
    };

    let icsContent = '';
    ics.createEvent(eventDetails, (error, value) => {
      if (!error) {
        icsContent = value;
      } else {
        console.error('Erro ao gerar convite ICS:', error);
      }
    });

    // Link para Adicionar Diretamente ao Google Calendar no navegador
    const startIso = new Date(Date.UTC(year, month - 1, day, hour + 3, minute)).toISOString().replace(/-|:|\.\d\d\d/g, "");
    const endIso = new Date(Date.UTC(year, month - 1, day, hour + 3, minute + 45)).toISOString().replace(/-|:|\.\d\d\d/g, "");
    const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Consultoria IA - LinSolutions & ' + name)}&dates=${startIso}/${endIso}&details=${encodeURIComponent('Diagnóstico com a equipe LinSolutions.\nLink: https://meet.google.com/lin-solu-ia')}&location=${encodeURIComponent('Google Meet')}`;

    // --------------------------------------------------------------------------
    // 4. DISPARO DE E-MAIL 1: Para a LinSolutions (contato@linsolutionsbr.com)
    // --------------------------------------------------------------------------
    const adminEmailHtml = `
      <div style="font-family: Arial, sans-serif; background-color: #0C0101; color: #FFF5F5; padding: 25px; border-radius: 8px;">
        <h2 style="color: #B01412; margin-top: 0;">🚀 Novo Agendamento de Reunião Confirmado!</h2>
        <p>Um lead corporativo acabou de reservar um horário na agenda para diagnóstico de IA.</p>
        <hr style="border: 0; border-top: 1px solid rgba(255,245,245,0.15); margin: 20px 0;">
        <table style="width: 100%; color: #FFF5F5; border-collapse: collapse;">
          <tr><td style="padding: 6px 0; color: #FF8F8D;"><strong>ID da Reunião:</strong></td><td>${appointmentId}</td></tr>
          <tr><td style="padding: 6px 0; color: #FF8F8D;"><strong>Nome do Cliente:</strong></td><td>${name}</td></tr>
          <tr><td style="padding: 6px 0; color: #FF8F8D;"><strong>E-mail Corporativo:</strong></td><td><a href="mailto:${email}" style="color: #FFF5F5;">${email}</a></td></tr>
          <tr><td style="padding: 6px 0; color: #FF8F8D;"><strong>WhatsApp / Telefone:</strong></td><td><a href="https://wa.me/${phone.replace(/\D/g, '')}" style="color: #FFF5F5;">${phone}</a></td></tr>
          <tr><td style="padding: 6px 0; color: #FF8F8D;"><strong>Data Marcada:</strong></td><td>${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}</td></tr>
          <tr><td style="padding: 6px 0; color: #FF8F8D;"><strong>Horário:</strong></td><td>${time} (Horário de Brasília)</td></tr>
          <tr><td style="padding: 6px 0; color: #FF8F8D;"><strong>Área de Interesse:</strong></td><td>${newAppointment.interest}</td></tr>
        </table>
        <hr style="border: 0; border-top: 1px solid rgba(255,245,245,0.15); margin: 20px 0;">
        <p style="font-size: 0.85rem; color: rgba(255,245,245,0.7);">
          O convite de reunião nativo (.ics) foi anexado e será sincronizado com o calendário de <strong>${ADMIN_EMAIL}</strong>.
        </p>
      </div>
    `;

    // Configurar .ics como convite de calendário nativo (method=REQUEST)
    const calendarAttachments = icsContent ? [{
      filename: 'reuniao-linsolutions.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    }] : [];

    const calendarAlternative = icsContent ? {
      contentType: 'text/calendar; charset=utf-8; method=REQUEST',
      content: icsContent
    } : null;

    // Envio real ou log estruturado
    if (transporter) {
      // Envia para admin
      const adminMailOptions = {
        from: process.env.EMAIL_FROM || `LinSolutions <${ADMIN_EMAIL}>`,
        to: ADMIN_EMAIL,
        subject: `[Novo Agendamento] ${name} - ${date} às ${time}`,
        html: adminEmailHtml,
        attachments: calendarAttachments
      };
      if (calendarAlternative) adminMailOptions.alternatives = [calendarAlternative];
      await transporter.sendMail(adminMailOptions);

      // Envia para cliente
      const clientMailOptions = {
        from: process.env.EMAIL_FROM || `LinSolutions <${ADMIN_EMAIL}>`,
        to: email,
        subject: `Confirmação de Reunião: LinSolutions & ${name}`,
        html: clientEmailHtml,
        attachments: calendarAttachments
      };
      if (calendarAlternative) clientMailOptions.alternatives = [calendarAlternative];
      await transporter.sendMail(clientMailOptions);
      console.log(`✓ E-mails enviados com sucesso para ${ADMIN_EMAIL} e ${email}`);
    } else {
      console.log('\n------------------- [SIMULAÇÃO DE DISPARO DE E-MAIL] -------------------');
      console.log(`[E-mail 1 para ${ADMIN_EMAIL}]: Novo agendamento para ${name} em ${date} às ${time}.`);
      console.log(`[E-mail 2 para ${email}]: Confirmação de consultoria com convite .ics.`);
      console.log('------------------------------------------------------------------------\n');
    }

    res.status(201).json({
      success: true,
      message: 'Reunião agendada e confirmada com sucesso!',
      appointment: {
        id: appointmentId,
        name,
        email,
        date: `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`,
        time,
        googleCalendarUrl,
        icsData: icsContent
      }
    });

  } catch (err) {
    console.error('Erro ao agendar reunião:', err);
    res.status(500).json({ error: 'Falha interna ao processar agendamento. Tente novamente mais tarde.' });
  }
});

// Iniciar Servidor
app.listen(PORT, () => {
  console.log(`\n========================================================`);
  console.log(`🚀 LinSolutions Server rodando em http://localhost:${PORT}`);
  console.log(`📅 Agenda: ${ADMIN_EMAIL}`);
  console.log(`========================================================\n`);
});
