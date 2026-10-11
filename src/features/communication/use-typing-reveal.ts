"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tempo de "digitação" da resposta automática: cresce com o tamanho do texto (1,2 s a 3,2 s). */
export function typingDelay(text: string): number {
  return Math.min(3200, Math.max(1200, 700 + text.length * 18));
}

/** Pausa entre a chegada da mensagem do participante e o início do "digitando…". */
const THINK_MS = 450;
/** Intervalo entre duas respostas automáticas seguidas. */
const BETWEEN_MS = 350;

interface RevealMessage {
  id: string;
  direction: string;
  automated: boolean;
  body: string;
}

/**
 * Efeito de digitação para respostas automáticas.
 *
 * O servidor processa e grava a resposta na hora; só a exibição é atrasada. Mensagens
 * automáticas que chegam DEPOIS da abertura da conversa ficam ocultas, um balão
 * "digitando…" aparece e cada resposta é revelada após um atraso proporcional ao texto.
 * Ao abrir ou trocar de conversa, o histórico aparece de uma vez, sem animação.
 */
export function useTypingReveal<T extends RevealMessage>(messages: T[], conversationId: string) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [typing, setTyping] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const currentConversation = useRef(conversationId);
  const generation = useRef(0);
  const queue = useRef<T[]>([]);
  const running = useRef(false);
  const alive = useRef(true);
  const onSettled = useRef<(() => void)[]>([]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const flushSettled = useCallback(() => {
    const callbacks = onSettled.current;
    onSettled.current = [];
    callbacks.forEach((cb) => cb());
  }, []);

  const runQueue = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const gen = generation.current;
    await sleep(THINK_MS);
    while (queue.current.length > 0 && alive.current && gen === generation.current) {
      const m = queue.current.shift()!;
      setTyping(true);
      await sleep(typingDelay(m.body));
      if (!alive.current || gen !== generation.current) break;
      setTyping(false);
      setHidden((h) => {
        const next = new Set(h);
        next.delete(m.id);
        return next;
      });
      if (queue.current.length > 0) await sleep(BETWEEN_MS);
    }
    running.current = false;
    if (alive.current) {
      setTyping(false);
      flushSettled();
    }
  }, [flushSettled]);

  useEffect(() => {
    // Primeira renderização ou troca de conversa: o histórico aparece de uma vez.
    if (seen.current === null || currentConversation.current !== conversationId) {
      currentConversation.current = conversationId;
      generation.current++;
      seen.current = new Set(messages.map((m) => m.id));
      queue.current = [];
      setHidden(new Set());
      setTyping(false);
      return;
    }
    const fresh = messages.filter((m) => !seen.current!.has(m.id));
    fresh.forEach((m) => seen.current!.add(m.id));
    const automated = fresh.filter((m) => m.direction === "OUTBOUND" && m.automated);
    if (automated.length === 0) return;
    setHidden((h) => new Set([...h, ...automated.map((m) => m.id)]));
    queue.current.push(...automated);
    void runQueue();
  }, [messages, conversationId, runQueue]);

  /**
   * Executa `cb` depois que as respostas automáticas terminarem de aparecer
   * (ou logo, se nenhuma vier). Usado para mostrar o aviso no momento certo.
   */
  const whenSettled = useCallback((cb: () => void) => {
    // Espera a atualização da conversa chegar do servidor antes de decidir.
    setTimeout(() => {
      if (running.current || queue.current.length > 0) onSettled.current.push(cb);
      else cb();
    }, 400);
  }, []);

  return { visible: messages.filter((m) => !hidden.has(m.id)), typing, whenSettled };
}
