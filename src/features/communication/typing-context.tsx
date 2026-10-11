"use client";

import { createContext, useContext, useState } from "react";

/** Qual conversa está com a automação "digitando" — compartilhado entre a conversa e a lista. */
const TypingContext = createContext<{ typingId: string | null; setTypingId: (id: string | null) => void } | null>(null);

export function TypingProvider({ children }: { children: React.ReactNode }) {
  const [typingId, setTypingId] = useState<string | null>(null);
  return <TypingContext.Provider value={{ typingId, setTypingId }}>{children}</TypingContext.Provider>;
}

export function useTypingContext() {
  return useContext(TypingContext);
}

/** Prévia da última mensagem na lista: mostra "digitando…" enquanto a automação responde. */
export function ListPreview({ conversationId, children }: { conversationId: string; children: React.ReactNode }) {
  const ctx = useTypingContext();
  if (ctx?.typingId === conversationId) {
    return <span className="truncate font-medium text-brand-700 italic">digitando…</span>;
  }
  return <>{children}</>;
}
