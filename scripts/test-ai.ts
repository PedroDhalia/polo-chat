// Teste de conexão com a IA real: UMA chamada à API da Anthropic (≈ US$ 0,01).
// Uso: npm run ia:teste   (lê ANTHROPIC_API_KEY de .env.local)

import { existsSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const root = path.resolve(__dirname, "..");
// .env.local primeiro (onde fica a chave); o .env completa o resto sem sobrescrever.
for (const file of [".env.local", ".env"]) {
  const p = path.join(root, file);
  if (existsSync(p)) process.loadEnvFile(p);
}

async function main() {
  const { LiveAssistAiAdapter } = await import("@/integrations/ai/live");
  const { DEFAULT_AI_MODEL, estimateCostUsd } = await import("@/domain/assist-ai");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\n✘ ANTHROPIC_API_KEY não encontrada. Crie o arquivo .env.local na pasta do projeto com:\n  ANTHROPIC_API_KEY=\"sk-ant-...\"\n");
    process.exitCode = 1;
    return;
  }
  const model = process.env.ASSIST_AI_MODEL || DEFAULT_AI_MODEL;
  console.log(`\nTestando a IA real (${model})…`);
  const ai = new LiveAssistAiAdapter(model);
  try {
    const { result, usage } = await ai.interpret({
      message: "comfirmo, to dentro",
      history: [{ from: "centro", text: "Olá, [nome]! Gostaríamos de confirmar sua visita amanhã às 10:30. Responda CONFIRMO para confirmar ou REMARCAR se precisar de outro horário." }],
      context: { stage: "participante", hasPendingVisit: true, hasConfirmedVisit: false, hasDateProposal: false, hasScheduledCall: false },
    });
    const tokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens;
    console.log(`\n✔ Conexão ok — respondeu ${usage.model} em ${(usage.latencyMs / 1000).toFixed(1)} s`);
    console.log(`  Leitura: ${result.intent} (confiança ${result.confidence}${result.ambiguous ? ", ambígua" : ""})`);
    console.log(`  Justificativa: ${result.rationale}`);
    console.log(`  Tokens: ${tokens} (entrada ${usage.inputTokens}, cache ${usage.cacheReadTokens + usage.cacheWriteTokens}, saída ${usage.outputTokens})`);
    console.log(`  Custo estimado: US$ ${estimateCostUsd(usage.model, usage).toFixed(4)}`);
    console.log(`\nPara usar no app: ASSIST_AI_MODE="live" no .env.local e reinicie o servidor (npm run demo).\n`);
  } catch (e) {
    process.exitCode = 1;
    if (e instanceof Anthropic.AuthenticationError) console.error("\n✘ Chave inválida ou revogada. Gere outra em console.anthropic.com → API Keys.\n");
    else if (e instanceof Anthropic.PermissionDeniedError) console.error("\n✘ A chave não tem permissão para este modelo ou workspace.\n");
    else if (e instanceof Anthropic.RateLimitError) console.error("\n✘ Limite de uso atingido. Aguarde um pouco e tente de novo.\n");
    else if (e instanceof Anthropic.BadRequestError) console.error(`\n✘ Requisição recusada: ${e.message}\n  (Se mencionar saldo/crédito, adicione créditos em console.anthropic.com → Billing.)\n`);
    else if (e instanceof Anthropic.APIConnectionError) console.error("\n✘ Sem conexão com a API da Anthropic (internet, proxy ou firewall).\n");
    else if (e instanceof Anthropic.APIError) console.error(`\n✘ Erro da API (${e.status}): ${e.message}\n`);
    else console.error(`\n✘ ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

main();
