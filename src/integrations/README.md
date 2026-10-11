# Camada de integrações

Ponto único entre o Plátano Ops e sistemas externos. Nenhuma tela, serviço ou automação
chama um sistema externo diretamente: tudo passa por `getIntegrations()`.

| Pasta         | Sistema                        | Estado no MVP |
| ------------- | ------------------------------ | ------------- |
| `polo-trial/` | Polo Trial                     | Simulado      |
| `whatsapp/`   | WhatsApp Business Platform     | Simulado      |
| `forms/`      | Google Forms / landing pages   | Simulado      |
| `finance/`    | Sistema financeiro (a definir) | Simulado      |

## Regras

1. **Os contratos (`types.ts`) descrevem o que o Plátano Ops precisa**, não a API do sistema
   externo. Nenhum endpoint do Polo Trial foi assumido. O adapter real fará o mapeamento
   quando houver documentação oficial.
2. **Polo Trial é a fonte** de dados clínicos e protocolares. Janelas de visita e contagens
   de triagem/inclusão são apenas espelhadas, nunca recalculadas.
3. **IDs externos** ficam na tabela `ExternalReference`, e não espalhados nas entidades.
4. Para adicionar um adapter real: implemente a interface em `<sistema>/live.ts`,
   registre-o em `index.ts` conforme `INTEGRATIONS_MODE` e mantenha o mock para testes.
