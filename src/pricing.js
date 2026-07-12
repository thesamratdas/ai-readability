// Cross-tokenizer correction. We count tokens with gpt-tokenizer (OpenAI BPE).
// Claude and Gemini tokenize differently, so their effective token counts — and
// therefore cost and context-window usage — are scaled by a calibrated factor.
// These are approximations: treat all non-OpenAI figures as estimates.
//   Anthropic ≈ 1.25× (Claude runs ~20–30% more tokens than GPT on code/English)
//   Google    ≈ 1.10× (Gemini's SentencePiece is close to, but above, GPT BPE)
export const TOKEN_FACTOR = { Anthropic: 1.25, OpenAI: 1.0, Google: 1.1 };

// Returns the provider-adjusted token count for a given model.
export function effectiveTokens(tokens, model) {
  return Math.round(tokens * (model?.tokenFactor ?? 1));
}

// Bump this whenever RAW_MODELS prices are updated, so the CLI can surface
// how stale the figures might be instead of silently drifting from reality.
export const PRICING_UPDATED_AT = '2026-06-28';

const RAW_MODELS = [
  // Anthropic — platform.claude.com
  { name: 'Claude Opus 4.8',   provider: 'Anthropic', ctx: 1_000_000, usdPerMTok:  5.000 },
  { name: 'Claude Sonnet 4.6', provider: 'Anthropic', ctx: 1_000_000, usdPerMTok:  3.000 },
  { name: 'Claude Haiku 4.5',  provider: 'Anthropic', ctx:   200_000, usdPerMTok:  1.000 },
  // OpenAI — platform.openai.com
  { name: 'GPT-4.1',           provider: 'OpenAI',    ctx: 1_047_576, usdPerMTok:  2.000 },
  { name: 'GPT-4.1 mini',      provider: 'OpenAI',    ctx: 1_047_576, usdPerMTok:  0.400 },
  { name: 'GPT-4.1 nano',      provider: 'OpenAI',    ctx: 1_047_576, usdPerMTok:  0.100 },
  { name: 'GPT-4o',            provider: 'OpenAI',    ctx:   128_000, usdPerMTok:  2.500 },
  { name: 'GPT-4o mini',       provider: 'OpenAI',    ctx:   128_000, usdPerMTok:  0.150 },
  { name: 'o3',                provider: 'OpenAI',    ctx:   200_000, usdPerMTok: 10.000 },
  { name: 'o4-mini',           provider: 'OpenAI',    ctx:   200_000, usdPerMTok:  1.100 },
  // Google — ai.google.dev
  { name: 'Gemini 2.5 Pro',    provider: 'Google',    ctx: 1_048_576, usdPerMTok:  1.250 },
  { name: 'Gemini 2.0 Flash',  provider: 'Google',    ctx: 1_048_576, usdPerMTok:  0.100 },
  { name: 'Gemini 1.5 Pro',    provider: 'Google',    ctx: 1_048_576, usdPerMTok:  1.250 },
  { name: 'Gemini 1.5 Flash',  provider: 'Google',    ctx: 1_048_576, usdPerMTok:  0.075 },
];

export const MODELS = RAW_MODELS.map(m => ({
  ...m,
  tokenFactor: TOKEN_FACTOR[m.provider] ?? 1,
}));

// One model per provider shown in the default context-fit summary.
// GPT-4o is intentionally 128K (not 1M) — it will show OVERFLOW on mid-sized repos,
// making the metric informative rather than always-green.
export const SUMMARY_MODELS = [
  MODELS.find(m => m.name === 'Claude Sonnet 4.6'),
  MODELS.find(m => m.name === 'GPT-4o'),
  MODELS.find(m => m.name === 'Gemini 2.0 Flash'),
];
