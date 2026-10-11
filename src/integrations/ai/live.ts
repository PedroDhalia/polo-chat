import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { buildUserContent, parseInterpretation, RESULT_SCHEMA, SYSTEM_PROMPT } from "./prompt";
import type { AiInterpretInput, AssistAiAdapter } from "./types";

/** Modelos que aceitam o fallback automático do servidor quando os filtros de segurança recusam. */
const SUPPORTS_FALLBACK = /^claude-(opus-5|fable-5|sonnet-5-5)/;

/**
 * Interpretação real pela API da Anthropic (ASSIST_AI_MODE=live). Credenciais pelo ambiente
 * (ANTHROPIC_API_KEY ou perfil do `ant auth login`). Classificação curta: esforço baixo,
 * instruções fixas em cache e resposta no formato exigido (saída estruturada).
 */
export class LiveAssistAiAdapter implements AssistAiAdapter {
  readonly mode = "live" as const;
  private client: Anthropic | null = null;

  constructor(readonly model: string) {}

  async interpret(input: AiInterpretInput) {
    const started = Date.now();
    const fallback = SUPPORTS_FALLBACK.test(this.model);
    // Criado na primeira chamada: sem credenciais, falha só esta análise (a mensagem fica na fila).
    this.client ??= new Anthropic({ timeout: 20_000, maxRetries: 1 });
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 2048,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserContent(input) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: RESULT_SCHEMA } },
    });
    if (response.stop_reason === "refusal") throw new Error("A IA recusou analisar esta mensagem.");
    if (response.stop_reason === "max_tokens") throw new Error("Resposta da IA incompleta (limite de tokens).");
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("A IA não devolveu a classificação.");
    return {
      result: parseInterpretation(text.text),
      usage: {
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        latencyMs: Date.now() - started,
      },
    };
  }
}
