// =============================================================================
// LinSolutions — Serverless Function: GET /api/availability
// Retorna horários disponíveis para uma data (sem persistência server-side)
// =============================================================================

const STANDARD_SLOTS = [
  '09:00', '10:00', '11:00',
  '14:00', '15:00', '16:00', '17:00'
];

module.exports = (req, res) => {
  // Permitir apenas GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const { date } = req.query;

  if (!date) {
    return res.status(400).json({
      error: 'O parâmetro date é obrigatório (formato YYYY-MM-DD).'
    });
  }

  // Validar formato da data
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({
      error: 'Formato de data inválido. Use YYYY-MM-DD.'
    });
  }

  // Verificar se é fim de semana
  const [year, month, day] = date.split('-').map(Number);
  const targetDate = new Date(year, month - 1, day);
  const dayOfWeek = targetDate.getDay();

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return res.json({
      date,
      isBusinessDay: false,
      message: 'Atendimento de consultoria disponível apenas de Segunda a Sexta-feira.',
      slots: []
    });
  }

  // Sem persistência server-side: todos os horários disponíveis
  // (Controle de conflitos será adicionado futuramente com Vercel KV)
  const slots = STANDARD_SLOTS.map(time => ({
    time,
    available: true
  }));

  return res.json({
    date,
    isBusinessDay: true,
    timezone: 'America/Sao_Paulo (BRT)',
    slots
  });
};
