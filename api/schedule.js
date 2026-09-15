// =============================================================================
// LinSolutions — Serverless Function: POST /api/schedule
// Recebe agendamento, gera .ics e dispara e-mails via Nodemailer
// =============================================================================

const nodemailer = require('nodemailer');
const ics = require('ics');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'contato@linsolutionsbr.com';

// Configuração do transporte SMTP (lazy init)
function getTransporter() {
  console.log('DIAGNOSTICO SMTP:', {
    SMTP_HOST: process.env.SMTP_HOST || '(vazio)',
    SMTP_PORT: process.env.SMTP_PORT || '(vazio)',
    SMTP_USER: process.env.SMTP_USER || '(vazio)',
    hasPass: !!process.env.SMTP_PASS,
    passLength: process.env.SMTP_PASS ? process.env.SMTP_PASS.length : 0
  });

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '465', 10),
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return null;
}

// Gera o conteúdo do convite .ics
function generateICS(eventDetails) {
  return new Promise((resolve) => {
    ics.createEvent(eventDetails, (error, value) => {
      if (error) {
        console.error('Erro ao gerar convite ICS:', error);
        resolve('');
      } else {
        resolve(value);
      }
    });
  });
}

module.exports = async (req, res) => {
  // Permitir apenas POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const { name, email, phone, date, time, interest, notes } = req.body;

    // Validação de campos obrigatórios
    if (!name || !email || !phone || !date || !time) {
      return res.status(400).json({
        error: 'Por favor, preencha todos os campos obrigatórios.'
      });
    }

    // Validar formato do e-mail
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }

    const appointmentId = 'LS-' + Date.now().toString(36).toUpperCase();
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);

    const appointmentInterest = interest || 'Automação Geral com IA';

    // -------------------------------------------------------------------------
    // Gerar convite de calendário (.ics) com formato RFC 5545 REQUEST nativo
    // -------------------------------------------------------------------------
    const eventDetails = {
      productId: 'LinSolutions/Calendar//PT',
      method: 'REQUEST',
      status: 'CONFIRMED',
      busyStatus: 'BUSY',
      sequence: 0,
      start: [year, month, day, hour, minute],
      duration: { hours: 0, minutes: 45 },
      title: `Consultoria Estratégica IA: LinSolutions & ${name}`,
      description: `Reunião de Diagnóstico de Automação & Inteligência Artificial.\nCliente: ${name}\nE-mail: ${email}\nTelefone/WhatsApp: ${phone}\nInteresse: ${appointmentInterest}\n\nLink da Reunião (Google Meet): meet.google.com/lin-solu-ia`,
      location: 'Google Meet (meet.google.com/lin-solu-ia)',
      url: 'https://meet.google.com/lin-solu-ia',
      organizer: { name: 'LinSolutions IA', email: ADMIN_EMAIL },
      attendees: [
        { name, email, rsvp: true, role: 'REQ-PARTICIPANT' },
        { name: 'LinSolutions Equipe Técnica', email: ADMIN_EMAIL, rsvp: true, role: 'CHAIR' }
      ]
    };

    const icsContent = await generateICS(eventDetails);

    // Link para adicionar ao Google Calendar
    const startIso = new Date(Date.UTC(year, month - 1, day, hour + 3, minute))
      .toISOString().replace(/-|:|\.\d\d\d/g, "");
    const endIso = new Date(Date.UTC(year, month - 1, day, hour + 3, minute + 45))
      .toISOString().replace(/-|:|\.\d\d\d/g, "");
    const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Consultoria IA - LinSolutions & ' + name)}&dates=${startIso}/${endIso}&details=${encodeURIComponent('Diagnóstico com a equipe LinSolutions.\nLink: https://meet.google.com/lin-solu-ia')}&location=${encodeURIComponent('Google Meet')}`;

    // -------------------------------------------------------------------------
    // E-mails
    // -------------------------------------------------------------------------
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
          <tr><td style="padding: 6px 0; color: #FF8F8D;"><strong>Área de Interesse:</strong></td><td>${appointmentInterest}</td></tr>
        </table>
        <hr style="border: 0; border-top: 1px solid rgba(255,245,245,0.15); margin: 20px 0;">
        <p style="font-size: 0.85rem; color: rgba(255,245,245,0.7);">
          O e-mail de confirmação com anexo .ics já foi encaminhado para o cliente.
        </p>
      </div>
    `;

    const clientEmailHtml = `
      <div style="font-family: Arial, sans-serif; background-color: #0C0101; color: #FFF5F5; padding: 30px; border-radius: 12px; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 25px;">
          <h1 style="color: #FFF5F5; font-size: 24px; margin: 0;">Lin<span style="color: #B01412;">Solutions</span></h1>
          <p style="color: #FF8F8D; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Engenharia de Software & IA</p>
        </div>
        
        <div style="background: #1A0707; border: 1px solid rgba(176,20,18,0.4); border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <h2 style="color: #FFF5F5; font-size: 18px; margin-top: 0;">Olá, ${name}!</h2>
          <p style="color: rgba(255,245,245,0.85); line-height: 1.6;">
            Sua <strong>Consultoria Estratégica Gratuita</strong> com nossos especialistas em Inteligência Artificial está confirmada.
          </p>
          
          <div style="background: rgba(176,20,18,0.15); border-left: 4px solid #B01412; padding: 12px 16px; margin: 15px 0;">
            <p style="margin: 0; font-size: 15px; color: #FFF5F5;">
              📅 <strong>Data:</strong> ${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}<br>
              ⏰ <strong>Horário:</strong> ${time} (Horário de Brasília)<br>
              📍 <strong>Local:</strong> Google Meet (Online)
            </p>
          </div>
          
          <p style="color: rgba(255,245,245,0.85); font-size: 14px;">
            Nesta sessão de 30 a 45 minutos, faremos um diagnóstico objetivo dos processos da sua empresa para mapear oportunidades reais de automação, redução de custos e escala com IA sob medida.
          </p>
        </div>

        <div style="text-align: center; margin: 25px 0;">
          <a href="${googleCalendarUrl}" target="_blank" style="background-color: #B01412; color: #FFF5F5; padding: 12px 24px; border-radius: 30px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
            Adicionar ao Google Agenda
          </a>
        </div>

        <p style="font-size: 12px; color: rgba(255,245,245,0.5); text-align: center; margin-top: 20px;">
          Também anexamos o arquivo de convite (.ics) para que você possa sincronizar automaticamente com o Outlook ou Apple Calendar.<br><br>
          Dúvidas? Responda este e-mail ou contate: ${ADMIN_EMAIL}
        </p>
      </div>
    `;

    // Disparo de e-mails
    const transporter = getTransporter();

    // Configurar .ics como convite de calendário nativo (method=REQUEST)
    // Isso faz com que Outlook, GoDaddy Workspace e outros clientes
    // tratem o e-mail como um convite de reunião que aparece no calendário
    const calendarAttachments = icsContent ? [{
      filename: 'reuniao-linsolutions.ics',
      content: icsContent,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    }] : [];

    // Alternativa inline: envia o .ics como parte do corpo do e-mail
    // para máxima compatibilidade com Outlook/GoDaddy Workspace
    const calendarAlternative = icsContent ? {
      contentType: 'text/calendar; charset=utf-8; method=REQUEST',
      content: icsContent
    } : null;

    if (transporter) {
      // Envia para admin (contato@linsolutionsbr.com)
      // Inclui .ics como convite nativo → aparece direto no calendário
      const adminMailOptions = {
        from: process.env.EMAIL_FROM || `LinSolutions <${ADMIN_EMAIL}>`,
        to: ADMIN_EMAIL,
        subject: `[Novo Agendamento] ${name} - ${date} às ${time}`,
        html: adminEmailHtml,
        attachments: calendarAttachments
      };

      // Adicionar alternativa de calendário inline (melhor compatibilidade)
      if (calendarAlternative) {
        adminMailOptions.alternatives = [calendarAlternative];
      }

      await transporter.sendMail(adminMailOptions);

      // Envia para cliente
      const clientMailOptions = {
        from: process.env.EMAIL_FROM || `LinSolutions <${ADMIN_EMAIL}>`,
        to: email,
        subject: `Confirmação de Reunião: LinSolutions & ${name}`,
        html: clientEmailHtml,
        attachments: calendarAttachments
      };

      if (calendarAlternative) {
        clientMailOptions.alternatives = [calendarAlternative];
      }

      await transporter.sendMail(clientMailOptions);

      console.log(`✓ E-mails enviados para ${ADMIN_EMAIL} e ${email}`);
    } else {
      console.log(`[SIMULAÇÃO] Agendamento ${appointmentId}: ${name} em ${date} às ${time}`);
      console.log(`[SIMULAÇÃO] E-mails para ${ADMIN_EMAIL} e ${email} (SMTP não configurado)`);
    }

    return res.status(201).json({
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
    return res.status(500).json({
      error: 'Falha interna ao processar agendamento. Tente novamente mais tarde.'
    });
  }
};
