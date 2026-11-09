# Polo Chat — MVP

Camada operacional para centros de pesquisa clínica: **centralizar → organizar → automatizar → acompanhar**.

Este MVP é uma versão navegável, com **dados 100% fictícios**, para demonstrar à equipe do Centro de Pesquisa Plátano como seria ter um único lugar para saber o que está acontecendo nos estudos, quem está em cada etapa, quais visitas se aproximam, quem precisa de contato e o que precisa ser feito.

> **O que o Polo Chat não é:** não substitui o Polo Trial, não é prontuário eletrônico, eCRF, IRT/IWRS nem repositório de source documents. O Polo Trial continua sendo a fonte dos dados clínicos e protocolares. Janelas de visita e contagens de triagem/inclusão são apenas **espelhadas**, nunca recalculadas.

---

## Como rodar

Requisitos: **Node.js 20+** (testado com 22) e npm.

```bash
npm install
cp .env.example .env   # variáveis locais (no Windows/cmd: copy .env.example .env)
npm run setup     # cria o banco local (SQLite) e carrega os dados de demonstração
npm run demo      # versão otimizada — http://localhost:3000
```

**Para estudar e apresentar, use `npm run demo`.** Ele gera a versão de produção e abre em `http://localhost:3000`: cada tela responde em ~30 ms e o servidor usa ~120 MB de RAM. O `npm run dev` é só para quem vai alterar o código: recompila a cada mudança, usa ~1 GB de RAM e cada tela leva de 0,2 a 0,5 s. Para encerrar qualquer um dos dois, use `Ctrl+C` no terminal (fechar a janela do terminal pode deixar o processo rodando em segundo plano).

| Comando | O que faz |
| --- | --- |
| `npm run demo` | Gera e abre a versão otimizada (para estudar e apresentar) |
| `npm run dev` | Servidor de desenvolvimento (para alterar o código) |
| `npm run setup` | Cria o banco e carrega o seed (primeira vez) |
| `npm run db:reset` | Recarrega os dados de demonstração (datas relativas a hoje) |
| `npm run verify` | Verifica os fluxos principais e as automações em um banco isolado (não toca nos dados da demo) |
| `npm run typecheck` | Checagem de tipos |
| `npm run build` / `npm start` | Build e execução de produção |
| `npm run clean` | Apaga a pasta `.next` (caches e builds), caso ela cresça demais |

**Antes de cada demonstração**, rode `npm run db:reset`, ou use *Configurações → Dados e privacidade → Restaurar dados de demonstração*. As datas são relativas ao dia em que o seed roda, então "hoje" e "amanhã" sempre fazem sentido.

---

## Roteiro de demonstração (~5 min)

| # | Onde | O que mostrar |
| --- | --- | --- |
| 1 | **Dashboard** | Frase-resumo do dia (visitas, pendências abertas, visitas de amanhã aguardando confirmação) e a lista **Atenção necessária**, consolidada de todas as fontes. |
| 2 | **Estudos → VAC-2026** | "368 de 500" recrutados, ritmo *abaixo do esperado*, evolução × plano. Contagens marcadas como dado do Polo Trial. |
| 3 | **Recrutamento** | Funil completo (base → incluídos), taxas, desempenho por canal e pipeline de candidatos. *Simular formulário recebido* mostra o fim do recadastro manual (Google Forms → sistema). |
| 4 | **Buscar "Maria Santos"** | Ficha operacional: próxima ação "Confirmar visita amanhã", linha do tempo (formulário → pré-triagem → contato → resposta → visita agendada → lembrete automático). |
| 5 | **Abrir conversa** | "Visita amanhã às 09:00 — aguardando confirmação". Lembrete enviado pela automação com modelo aprovado pelo CEP. |
| 6 | **Simular resposta → "Confirmo"** | A Assistência IA classifica como *Confirmação de presença* (confiança 95, mínimo 85) e aplica sozinha: a visita vira **Confirmado** e a confirmação chega com a animação de "digitando…", sem clique da equipe. Para mostrar o humano na exceção, simule "ok" em outro participante: confiança 72, vai para a fila, e **Confirmar visita** aprova. |
| 7 | **Pendências** | "Renata Fonseca não respondeu ao segundo contato": o 2º contato foi um follow-up automático e, sem resposta, virou pendência de ligação. Veja também João Silva (falta → reagendamento) e o alerta de janela vindo do Polo Trial. |
| 8 | **Relatórios** | Evolução da meta por estudo, recrutamento por canal, visitas realizadas × perdidas. *Exportar CSV* substitui o relatório montado à mão. |

