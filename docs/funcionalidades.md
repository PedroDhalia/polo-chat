# Funcionalidades e regras de negócio

[← Voltar ao README](../README.md)

- [Mensagens a participantes](#mensagens-a-participantes)
- [Automações](#automações)
- [Agendar visita](#agendar-visita-depois-da-ligação-de-pré-triagem)
- [Remarcação com nova data](#remarcação-com-nova-data)
- [Assistência IA](#assistência-ia)
- [Segunda opinião da IA (Claude)](#segunda-opinião-da-ia-claude)

## Mensagens a participantes

O compositor da Comunicação tem três modos:

| Modo | Para quê | Regras |
| --- | --- | --- |
| **Modelo aprovado** | Textos aprovados pelo CEP, com variáveis (`{{nome}}`, `{{data}}`…) preenchidas | Bloqueia modelo não aprovado, de outro estudo ou sem visita quando o modelo exige |
| **Texto livre** | Mensagem escrita do zero pela equipe (agenda, logística, documentos) | Até 1.000 caracteres; marcada como "Texto livre" na conversa; auditoria `message.free_text_sent` guarda o texto; "Aguardar resposta" decide se a conversa entra no follow-up automático |
| **Nota interna** | Registro visível só para a equipe | Nunca vai ao participante |

Os dois envios exigem consentimento de WhatsApp. **Texto livre é exclusivo de pessoas da equipe**: automações e Assistência IA continuam usando só modelos aprovados. O follow-up de uma conversa iniciada com texto livre também sai com modelo aprovado.

**Janela de 24h:** no WhatsApp Business, texto fora de modelo só é aceito até 24h após a última mensagem do participante. O compositor mostra se a janela está aberta. Na simulação o envio fora da janela é permitido, com aviso; na integração real ele seria recusado pela plataforma, e será preciso um modelo aprovado.

**Várias dúvidas na mesma mensagem:** quando o participante pergunta duas ou mais coisas com resposta aprovada ("Onde fica e preciso levar RG?"), a sugestão junta as respostas numa mensagem só: a saudação aparece uma vez, a resposta que fecha a conversa ("Qualquer dúvida…") vai por último e o texto continua sendo o dos modelos aprovados. A equipe confirma antes do envio.

## Automações

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

## Agendar visita (depois da ligação de pré-triagem)

Conversa sem visita mostra **Agendar visita**: tipo (Triagem, Inclusão…), nome conforme o protocolo, dia e horário. Com "Já combinado com o participante" (padrão), a visita entra **confirmada** e a "Confirmação de agendamento" sai automaticamente com a data; sem isso, fica aguardando confirmação ("Pedir confirmação" ou lembrete da véspera). Também encerra a pendência de ligação de pré-triagem, muda o candidato para "Agendado" (triagem) e cria a pendência de **registrar a visita no Polo Trial**. Não cria segunda visita se já houver uma ativa (use remarcar).

Ao escolher a data (aqui e em "Propor nova data"), aparece a **agenda do dia**: visitas já marcadas, aviso se o horário coincide com outra visita (em vermelho se for do mesmo responsável), horários livres do responsável (clique para usar) e link para a agenda completa.

## Remarcação com nova data

Quando a visita está com **remarcação solicitada** ou **falta**, o banner da conversa mostra **Propor nova data**:

1. A equipe escolhe dia e horário. A proposta precisa caber na janela informada pelo Polo Trial (fora dela é bloqueada).
2. O participante recebe o modelo aprovado "Proposta de nova data" (`{{nova_data}}`, `{{nova_hora}}`) e a conversa fica aguardando resposta. **A visita continua na data antiga**; a agenda mostra "Nova data proposta".
3. Se ele responde confirmando ("Confirmo"), a assistência aplica (ou deixa na fila, conforme a política): a visita **muda para a nova data já confirmada**, a "Confirmação de agendamento" sai com a nova data, a pendência de reagendamento é encerrada e fica uma pendência para **registrar a nova data no Polo Trial** (o Polo Chat não escreve no Polo Trial).
4. Se ele diz que não pode ("não consigo, pode ser outro dia?"), a proposta cai e a equipe propõe outra.
5. Combinado por telefone? **Confirmar nova data** no banner faz o mesmo que a confirmação do participante.

**Horário pedido pelo participante:** se a mensagem traz dia e hora exatos ("Não posso amanhã, pode ser sexta às 10h?"), a assistência confere o horário (pelo menos 1h à frente, dia útil, horário de visitas, janela do Polo Trial e agenda do responsável). Livre, a sugestão vira **Confirmar novo horário**: a equipe só confirma e a visita é remarcada. Trechos negados ("não posso amanhã") e mensagens com mais de uma opção não viram sugestão automática.

O "Reagendar" da Agenda continua disponível para mudar a data direto, sem consultar o participante.

## Assistência IA

A assistência classifica a mensagem por **regras** e dá uma **nota de confiança de 0 a 100**: detecta negação ("não confirmo" não é confirmação) e mensagens com mais de uma intenção (nunca automáticas). Ela fica atrás da interface `analyzeMessage`, e o que as regras não resolvem pode ir para um modelo de linguagem ([abaixo](#segunda-opinião-da-ia-claude)).

**Automático na regra, humano na exceção.** O que acontece com cada mensagem é decidido pela política do estudo ([`src/domain/assist-policy.ts`](../src/domain/assist-policy.ts)):

| Situação | Resultado |
| --- | --- |
| Estudo em modo automático para a intenção e confiança ≥ mínimo | Aplicada sozinha (`AUTOMATICA`) e entra na revisão por amostragem |
| Modo sugestão, confiança abaixo do mínimo, mais de uma intenção ou nada a aplicar | Fila de revisão (`PENDENTE`): a equipe aprova ou trata manualmente |
| Possível relato clínico | Sempre encaminhada à equipe médica (`ENCAMINHADA`), sem resposta |
| Não classificada | Sempre com a equipe |

O que a IA pode aplicar: confirmar visita (+ confirmação), responder dúvida frequente com resposta aprovada, registrar pedido de remarcação (+ pendência), registrar descadastro (revoga consentimento) e agendar a ligação de pré-triagem para quem demonstrou interesse.

**Ligação de pré-triagem (Interesse):** o horário vem do que o candidato escreveu ("amanhã de manhã" → 10h, "à tarde" → 15h, "depois das 14h" → 14h30, "na sexta às 9h"); sem preferência, é o próximo horário livre (~2h depois). Sempre em dia útil, entre 9h e 18h ([`src/domain/call-slot.ts`](../src/domain/call-slot.ts)). A pendência de ligação fica com esse horário e o candidato recebe o modelo "Ligação agendada" com o dia e a hora (`{{ligacao}}`). Esse modelo só é enviado pela automação. Se o candidato pedir outro horário ("não posso esse horário, pode ser a partir das 17?"), a sugestão de novo horário vai para a **equipe aprovar** (painel da conversa ou fila de revisão; dá para aprovar outro horário). Aprovada, a ligação é remarcada e o candidato recebe "Ligação agendada" automaticamente. Se ele só disser a hora, vale o mesmo dia da ligação original; se não sugerir horário, a automação pergunta o melhor com "Solicitação de contato". "Combinado" depois de "Ligação agendada" só registra a confirmação do horário. Quando alguém da equipe age direto na conversa, a sugestão sai da fila como "tratada". Toda mudança de política fica na auditoria.

Na demonstração, **todos os estudos vêm com as 5 intenções configuráveis em modo automático**: confirmação ≥ 85, dúvida frequente ≥ 85, remarcação ≥ 85, descadastro ≥ 90 e interesse ≥ 80 (a nota máxima que o classificador dá para interesse). O histórico da demo foi vivido com o piloto inicial (só AUTO-2026, com confirmação, dúvida e descadastro); a ampliação aparece na auditoria minutos antes da restauração, por isso sugestões antigas ainda estão na fila. O modo "Só sugerir" continua disponível por estudo e por intenção.

Limites que valem em qualquer modo:
- usa apenas **modelos aprovados pelo CEP**, nunca texto livre (texto livre é exclusivo da equipe);
- não decide elegibilidade, não interpreta eventos adversos e não dá orientação médica;
- o texto do participante é tratado como dado, nunca como instrução;
- não escreve no Polo Trial: a integração depende da documentação oficial da API.

## Segunda opinião da IA (Claude)

```
Mensagem ──▶ Regras (grátis, imediatas) ──▶ resolveu? ──▶ segue como hoje
                                │
                                └─ não (confiança baixa, "Não classificada", mais de uma intenção)
                                        ▼
                               IA interpreta (só rotula) ──▶ mesma política do estudo ──▶ aplica ou fila
```

- **Só o resíduo das regras vai para a IA** (`needsAiReview` em [`src/domain/assist-ai.ts`](../src/domain/assist-ai.ts)); relato clínico detectado pelas regras nunca passa por ela. Se a IA ler algo clínico que as regras não pegaram ("passando mal"), a mensagem é encaminhada à equipe médica.
- **A IA só rotula**: intenção, confiança, se é ambígua, tema da dúvida e dia/horário pedido. A ação continua sendo a do sistema, com modelos aprovados. Se ela não acrescentar nada ("não sei"), vale a leitura das regras.
- **Política**: o rótulo da IA passa pela política da intenção e, para aplicar sozinho, também pelo **modo da IA no estudo** (Desligada / Só sugerir / Automático) e pela **confiança mínima da IA** (padrão 80) — Configurações → Assistência IA. Pedido de novo horário de ligação continua exigindo aprovação da equipe.
- **Dados enviados**: só a mensagem, as últimas mensagens da conversa e o contexto (visita pendente, ligação agendada…), com o primeiro nome trocado por `[nome]`. O texto do participante é tratado como dado, nunca como instrução.
- **Modos** (`.env`): `ASSIST_AI_MODE=mock` (padrão, **simulada**: sem chamada externa e sem custo; estima os tokens de uma chamada real) ou `ASSIST_AI_MODE=live` (API da Anthropic, com a chave em `ANTHROPIC_API_KEY` no `.env.local`). Modelo: `ASSIST_AI_MODEL` (padrão `claude-opus-5-5`). No modo real: saída estruturada, esforço baixo, instruções fixas em cache e fallback automático do servidor quando o filtro de segurança recusa. Falha ou demora da IA não quebra nada: a mensagem fica na fila.
- **Consumo**: Configurações → **Consumo da IA** mostra mensagens analisadas, tokens (entrada, cache, saída), custo estimado pelo preço público, projeção para 30 dias, o que cada análise resolveu, custo por estudo e as últimas análises. O painel da conversa mostra os tokens e o custo de cada análise. **Restaurar os dados de demonstração não apaga o consumo**: o histórico acumula o gasto de todos os testes (cada registro guarda o estudo e o resultado da análise).
- **Antes de usar com dados reais**: medir o acerto numa base de respostas reais anonimizadas (começar em "Só sugerir") e fazer a avaliação de LGPD/contrato com o provedor (dados de saúde).
