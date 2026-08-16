import { getRwandaHolidaysInRange } from '../utils/rwandaHolidays.js';
import { generateOverviewInsights } from '../utils/geminiOverviewInsights.js';

export const getRwandaHolidays = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const from = String(req.query.from || `${year}-01-01`).slice(0, 10);
    const to = String(req.query.to || `${year + 1}-12-31`).slice(0, 10);

    const holidays = getRwandaHolidaysInRange(from, to);
    return res.json({
      holidays,
      from,
      to,
      source: 'curated',
      country: 'RW',
    });
  } catch (error) {
    console.error('Rwanda holidays error:', error?.message || error);
    return res.json({
      holidays: [],
      source: 'fallback',
      fallback: true,
      message: 'Holidays temporarily unavailable.',
    });
  }
};

export const postOverviewInsights = async (req, res) => {
  try {
    const snapshot =
      req.body?.snapshot && typeof req.body.snapshot === 'object'
        ? req.body.snapshot
        : req.body && typeof req.body === 'object'
          ? req.body
          : {};

    // Keep payload small — strip unexpected huge fields.
    const compact = JSON.parse(JSON.stringify(snapshot, (_key, value) => {
      if (typeof value === 'string' && value.length > 200) return value.slice(0, 200);
      if (Array.isArray(value) && value.length > 40) return value.slice(0, 40);
      return value;
    }));

    const result = await generateOverviewInsights(compact);
    return res.json(result);
  } catch (error) {
    console.error('Overview insights error:', error?.message || error);
    return res.json({
      summary: '',
      ideas: [],
      source: 'fallback',
      fallback: true,
      message: 'AI assistance is temporarily unavailable.',
    });
  }
};