Extras para perguntas:
- **Troca de perfil:** menu inferior da barra lateral. Por exemplo, *Financeiro* não vê Comunicação; *Assistente* vê só seus estudos.
- **Salvaguarda clínica:** simule a resposta "Estou com febre…". A assistência não sugere resposta e cria uma pendência de alta prioridade para a coordenação.
- **IA no modo automático:** todos os estudos vêm com as 5 intenções configuráveis no automático. Simule "Confirmo" em **Eduardo Ramos** (visita amanhã às 10:30): visita **Confirmada** e confirmação enviada, sem clique da equipe. Para mostrar o modo sugestão, mude um estudo para "Só sugerir" em Configurações → *Assistência IA*.
- **Interesse → ligação agendada:** em um candidato sem visita (ex.: **Renata Fonseca**), simule "Tenho interesse, pode me ligar amanhã de manhã". A IA cria a pendência de ligação para amanhã às 10:00 (ou o próximo dia útil, se amanhã for fim de semana) e envia "Ligação agendada" com o horário.
- **Fila de revisão:** Comunicação → *Revisão da IA* mostra o que a IA deixou para a equipe (e por quê) e o que ela aplicou sozinha, com "A IA acertou?" para revisão por amostragem.
- **Política por estudo:** Configurações → *Assistência IA*: por intenção, "Só sugerir" ou "Automático" com confiança mínima; follow-up com número de tentativas, intervalo e horário de envio.
- **Automações:** *Executar ciclo* (Dashboard ou Configurações → Automações) envia o lembrete pendente e o follow-up de Wellington Barbosa (1/1). Rodando de novo depois de 24h sem resposta, vira pendência de ligação. Fora do horário de envio (padrão 07h–21h), nada sai.

---

## Arquitetura

**Stack:** Next.js 16 (App Router, Server Components e Server Actions), React 19, TypeScript, Tailwind CSS 4, Prisma 6 e SQLite. Os gráficos são SVG/HTML próprios, sem biblioteca extra.

```
prisma/schema.prisma        modelo de dados (portável para PostgreSQL)
prisma/seed.ts              carrega src/server/demo/seed.ts
src/app/(app)/              páginas: dashboard, estudos, recrutamento, participantes,
                            comunicação, agenda, pendências, financeiro, relatórios, configurações
src/components/ui|charts|layout   primitivos visuais, gráficos e shell
src/features/<área>/        composições por área (tabelas, listas, painéis)
src/domain/                 vocabulário e regras puras: rótulos, permissões (RBAC), ritmo, modelos,
                            política da assistência e do follow-up (assist-policy.ts)
src/server/
  auth/session.ts           sessão de demonstração + escopo por estudo
  queries/                  leituras (sempre filtradas pelo escopo do usuário)
  actions/                  server actions: autorização → serviço → automação → revalidação
  services/                 operações de domínio + auditoria + linha do tempo
  automations/              regras (Evento → Regra → Ação) e motor
  ai/assist.ts              assistência simulada (regras): intenção + confiança 0–100
  demo/seed.ts              dados fictícios determinísticos
src/integrations/           contratos + adapters simulados: polo-trial, whatsapp, forms, finance
scripts/verify-flows.ts     verificação dos fluxos principais
```

**Fluxo de uma ação** (ex.: confirmar visita): `server action` → checa permissão e escopo do estudo → `services/visits` altera o status, grava a linha do tempo e o `AuditLog` → `automations/engine.dispatch("visit.confirmed")` envia o modelo de confirmação pelo adapter de WhatsApp (simulado), encerra as pendências da visita e resolve a conversa → `AutomationRun` registra o resultado → a interface é revalidada.

### Modelo de dados

Entidades: `User`, `StudyMember`, `Study`, `Participant`, `Recruitment`, `RecruitmentStage`, `RecruitmentMetric`, `ConsentRecord`, `Visit`, `Conversation`, `Communication`, `MessageTemplate`, `Task`, `Reimbursement`, `FinancialRecord`, `TimelineEvent`, `AuditLog`, `Notification`, `ExternalReference`, `AutomationRule`, `AutomationRun`, `StudyAutomationSettings`, `AssistPolicy`, `AssistDecision`.

- **Separação por estudo:** todos os registros operacionais têm `studyId`. O acesso é recortado por `StudyMember`, e Diretor, Financeiro e Qualidade têm acesso transversal.
- **Fonte externa:** `Study.enrolledCount/screeningCount` e `Visit.windowStart/windowEnd` são snapshots do Polo Trial. `ExternalReference` mapeia IDs externos sem acoplar o modelo a uma API.
- **Migrar para PostgreSQL:** troque `provider = "sqlite"` por `"postgresql"` em `prisma/schema.prisma` e ajuste `DATABASE_URL`. Valores monetários ficam em centavos (`Int`) e os enums são nativos do Prisma. As buscas textuais usam `contains`, que em PostgreSQL diferencia maiúsculas; adicione `mode: "insensitive"` nas consultas.

