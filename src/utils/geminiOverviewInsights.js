import { GoogleGenerativeAI } from '@google/generative-ai';

const INSIGHT_TIMEOUT_MS = 12000;
const MAX_IDEAS = 5;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Overview insights timed out')), ms);
    }),
  ]);
}

function emptyResult(message) {
  return {
    summary: '',
    ideas: [],
    source: 'fallback',
    fallback: true,
    ...(message ? { message } : {}),
  };
}

function sanitizeIdea(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').trim().slice(0, 80);
  const why = String(raw.why || '').trim().slice(0, 160);
  const area = String(raw.area || 'general').trim().slice(0, 40).toLowerCase();
  let actionPath = String(raw.actionPath || '/').trim();
  if (!actionPath.startsWith('/') || actionPath.startsWith('//')) {
    actionPath = '/';
  }
  actionPath = actionPath.slice(0, 120);
  if (!title) return null;
  return { area, title, why, actionPath };
}

function parseInsightsJson(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Generate cross-module business insights from a compact metrics snapshot.
 * Never throws for provider failures — returns empty fallback instead.
 */
export async function generateOverviewInsights(snapshot = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return emptyResult('AI assistance is temporarily unavailable.');
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    });

    const prompt = `You are a business operations coach for Trippo, a Rwanda-focused SME business app.
Given ONLY this compact metrics snapshot (JSON), write actionable insights that connect modules
(stock/inventory, finance, HR/team, projects, calendar/schedules).

Snapshot:
${JSON.stringify(snapshot)}

Rules:
- Return ONLY valid JSON (no markdown) with this shape:
  {
    "summary": "1-2 short sentences about the business health",
    "ideas": [
      {
        "area": "inventory|finance|hr|projects|calendar|sales|general",
        "title": "short action title",
        "why": "one sentence why it matters",
        "actionPath": "/products or /finance/bills or /hr/leave or /projects or /team or /calendar or /sales"
      }
    ]
  }
- Max ${MAX_IDEAS} ideas, prioritized by impact
- Prefer concrete, Rwanda-SME practical advice
- If data is sparse, still give 1-2 gentle setup suggestions
- Never invent specific money amounts not present in the snapshot
- actionPath must be an in-app path starting with /`;

    const result = await withTimeout(model.generateContent(prompt), INSIGHT_TIMEOUT_MS);
    const parsed = parseInsightsJson(result?.response?.text?.() || '');
    if (!parsed) {
      return emptyResult('AI assistance is temporarily unavailable.');
    }

    const summary = String(parsed.summary || '').trim().slice(0, 280);
    const ideas = (Array.isArray(parsed.ideas) ? parsed.ideas : [])
      .map(sanitizeIdea)
      .filter(Boolean)
      .slice(0, MAX_IDEAS);

    if (!summary && ideas.length === 0) {
      return emptyResult('AI assistance is temporarily unavailable.');
    }

    return {
      summary,
      ideas,
      source: 'gemini',
      fallback: false,
    };
  } catch (error) {
    console.warn('[Gemini] Overview insights failed:', error?.message || error);
    return emptyResult('AI assistance is temporarily unavailable.');
  }
}
