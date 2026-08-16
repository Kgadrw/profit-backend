import { generateMotivationalGreeting } from '../utils/geminiGreetings.js';

export const getMotivationalGreeting = async (req, res) => {
  try {
    const firstName =
      String(req.query.firstName || req.user?.name || '')
        .trim()
        .split(/\s+/)[0] || 'there';

    const result = await generateMotivationalGreeting({
      firstName,
      userId: String(req.user?._id || req.user?.id || ''),
    });

    res.json({
      greeting: result.greeting,
      slot: result.slot,
      source: result.source,
    });
  } catch (error) {
    console.error('Motivational greeting error:', error);
    res.status(500).json({ error: 'Failed to generate greeting' });
  }
};