### Integrações

Veja [`src/integrations/README.md`](src/integrations/README.md). Nenhuma parte do sistema fala com um sistema externo diretamente: tudo passa por `getIntegrations()`. **Nenhum endpoint do Polo Trial foi assumido.** Os contratos descrevem o que o Polo Chat precisa receber, e o adapter real será escrito a partir da documentação oficial.

### Mensagens a participantes

O compositor da Comunicação tem três modos:

| Modo | Para quê | Regras |
| --- | --- | --- |
| **Modelo aprovado** | Textos aprovados pelo CEP, com variáveis (`{{nome}}`, `{{data}}`…) preenchidas | Bloqueia modelo não aprovado, de outro estudo ou sem visita quando o modelo exige |
| **Texto livre** | Mensagem escrita do zero pela equipe (agenda, logística, documentos) | Até 1.000 caracteres; marcada como "Texto livre" na conversa; auditoria `message.free_text_sent` guarda o texto; "Aguardar resposta" decide se a conversa entra no follow-up automático |
| **Nota interna** | Registro visível só para a equipe | Nunca vai ao participante |

Os dois envios exigem consentimento de WhatsApp. **Texto livre é exclusivo de pessoas da equipe**: automações e Assistência IA continuam usando só modelos aprovados. O follow-up de uma conversa iniciada com texto livre também sai com modelo aprovado.

**Janela de 24h:** no WhatsApp Business, texto fora de modelo só é aceito até 24h após a última mensagem do participante. O compositor mostra se a janela está aberta. Na simulação o envio fora da janela é permitido, com aviso; na integração real ele seria recusado pela plataforma, e será preciso um modelo aprovado.

### Automações

| Regra | Evento → Ação |
| --- | --- |
| Lembrete de visita | Visita amanhã → envia "Lembrete de visita" (sem consentimento de WhatsApp: cria pendência de ligação) |
| Follow-up sem resposta | Sem resposta após o intervalo do estudo → envia "Segundo contato" (candidatos) ou "Solicitação de contato" (incluídos) até o limite de tentativas, só dentro do horário de envio. Esgotadas as tentativas, sem consentimento, ou com visita em menos de 24h sem confirmação → pendência de ligação. Se o participante responder, a pendência se encerra e a contagem zera |
| Falta em visita | Visita marcada como "Faltou" → envia "Falta na visita" (com consentimento de WhatsApp) e cria pendência de reagendamento (alta). A conversa fica aguardando resposta |
| Visita confirmada | Equipe confirma → envia "Confirmação de agendamento" e encerra pendências da visita |
| Reembolso após visita | Visita realizada → reembolso pendente para o financeiro |
| Entrada por formulário | Formulário recebido → cadastra candidato e cria pendência de primeiro contato |
| Possível relato clínico | Mensagem com sintomas → **nenhuma resposta automática**, pendência alta para a coordenação |
| Assistência IA (aplicação automática) | Mensagem classificada → aplica sozinha se o estudo estiver em modo automático para a intenção e a confiança atingir o mínimo; senão, fila de revisão. Desligar esta regra desliga toda aplicação automática |

As regras por evento rodam imediatamente após a ação. As agendadas rodam em *Executar ciclo*; no produto real, rodariam por um agendador (cron/fila).

### Agendar visita (depois da ligação de pré-triagem)

Conversa sem visita mostra **Agendar visita**: tipo (Triagem, Inclusão…), nome conforme o protocolo, dia e horário. Com "Já combinado com o participante" (padrão), a visita entra **confirmada** e a "Confirmação de agendamento" sai automaticamente com a data; sem isso, fica aguardando confirmação ("Pedir confirmação" ou lembrete da véspera). Também encerra a pendência de ligação de pré-triagem, muda o candidato para "Agendado" (triagem) e cria a pendência de **registrar a visita no Polo Trial**. Não cria segunda visita se já houver uma ativa (use remarcar).

Ao escolher a data (aqui e em "Propor nova data"), aparece a **agenda do dia**: visitas já marcadas, aviso se o horário coincide com outra visita (em vermelho se for do mesmo responsável), horários livres do responsável (clique para usar) e link para a agenda completa.

### Remarcação com nova data

Quando a visita está com **remarcação solicitada** ou **falta**, o banner da conversa mostra **Propor nova data**:

