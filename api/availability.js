// =============================================================================
// LinSolutions — Serverless Function: GET /api/availability
// Retorna horários disponíveis com sincronização em tempo real do Calendário GoDaddy
// =============================================================================

const { getAvailability } = require('./_calendar');

module.exports = async (req, res) => {
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

  try {
    const result = await getAvailability(date);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({
      error: err.message || 'Erro ao processar disponibilidade.'
    });
  }
};

