import Anthropic from "@anthropic-ai/sdk";
import type { Usage } from "./costTracker";

export interface LlmCompletion {
  text: string;
  usage: Usage;
}

/**
 * The minimal LLM surface the rest of the app depends on. Depending on this
 * interface (not the SDK directly) is what lets tests inject a fake client and
 * run the whole intent pipeline with no key and no network.
 */
export interface LlmClient {
  complete(args: { system: string; user: string }): Promise<LlmCompletion>;
}

export interface AnthropicClientOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Real Anthropic-backed client. The constant `system` prompt is sent as a
 * cache_control:ephemeral block so it caches once it's large enough to qualify.
 * HONEST CAVEAT: at the current ~450-token prompt size this is below Haiku's
 * minimum cacheable length, so no cache hit actually occurs (cacheRead stays 0);
 * it's wired so it activates for free as the prompt grows. The cost lever that
 * actually bites today is calling the LLM ONLY when the rule parser can't cope
 * (the % handled free on the dashboard) — see costTracker.
 */
export class AnthropicClient implements LlmClient {
  private readonly sdk: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set (and no apiKey was passed).");
    }
    this.sdk = new Anthropic({ apiKey });
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
    this.maxTokens = opts.maxTokens ?? 400;
  }

  async complete(args: { system: string; user: string }): Promise<LlmCompletion> {
    const msg = await this.sdk.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: args.user }],
    });

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const u = msg.usage;
    return {
      text,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