1. A equipe escolhe dia e horário. A proposta precisa caber na janela informada pelo Polo Trial (fora dela é bloqueada).
2. O participante recebe o modelo aprovado "Proposta de nova data" (`{{nova_data}}`, `{{nova_hora}}`) e a conversa fica aguardando resposta. **A visita continua na data antiga**; a agenda mostra "Nova data proposta".
3. Se ele responde confirmando ("Confirmo"), a assistência aplica (ou deixa na fila, conforme a política): a visita **muda para a nova data já confirmada**, a "Confirmação de agendamento" sai com a nova data, a pendência de reagendamento é encerrada e fica uma pendência para **registrar a nova data no Polo Trial** (o Polo Chat não escreve no Polo Trial).
4. Se ele diz que não pode ("não consigo, pode ser outro dia?"), a proposta cai e a equipe propõe outra.
5. Combinado por telefone? **Confirmar nova data** no banner faz o mesmo que a confirmação do participante.

O "Reagendar" da Agenda continua disponível para mudar a data direto, sem consultar o participante.

### IA

Neste MVP a "Assistência IA" é **simulada por regras** e fica atrás da interface `analyzeMessage`, pronta para ser trocada por um modelo de linguagem. Ela classifica a mensagem e dá uma **nota de confiança de 0 a 100**: detecta negação ("não confirmo" não é confirmação) e mensagens com mais de uma intenção (nunca automáticas).

**Automático na regra, humano na exceção.** O que acontece com cada mensagem é decidido pela política do estudo (`src/domain/assist-policy.ts`):

| Situação | Resultado |
| --- | --- |
| Estudo em modo automático para a intenção e confiança ≥ mínimo | Aplicada sozinha (`AUTOMATICA`) e entra na revisão por amostragem |
| Modo sugestão, confiança abaixo do mínimo, mais de uma intenção ou nada a aplicar | Fila de revisão (`PENDENTE`): a equipe aprova ou trata manualmente |
| Possível relato clínico | Sempre encaminhada à equipe médica (`ENCAMINHADA`), sem resposta |
| Não classificada | Sempre com a equipe |

O que a IA pode aplicar: confirmar visita (+ confirmação), responder dúvida frequente com resposta aprovada, registrar pedido de remarcação (+ pendência), registrar descadastro (revoga consentimento) e agendar a ligação de pré-triagem para quem demonstrou interesse.

**Ligação de pré-triagem (Interesse):** o horário vem do que o candidato escreveu ("amanhã de manhã" → 10h, "à tarde" → 15h, "depois das 14h" → 14h30, "na sexta às 9h"); sem preferência, é o próximo horário livre (~2h depois). Sempre em dia útil, entre 9h e 18h (`src/domain/call-slot.ts`). A pendência de ligação fica com esse horário e o candidato recebe o modelo "Ligação agendada" com o dia e a hora (`{{ligacao}}`). Esse modelo só é enviado pela automação. Se o candidato pedir outro horário ("não posso esse horário, pode ser a partir das 17?"), a sugestão de novo horário vai para a **equipe aprovar** (painel da conversa ou fila de revisão; dá para aprovar outro horário). Aprovada, a ligação é remarcada e o candidato recebe "Ligação agendada" automaticamente. Se ele só disser a hora, vale o mesmo dia da ligação original; se não sugerir horário, a automação pergunta o melhor com "Solicitação de contato". Quando alguém da equipe age direto na conversa, a sugestão sai da fila como "tratada". Toda mudança de política fica na auditoria.

Na demonstração, **todos os estudos vêm com as 5 intenções configuráveis em modo automático**: confirmação ≥ 85, dúvida frequente ≥ 85, remarcação ≥ 85, descadastro ≥ 90 e interesse ≥ 80 (a nota máxima que o classificador dá para interesse). O histórico da demo foi vivido com o piloto inicial (só AUTO-2026, com confirmação, dúvida e descadastro); a ampliação aparece na auditoria minutos antes da restauração, por isso sugestões antigas ainda estão na fila. O modo "Só sugerir" continua disponível por estudo e por intenção.

Limites que valem em qualquer modo:
- usa apenas **modelos aprovados pelo CEP**, nunca texto livre (texto livre é exclusivo da equipe);
- não decide elegibilidade, não interpreta eventos adversos e não dá orientação médica;
- o texto do participante é tratado como dado, nunca como instrução;
- não escreve no Polo Trial: a integração depende da documentação oficial da API.

### Segunda opinião da IA (Claude)

