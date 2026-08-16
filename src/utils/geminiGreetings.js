import { GoogleGenerativeAI } from '@google/generative-ai';

const FALLBACK_BY_SLOT = {
  morning: ['Rise & shine ☀️', 'Fresh start energy ☀️', 'Let’s build today 💪'],
  afternoon: ['Keep crushing it ⚡', 'Momentum looks good ⚡', 'Stay sharp 🎯'],
  evening: ['Strong finish 🔥', 'Close the day strong 🔥', 'One more win ✨'],
  late: ['Late grind mode 🚀', 'Quiet hours, big progress 🚀', 'Keep the streak alive 💫'],
};

function timeSlot(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'late';
}

function pickFallback(slot) {
  const list = FALLBACK_BY_SLOT[slot] || FALLBACK_BY_SLOT.afternoon;
  return list[Math.floor(Math.random() * list.length)];
}

function sanitizeGreeting(raw) {
  if (!raw) return '';
  let text = String(raw)
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop trailing punctuation that feels like a full sentence end.
  text = text.replace(/[.!]+$/g, '').trim();
  if (text.length > 42) {
    text = `${text.slice(0, 41).trim()}…`;
  }
  return text;
}

const cache = new Map(); // key -> { greeting, expiresAt }

function cacheKey(userId, firstName, slot) {
  const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  return `${userId || 'anon'}:${firstName || ''}:${slot}:${hourBucket}`;
}

/**
 * Generate a short motivational greeting phrase (no name).
 * Falls back to curated phrases if Gemini is unavailable.
 */
export async function generateMotivationalGreeting({
  firstName = 'there',
  userId = '',
} = {}) {
  const slot = timeSlot();
  const key = cacheKey(userId, firstName, slot);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { greeting: cached.greeting, source: 'cache', slot };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const greeting = pickFallback(slot);
    return { greeting, source: 'fallback', slot };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    });

    const prompt = `You write ultra-short motivational greetings for a business app header.

Rules:
- Return ONLY the greeting phrase (no quotes, no name, no explanation)
- Max 5 words
- Include exactly one fitting emoji
- Tone: energetic, encouraging, professional-casual
- Never say "good night" or imply the user should sleep
- Match this time of day: ${slot}
- User first name for vibe only (do NOT include it): ${firstName}

Examples:
Rise & shine ☀️
Keep crushing it ⚡
Strong finish 🔥
Late grind mode 🚀`;

    const result = await model.generateContent(prompt);
    const raw = result?.response?.text?.() || '';
    const greeting = sanitizeGreeting(raw) || pickFallback(slot);

    cache.set(key, {
      greeting,
      expiresAt: Date.now() + 55 * 60 * 1000,
    });

    return { greeting, source: 'gemini', slot };
  } catch (error) {
    console.warn('[Gemini] Greeting generation failed:', error?.message || error);
    const greeting = pickFallback(slot);
    return { greeting, source: 'fallback', slot };
  }
}
