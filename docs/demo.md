# Roteiro de demonstração (~5 min)

[← Voltar ao README](../README.md)

**Antes de cada demonstração**, rode `npm run db:reset`, ou use *Configurações → Dados e privacidade → Restaurar dados de demonstração*. As datas são relativas ao dia em que o seed roda e contadas em dias úteis: nenhuma visita cai em sábado ou domingo, e restaurando numa sexta, as visitas "do próximo dia útil" ficam na segunda.

Use `npm run demo` para apresentar: é a versão de produção, e cada tela responde em ~30 ms. O `npm run dev` é só para quem vai alterar o código, porque recompila a cada mudança e cada tela leva de 0,2 a 0,5 s.

| # | Onde | O que mostrar |
| --- | --- | --- |
| 1 | **Dashboard** | Frase-resumo do dia (visitas, pendências abertas, visitas do próximo dia útil aguardando confirmação) e a lista **Atenção necessária**, consolidada de todas as fontes. |
| 2 | **Estudos → VAC-2026** | "368 de 500" recrutados, ritmo *abaixo do esperado*, evolução × plano. Contagens marcadas como dado do Polo Trial. |
| 3 | **Recrutamento** | Funil completo (base → incluídos), taxas, desempenho por canal e pipeline de candidatos. *Simular formulário recebido* mostra o fim do recadastro manual (Google Forms → sistema). |
| 4 | **Buscar "Larissa Mendonça"** | Ficha operacional: próxima ação "Confirmar a triagem", linha do tempo (formulário → pré-triagem → contato → resposta → visita agendada → lembrete automático). |
| 5 | **Abrir conversa** | "Visita às 09:00 do próximo dia útil — aguardando confirmação". Lembrete enviado pela automação com modelo aprovado pelo CEP. |
| 6 | **Simular resposta → "Confirmo"** | A Assistência IA classifica como *Confirmação de presença* (confiança 95, mínimo 85) e aplica sozinha: a visita vira **Confirmado** e a confirmação chega com a animação de "digitando…", sem clique da equipe. Para mostrar o humano na exceção, simule "ok" em outro participante: confiança 72, vai para a fila, e **Confirmar visita** aprova. |
| 7 | **Pendências** | "Aline Furtado não respondeu ao segundo contato": o 2º contato foi um follow-up automático e, sem resposta, virou pendência de ligação. Veja também Paulo Resende (falta → reagendamento) e o alerta de janela de Caio Medeiros vindo do Polo Trial. |
| 8 | **Relatórios** | Evolução da meta por estudo, recrutamento por canal, visitas realizadas × perdidas. *Exportar CSV* substitui o relatório montado à mão. |

## Extras para perguntas

- **Troca de perfil:** menu inferior da barra lateral. Por exemplo, *Financeiro* não vê Comunicação; *Assistente* vê só seus estudos.
- **Salvaguarda clínica:** simule a resposta "Estou com febre…". A assistência não sugere resposta e cria uma pendência de alta prioridade para a coordenação.
- **IA no modo automático:** todos os estudos vêm com as 5 intenções configuráveis no automático. Simule "Confirmo" em **Thiago Moreira** (visita do próximo dia útil às 10:30): visita **Confirmada** e confirmação enviada, sem clique da equipe. Para mostrar o modo sugestão, mude um estudo para "Só sugerir" em Configurações → *Assistência IA*.
- **Interesse → ligação agendada:** em um candidato sem visita (ex.: **Aline Furtado**), simule "Tenho interesse, pode me ligar amanhã de manhã". A IA cria a pendência de ligação para amanhã às 10:00 (ou o próximo dia útil, se amanhã for fim de semana) e envia "Ligação agendada" com o horário.
- **Cenários da semana:** Jéssica Amaral tem nova data proposta esperando resposta ("Confirmo" ou "não posso"); Felipe Rangel já tem ligação de pré-triagem marcada ("Combinado" ou "não posso nesse horário, pode ser às 17h?"); Gisele Prates está na 3ª remarcação (limite); Sérgio Albuquerque pediu "semana que vem", mas a janela acaba antes; Elaine Fontes, Rosana Freire, Natália Prado e Osvaldo Cardim têm visitas ao longo da semana para testar remarcação e conflitos de agenda.
- **Fila de revisão:** Comunicação → *Revisão da IA* mostra o que a IA deixou para a equipe (e por quê) e o que ela aplicou sozinha, com "A IA acertou?" para revisão por amostragem.
- **Política por estudo:** Configurações → *Assistência IA*: por intenção, "Só sugerir" ou "Automático" com confiança mínima; follow-up com número de tentativas, intervalo e horário de envio.
- **Automações:** *Executar ciclo* (Dashboard ou Configurações → Automações) envia os lembretes pendentes e o follow-up de Wagner Cordeiro (1/1). Rodando de novo depois de 24h sem resposta, vira pendência de ligação. Fora do horário de envio (padrão 07h–21h), nada sai.