```
Mensagem ──▶ Regras (grátis, imediatas) ──▶ resolveu? ──▶ segue como hoje
                                │
                                └─ não (confiança baixa, "Não classificada", mais de uma intenção)
                                        ▼
                               IA interpreta (só rotula) ──▶ mesma política do estudo ──▶ aplica ou fila
```

- **Só o resíduo das regras vai para a IA** (`needsAiReview` em `src/domain/assist-ai.ts`); relato clínico detectado pelas regras nunca passa por ela. Se a IA ler algo clínico que as regras não pegaram ("passando mal"), a mensagem é encaminhada à equipe médica.
- **A IA só rotula**: intenção, confiança, se é ambígua, tema da dúvida e dia/horário pedido. A ação continua sendo a do sistema, com modelos aprovados. Se ela não acrescentar nada ("não sei"), vale a leitura das regras.
- **Política**: o rótulo da IA passa pela política da intenção e, para aplicar sozinho, também pelo **modo da IA no estudo** (Desligada / Só sugerir / Automático) e pela **confiança mínima da IA** (padrão 80) — Configurações → Assistência IA. Pedido de novo horário de ligação continua exigindo aprovação da equipe.
- **Dados enviados**: só a mensagem, as últimas mensagens da conversa e o contexto (visita pendente, ligação agendada…), com o primeiro nome trocado por `[nome]`. O texto do participante é tratado como dado, nunca como instrução.
- **Modos** (`.env`): `ASSIST_AI_MODE=mock` (padrão, **simulada**: sem chamada externa e sem custo; estima os tokens de uma chamada real) ou `ASSIST_AI_MODE=live` (API da Anthropic, credenciais por `ANTHROPIC_API_KEY` ou `ant auth login`). Modelo: `ASSIST_AI_MODEL` (padrão `claude-opus-5-5`). No modo real: saída estruturada, esforço baixo, instruções fixas em cache e fallback automático do servidor quando o filtro de segurança recusa. Falha ou demora da IA não quebra nada: a mensagem fica na fila.
- **Consumo**: Configurações → **Consumo da IA** mostra mensagens analisadas, tokens (entrada, cache, saída), custo estimado pelo preço público, projeção para 30 dias, o que cada análise resolveu, custo por estudo e as últimas análises. O painel da conversa mostra os tokens e o custo de cada análise. **Restaurar os dados de demonstração não apaga o consumo**: o histórico acumula o gasto de todos os testes (cada registro guarda o estudo e o resultado da análise).
- **Antes de usar com dados reais**: medir o acerto numa base de respostas reais anonimizadas (começar em "Só sugerir") e fazer a avaliação de LGPD/contrato com o provedor (dados de saúde).

### Segurança e privacidade (preparação, não conformidade)

O MVP **não declara conformidade com a LGPD**. A arquitetura já prevê:
- controle de acesso por função e por estudo;
- telefone mascarado, com exibição auditada;
- e-mail não armazenado;
- consentimento por finalidade, com origem, revogação e prazo de retenção, e envio bloqueado sem consentimento;
- trilha de auditoria para pessoas, automações e integrações.

Pendentes para fases futuras: autenticação real (SSO/MFA), retenção automatizada, anonimização, direitos do titular, criptografia em repouso e avaliação jurídica.

---

## Fora do escopo deste MVP

eCRF, IRT/IWRS, prontuário, source documents, assinatura digital, integrações reais (Polo Trial, WhatsApp, ZapCloud, Google Forms, financeiro), decisões clínicas por IA, automação clínica autônoma, funcionalidades GCP críticas e aplicativo mobile.

## Desempenho

- **OneDrive:** a pasta do projeto está dentro do OneDrive. As dependências (`node_modules`, ~20 mil arquivos) e os builds (`.next`) não precisam ser sincronizados, e a sincronização deles consome disco e CPU. O ideal é manter o projeto fora do OneDrive (ex.: `C:\Projetos\polo-chat`); se não for possível, pause a sincronização enquanto usa o sistema.
- **Cache do modo desenvolvimento desligado:** `next.config.ts` desativa `turbopackFileSystemCacheForDev`, que chegava a ~500 MB em `.next/dev` e era regravado a cada alteração. Fora do OneDrive, pode ser reativado para reinícios mais rápidos.
- **Sem prefetch automático:** todos os links usam `src/components/ui/link.tsx` (`prefetch={false}`). Antes, abrir e rolar 8 telas disparava 336 renderizações no servidor sem nenhum clique.
- **Comunicação:** a lista mostra 40 conversas por vez ("Carregar mais") e envia só o início de cada mensagem.

## Dicas

- O banco local fica em `prisma/dev.db` e é ignorado pelo Git.
