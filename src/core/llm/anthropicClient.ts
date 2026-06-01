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
 * cached block (cache_control: ephemeral): the schema + instructions are
 * identical on every call, so caching them cuts input cost on repeat requests.
 * That's one of the three visible cost levers (Haiku model + caching +
 * only-call-when-needed).
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
