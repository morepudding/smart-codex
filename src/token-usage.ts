import type { Usage } from "@openai/codex-sdk";
import type { TokenUsage } from "./types.js";

export function zeroTokenUsage(): TokenUsage {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
}

export function tokenUsageFromSdk(usage: Usage | null | undefined): TokenUsage {
  if (!usage) return zeroTokenUsage();
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
  };
}

export function addTokenUsage(...usages: TokenUsage[]): TokenUsage {
  return usages.reduce((total, usage) => ({
    inputTokens: total.inputTokens + usage.inputTokens,
    cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    reasoningOutputTokens: total.reasoningOutputTokens + usage.reasoningOutputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
  }), zeroTokenUsage());
}
