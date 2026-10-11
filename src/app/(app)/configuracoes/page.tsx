import { ArrowRight, Check, Database, Gauge, FileCheck2, History, KeyRound, Lock, Minus, Play, Plug, RefreshCw, ShieldCheck, Sparkles, UserCog, Users, Workflow, FlaskConical } from "lucide-react";
import Link from "@/components/ui/link";
import { ActionButton } from "@/components/ui/action-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, Page, PageHeader } from "@/components/ui/misc";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { ROLE, STUDY_STATUS } from "@/domain/labels";
import { PERMISSION_GROUPS, PERMISSIONS, roleCan } from "@/domain/permissions";
import { TemplatesView } from "@/features/communication/templates-view";
import { AiUsageView } from "@/features/settings/ai-usage-view";
import { AssistSettingsEditor } from "@/features/settings/assist-settings";
import { AutomationToggle, ResetDemoButton } from "@/features/settings/settings-client";
import { INTEGRATION_CATALOG } from "@/integrations";
import { formatAgo, formatDate, formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { runAutomationCycleAction, syncPoloTrialAction } from "@/server/actions/admin";
import { can, getCurrentUser, type SessionUser } from "@/server/auth/session";
import { RULE_BY_KEY, type AutomationRuleKey } from "@/server/automations/rules";
import { AI_USAGE_PERIODS, getAiUsageReport } from "@/server/queries/ai-usage";
import { listAssistSettings, listAuditLogs, listAutomationRules, listStudiesConfig, listUsers, poloTrialSyncInfo } from "@/server/queries/settings";
import type { UserRole } from "@prisma/client";

export const metadata = { title: "Configurações" };

const SECTIONS = [
  { key: "usuarios", label: "Usuários", icon: <Users /> },
  { key: "estudos", label: "Estudos", icon: <FlaskConical /> },
  { key: "equipe", label: "Equipe", icon: <UserCog /> },
  { key: "modelos", label: "Modelos de mensagem", icon: <FileCheck2 /> },
  { key: "permissoes", label: "Permissões", icon: <KeyRound /> },
  { key: "automacoes", label: "Automações", icon: <Workflow /> },
  { key: "ia", label: "Assistência IA", icon: <Sparkles /> },
  { key: "ia-consumo", label: "Consumo da IA", icon: <Gauge /> },
  { key: "integracoes", label: "Integrações", icon: <Plug /> },
  { key: "auditoria", label: "Auditoria", icon: <History /> },
  { key: "dados", label: "Dados e privacidade", icon: <ShieldCheck /> },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

const ROLES: UserRole[] = ["DIRETOR", "COORDENADOR", "ASSISTENTE", "FINANCEIRO", "QUALIDADE"];

type SP = Promise<Record<string, string | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  const sp = await searchParams;
  const section: SectionKey = SECTIONS.some((s) => s.key === sp.secao) ? (sp.secao as SectionKey) : "usuarios";

  return (
    <Page>
      <PageHeader title="Configurações" description="Usuários, estudos, permissões, automações e integrações. Alterações administrativas exigem o perfil adequado." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="flex flex-col gap-0.5 lg:sticky lg:top-4 lg:self-start">
          {SECTIONS.map((s) => (
            <Link
              key={s.key}
              href={`/configuracoes?secao=${s.key}`}
              scroll={false}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13.5px] font-medium [&_svg]:size-4",
                section === s.key ? "bg-brand-50 text-brand-800" : "text-ink-2 hover:bg-stone-100 hover:text-ink",
              )}
            >
              <span className={section === s.key ? "text-brand-600" : "text-ink-3"}>{s.icon}</span>
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">
          {section === "usuarios" && <UsersSection />}
          {section === "estudos" && <StudiesSection />}
          {section === "equipe" && <TeamSection />}
          {section === "modelos" && <TemplatesView user={user} />}
          {section === "permissoes" && <PermissionsSection user={user} />}
          {section === "automacoes" && <AutomationsSection user={user} />}
          {section === "ia" && <AssistSection user={user} />}
          {section === "ia-consumo" && <AiUsageSection user={user} period={sp.periodo} />}
          {section === "integracoes" && <IntegrationsSection />}
          {section === "auditoria" && <AuditSection user={user} />}
          {section === "dados" && <DataSection user={user} />}
        </div>
      </div>
    </Page>
  );
}

async function UsersSection() {
  const users = await listUsers();
  const now = new Date();
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Usuários" description="Perfis fictícios da demonstração. No produto real: autenticação com SSO/senha e MFA." />
      <Table className="border-t border-line">
        <THead>
          <Th>Usuário</Th>
          <Th>Função</Th>
          <Th>Estudos</Th>
          <Th>Último acesso</Th>
          <Th>Status</Th>
        </THead>
        <tbody>
          {users.map((u) => (
            <Tr key={u.id}>
              <Td>
                <div className="flex items-center gap-2.5">
                  <Avatar name={u.name} />
                  <div>
                    <div className="font-medium text-ink">{u.name}</div>
                    <div className="text-[12px] text-ink-3">{u.email}</div>
                  </div>
                </div>
              </Td>
              <Td>
                <div className="font-medium text-ink">{ROLE[u.role].label}</div>
                <div className="text-[12px] text-ink-3">{u.jobTitle}</div>
              </Td>
              <Td className="text-ink-2">{["DIRETOR", "FINANCEIRO", "QUALIDADE"].includes(u.role) ? <Badge>Todos os estudos</Badge> : u.memberships.map((m) => m.study.code).join(", ")}</Td>
              <Td className="whitespace-nowrap text-ink-2">{u.lastLoginAt ? formatAgo(u.lastLoginAt, now) : "—"}</Td>
              <Td>
                <Badge tone="green" dot>
                  Ativo
                </Badge>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

async function StudiesSection() {
  const studies = await listStudiesConfig();
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Estudos" description="Cadastro operacional e vínculo com o Polo Trial (fonte dos dados protocolares)." />
      <Table className="border-t border-line">
        <THead>
          <Th>Estudo</Th>
          <Th>Status</Th>
          <Th className="text-right">Meta</Th>
          <Th>Recrutamento</Th>
          <Th>Responsável</Th>
          <Th>Polo Trial</Th>
        </THead>
        <tbody>
          {studies.map((s) => (
            <Tr key={s.id}>
              <Td>
                <Link href={`/estudos/${s.code}`} className="font-medium text-ink hover:text-brand-700">
                  {s.code}
                </Link>
                <div className="text-[12px] text-ink-3">{s.sponsor}</div>
              </Td>
              <Td>
                <StatusBadge map={STUDY_STATUS} value={s.status} />
              </Td>
              <Td className="text-right text-ink tnum">{s.targetEnrollment}</Td>
              <Td className="whitespace-nowrap text-ink-2 tnum">
                {formatDate(s.startDate)} → {s.recruitmentEndDate ? formatDate(s.recruitmentEndDate) : "—"}
              </Td>
              <Td className="whitespace-nowrap text-ink-2">{s.owner.name}</Td>
              <Td>
                <span className="inline-flex items-center gap-1 text-[12.5px] text-ink-2">
                  <Database className="size-3 text-sky-600" /> {s.externalId ?? "—"}
                </span>
                <div className="text-[11.5px] text-ink-3">{s.sourceSyncedAt ? `sincronizado ${formatAgo(s.sourceSyncedAt)}` : "não sincronizado"}</div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

async function TeamSection() {
  const [studies, users] = await Promise.all([listStudiesConfig(), listUsers()]);
  const members = users.filter((u) => !["DIRETOR", "FINANCEIRO", "QUALIDADE"].includes(u.role) || u.memberships.length > 0);
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Equipe por estudo" description="O vínculo define quais estudos cada pessoa enxerga. Financeiro e Qualidade têm acesso transversal por função." />
      <Table className="border-t border-line">
        <THead>
          <Th>Pessoa</Th>
          {studies.map((s) => (
            <Th key={s.id}>{s.code}</Th>
          ))}
        </THead>
        <tbody>
          {members.map((u) => (
            <Tr key={u.id}>
              <Td>
                <div className="flex items-center gap-2">
                  <Avatar name={u.name} size="xs" />
                  <span className="font-medium whitespace-nowrap text-ink">{u.name}</span>
                </div>
              </Td>
              {studies.map((s) => {
                const m = s.members.find((x) => x.user.id === u.id);
                return <Td key={s.id}>{m ? <span className="text-[12.5px] whitespace-nowrap text-ink-2">{m.studyRole}</span> : <Minus className="size-3.5 text-stone-300" />}</Td>;
              })}
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function PermissionsSection({ user }: { user: SessionUser }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Permissões por função" description={`Controle de acesso baseado em função (RBAC). Sua função atual — ${ROLE[user.role].label} — está destacada. Use o menu inferior da barra lateral para ver o sistema como outro perfil.`} />
      <Table className="border-t border-line">
        <THead>
          <Th>Permissão</Th>
          {ROLES.map((r) => (
            <Th key={r} className={cn("text-center", r === user.role && "bg-brand-50 text-brand-800")}>
              {ROLE[r].label}
            </Th>
          ))}
        </THead>
        <tbody>
          {PERMISSION_GROUPS.map((g) => (
            <PermissionGroup key={g.label} label={g.label} permissions={g.permissions} current={user.role} />
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function PermissionGroup({ label, permissions, current }: { label: string; permissions: (typeof PERMISSION_GROUPS)[number]["permissions"]; current: UserRole }) {
  return (
    <>
      <tr className="border-b border-line bg-subtle">
        <td colSpan={6} className="px-4 py-1.5 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">
          {label}
        </td>
      </tr>
      {permissions.map((p) => (
        <Tr key={p}>
          <Td className="text-ink">
            {PERMISSIONS[p]}
            {p === "participants.contact" && <span className="ml-1.5 text-[11.5px] text-ink-3">(telefone completo, auditado)</span>}
          </Td>
          {ROLES.map((r) => (
            <Td key={r} className={cn("text-center", r === current && "bg-brand-50/50")}>
              {roleCan(r, p) ? <Check className="mx-auto size-4 text-brand-600" /> : <Minus className="mx-auto size-3.5 text-stone-300" />}
            </Td>
          ))}
        </Tr>
      ))}
    </>
  );
}

async function AutomationsSection({ user }: { user: SessionUser }) {
  const { rules, runs } = await listAutomationRules();
  const canManage = can(user, "automations.manage");
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Regras de automação"
          description="Evento → Regra → Ação. Executadas com dados fictícios; mensagens usam somente modelos aprovados e nunca respondem conteúdo clínico."
          action={<ActionButton action={runAutomationCycleAction} icon={<Play className="size-3.5" />}>Executar ciclo agora</ActionButton>}
        />
        <ul className="divide-y divide-line border-t border-line">
          {rules.map((r) => {
            const def = RULE_BY_KEY[r.key as AutomationRuleKey];
            return (
              <li key={r.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-ink">{r.name}</span>
                    <Badge tone={def?.kind === "scheduled" ? "blue" : "violet"}>{def?.kind === "scheduled" ? "Agendada" : "Por evento"}</Badge>
                    <span className="text-[12px] text-ink-3">{r.runs7d} execuções em 7 dias</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
                    <span className="rounded-md bg-stone-100 px-2 py-0.5 text-ink-2">
                      <span className="text-ink-3">Evento:</span> {r.trigger}
                    </span>
                    <ArrowRight className="size-3 text-ink-3" />
                    <span className="rounded-md bg-stone-100 px-2 py-0.5 text-ink-2">
                      <span className="text-ink-3">Regra:</span> {r.condition}
                    </span>
                    <ArrowRight className="size-3 text-ink-3" />
                    <span className="rounded-md bg-violet-50 px-2 py-0.5 text-violet-800">
                      <span className="text-violet-500">Ação:</span> {r.action}
                    </span>
                  </div>
                </div>
                <AutomationToggle ruleId={r.id} enabled={r.enabled} disabled={!canManage} />
              </li>
            );
          })}
        </ul>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Histórico de execuções" description="Resultado de cada execução, inclusive as ignoradas por salvaguarda." />
        <Table className="border-t border-line">
          <THead>
            <Th>Quando</Th>
            <Th>Regra</Th>
            <Th>Resultado</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {runs.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap text-ink-2 tnum">{formatDateTime(r.createdAt)}</Td>
                <Td className="whitespace-nowrap font-medium text-ink">{r.rule.name}</Td>
                <Td className="text-ink-2">{r.summary}</Td>
                <Td>
                  <Badge tone={r.status === "SUCESSO" ? "green" : r.status === "IGNORADA" ? "amber" : "red"}>{r.status === "SUCESSO" ? "Sucesso" : r.status === "IGNORADA" ? "Ignorada" : "Falha"}</Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

async function IntegrationsSection() {
  const info = await poloTrialSyncInfo();
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-[13px] text-ink-2">
        <strong className="font-medium text-ink">Camada de integrações preparada, nenhuma integração real ativa.</strong> Cada sistema tem um contrato interno e um adapter simulado (pasta <code className="rounded bg-white px-1 text-[12px]">src/integrations</code>). Nenhum endpoint
        do Polo Trial foi assumido: o adapter real depende da documentação oficial.
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {INTEGRATION_CATALOG.map((i) => (
          <Card key={i.system} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[14.5px] font-semibold text-ink">{i.name}</div>
                <p className="mt-0.5 text-[13px] text-ink-2">{i.purpose}</p>
              </div>
              <Badge tone="amber" dot>
                Simulado
              </Badge>
            </div>
            <div className="mt-3 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">Antes da integração real</div>
            <ul className="mt-1.5 space-y-1 text-[12.5px] text-ink-2">
              {i.prerequisites.map((p) => (
                <li key={p} className="flex gap-1.5">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-3" />
                  {p}
                </li>
              ))}
            </ul>
            {i.system === "POLO_TRIAL" && (
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                <span className="text-[12px] text-ink-3">
                  {info.refs.POLO_TRIAL ?? 0} vínculos de ID · {info.lastSync ? `última sincronização ${formatAgo(info.lastSync)}` : "nunca sincronizado"}
                </span>
                <ActionButton action={syncPoloTrialAction} size="xs" icon={<RefreshCw className="size-3" />}>
                  Testar sincronização
                </ActionButton>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

async function AuditSection({ user }: { user: SessionUser }) {
  if (!can(user, "audit.view")) {
    return (
      <Card className="p-8 text-center">
        <Lock className="mx-auto mb-2 size-5 text-ink-3" />
        <p className="font-medium">Trilha de auditoria restrita</p>
        <p className="mt-1 text-[13px] text-ink-3">Disponível para os perfis Diretor e Qualidade. Troque de perfil no menu inferior da barra lateral para visualizar.</p>
      </Card>
    );
  }
  const logs = await listAuditLogs(user);
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Auditoria" description="Quem fez o quê, quando e em qual registro — inclusive ações de automações e integrações." />
      <Table className="border-t border-line">
        <THead>
          <Th>Quando</Th>
          <Th>Autor</Th>
          <Th>Ação</Th>
          <Th>Descrição</Th>
          <Th>Estudo</Th>
        </THead>
        <tbody>
          {logs.map((l) => (
            <Tr key={l.id}>
              <Td className="whitespace-nowrap text-ink-2 tnum">{formatDateTime(l.createdAt)}</Td>
              <Td className="whitespace-nowrap">
                <span className={cn("text-[12.5px]", l.actorType === "USER" ? "font-medium text-ink" : l.actorType === "AUTOMATION" ? "text-violet-700" : "text-sky-700")}>{l.actorLabel}</span>
              </Td>
              <Td>
                <code className="rounded bg-stone-100 px-1.5 py-0.5 text-[11.5px] whitespace-nowrap text-ink-2">{l.action}</code>
              </Td>
              <Td className="text-ink-2">{l.summary}</Td>
              <Td className="text-ink-3">{l.study?.code ?? "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function DataSection({ user }: { user: SessionUser }) {
  const items = [
    { title: "Dados fictícios", text: "Nenhum dado real de participante é usado. Nomes são combinações aleatórias e telefones usam um prefixo fictício." },
    { title: "Acesso por função e por estudo", text: "Cada perfil vê apenas o que sua função permite, e somente os estudos aos quais está vinculado." },
    { title: "Minimização de exposição", text: "Telefones ficam mascarados; exibir o número completo exige permissão e gera registro de auditoria. E-mail não é armazenado." },
    { title: "Consentimento", text: "Cada participante tem registros de consentimento por finalidade (WhatsApp, telefone), com origem, data, revogação e prazo de retenção. Envios sem consentimento são bloqueados." },
    { title: "Rastreabilidade", text: "Ações de pessoas, automações e integrações ficam na trilha de auditoria; a linha do tempo registra o histórico operacional de cada participante." },
    { title: "Fora do escopo do MVP", text: "Política de retenção automatizada, anonimização, atendimento a direitos do titular, criptografia em repouso e avaliação jurídica. O MVP não declara conformidade com a LGPD." },
  ];
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Preparação para privacidade e LGPD" description="O que a arquitetura do MVP já considera — e o que ainda depende de fases futuras." />
        <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((i) => (
            <div key={i.title} className="rounded-lg border border-line p-3.5">
              <div className="text-[13.5px] font-semibold text-ink">{i.title}</div>
              <p className="mt-1 text-[12.5px] text-ink-2">{i.text}</p>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Dados de demonstração" description="Restaura o estado inicial da demo: participantes, conversas, agenda e pendências fictícios, com datas relativas a hoje. O consumo da IA é mantido." />
        <CardBody>
          {can(user, "settings.manage") ? <ResetDemoButton /> : <p className="text-[13px] text-ink-3">Disponível para Diretor e Coordenador.</p>}
        </CardBody>
      </Card>
    </div>
  );
}

async function AiUsageSection({ user, period }: { user: SessionUser; period?: string }) {
  if (!can(user, "audit.view") && !can(user, "automations.manage")) {
    return (
      <Card className="p-8 text-center">
        <Lock className="mx-auto mb-2 size-5 text-ink-3" />
        <p className="font-medium">Consumo da IA restrito</p>
        <p className="mt-1 text-[13px] text-ink-3">Disponível para Diretor, Coordenação e Qualidade.</p>
      </Card>
    );
  }
  const days = AI_USAGE_PERIODS.find((d) => String(d) === period) ?? 30;
  return <AiUsageView report={await getAiUsageReport(user, days)} />;
}

async function AssistSection({ user }: { user: SessionUser }) {
  const studies = await listAssistSettings(user);
  const canManage = can(user, "automations.manage");
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 text-[13px] text-ink-2">
        <strong className="font-medium text-ink">Automático na regra, humano na exceção.</strong> Para cada estudo e intenção, a assistência pode só sugerir ou aplicar sozinha
        quando a confiança atinge o mínimo. Mensagens ambíguas, abaixo do mínimo ou em modo sugestão vão para a{" "}
        <Link href="/comunicacao?aba=revisao" className="font-medium text-brand-700 hover:underline">
          fila de revisão
        </Link>
        . Relato clínico nunca é automático. A chave geral fica em Automações → “Assistência IA (aplicação automática)”.
        {!canManage && <span className="mt-1 block text-ink-3">Seu perfil pode consultar, mas só Diretor e Coordenação alteram.</span>}
      </div>
      <AssistSettingsEditor studies={studies} canManage={canManage} />
    </div>
  );
}
