export interface ModelPricing {
  inputCostPerToken: number;
  inputCostPerTokenAbove200k: number | null;
  cacheCreationCostPerToken: number;
  cacheCreationCostPerTokenAbove200k: number | null;
  cachedInputCostPerToken: number;
  cachedInputCostPerTokenAbove200k: number | null;
  outputCostPerToken: number;
  outputCostPerTokenAbove200k: number | null;
}

export interface TokenUsageTotals {
  inputTokens: number;
  cacheCreationTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

const PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const DEFAULT_TIERED_THRESHOLD = 200_000;

const PROVIDER_PREFIXES = [
  "anthropic/",
  "bedrock/",
  "vertex_ai/",
  "claude-3-5-",
  "claude-3-",
  "claude-",
  "openrouter/openai/",
];
const MODEL_ALIASES = new Map<string, string>([
  ["claude-3-opus", "claude-3-opus-20240229"],
  ["claude-3-sonnet", "claude-3-sonnet-20240229"],
  ["claude-3-haiku", "claude-3-haiku-20240307"],
  ["claude-3.5-sonnet", "claude-3-5-sonnet-20241022"],
  ["claude-3.5-haiku", "claude-3-5-haiku-20241022"],
  ["claude-opus-4", "claude-opus-4-20250514"],
  ["claude-sonnet-4", "claude-sonnet-4-20250514"],
]);

let cachedPricing: Map<string, any> | null = null;

export async function getModelPricing(model: string): Promise<ModelPricing | null> {
  const pricing = await loadPricingDataset();
  if (!pricing || pricing.size === 0) return null;

  const candidates = createCandidates(model);
  for (const candidate of candidates) {
    const record = pricing.get(candidate);
    if (record) {
      return normalizePricing(record);
    }
  }

  // Fallback: try substring match (best-effort)
  const lower = model.toLowerCase();
  for (const [key, value] of pricing.entries()) {
    const cmp = key.toLowerCase();
    if (cmp.includes(lower) || lower.includes(cmp)) {
      return normalizePricing(value);
    }
  }

  return null;
}

export function calculateCostUSD(usage: TokenUsageTotals, pricing: ModelPricing): number {
  const inputTokens = Math.max(usage.inputTokens, 0);
  const outputTokens = Math.max(usage.outputTokens, 0);
  const cacheCreationTokens = Math.max(usage.cacheCreationTokens, 0);
  const cacheReadTokens = Math.max(usage.cachedInputTokens, 0);

  const inputCost = calculateTieredCost(
    inputTokens,
    pricing.inputCostPerToken,
    pricing.inputCostPerTokenAbove200k
  );
  const outputCost = calculateTieredCost(
    outputTokens,
    pricing.outputCostPerToken,
    pricing.outputCostPerTokenAbove200k
  );
  const cacheCreationCost = calculateTieredCost(
    cacheCreationTokens,
    pricing.cacheCreationCostPerToken,
    pricing.cacheCreationCostPerTokenAbove200k
  );
  const cacheReadCost = calculateTieredCost(
    cacheReadTokens,
    pricing.cachedInputCostPerToken,
    pricing.cachedInputCostPerTokenAbove200k
  );

  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

async function loadPricingDataset(): Promise<Map<string, any>> {
  if (cachedPricing) return cachedPricing;

  try {
    const response = await fetch(PRICING_URL, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return new Map();
    }
    const data = (await response.json()) as Record<string, any>;
    cachedPricing = new Map(Object.entries(data));
    return cachedPricing;
  } catch {
    return new Map();
  }
}

function createCandidates(model: string): string[] {
  const candidates = new Set<string>();
  candidates.add(model);
  const alias = MODEL_ALIASES.get(model);
  if (alias) {
    candidates.add(alias);
  }
  for (const prefix of PROVIDER_PREFIXES) {
    candidates.add(`${prefix}${model}`);
    if (alias) {
      candidates.add(`${prefix}${alias}`);
    }
  }
  return Array.from(candidates);
}

function toPerToken(value?: number, fallback?: number): number {
  const candidate = value ?? fallback ?? 0;
  return Number.isFinite(candidate) ? candidate : 0;
}

function toOptionalPerToken(value?: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePricing(record: any): ModelPricing {
  return {
    inputCostPerToken: toPerToken(record?.input_cost_per_token),
    inputCostPerTokenAbove200k: toOptionalPerToken(record?.input_cost_per_token_above_200k_tokens),
    cacheCreationCostPerToken: toPerToken(record?.cache_creation_input_token_cost),
    cacheCreationCostPerTokenAbove200k: toOptionalPerToken(
      record?.cache_creation_input_token_cost_above_200k_tokens
    ),
    cachedInputCostPerToken: toPerToken(record?.cache_read_input_token_cost),
    cachedInputCostPerTokenAbove200k: toOptionalPerToken(
      record?.cache_read_input_token_cost_above_200k_tokens
    ),
    outputCostPerToken: toPerToken(record?.output_cost_per_token),
    outputCostPerTokenAbove200k: toOptionalPerToken(record?.output_cost_per_token_above_200k_tokens),
  };
}

function calculateTieredCost(
  totalTokens: number,
  basePrice: number,
  tieredPrice: number | null,
  threshold: number = DEFAULT_TIERED_THRESHOLD
): number {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    return 0;
  }

  if (totalTokens > threshold && tieredPrice != null) {
    const tokensBelowThreshold = Math.min(totalTokens, threshold);
    const tokensAboveThreshold = Math.max(0, totalTokens - threshold);

    let tieredCost = tokensAboveThreshold * tieredPrice;
    if (basePrice > 0) {
      tieredCost += tokensBelowThreshold * basePrice;
    }
    return tieredCost;
  }

  if (basePrice > 0) {
    return totalTokens * basePrice;
  }

  return 0;
}
