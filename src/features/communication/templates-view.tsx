import { FileCheck2 } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TEMPLATE_APPROVAL, TEMPLATE_CATEGORY } from "@/domain/labels";
import { TEMPLATE_VARIABLES } from "@/domain/templates";
import { formatDate } from "@/lib/dates";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

/** Destaca as variáveis {{...}} do texto aprovado. */
function Highlighted({ body }: { body: string }) {
  const parts = body.split(/(\{\{\w+\}\})/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\{\{\w+\}\}$/.test(part) ? (
          <span key={i} className="rounded bg-brand-100 px-1 font-mono text-[12px] text-brand-800" title={TEMPLATE_VARIABLES[part.slice(2, -2)]}>
            {part.slice(2, -2)}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export async function TemplatesView({ user, studyId }: { user: SessionUser; studyId?: string }) {
  const templates = await db.messageTemplate.findMany({
    where: studyId
      ? { OR: [{ studyId: null }, { studyId }] }
      : user.studyIds
        ? { OR: [{ studyId: null }, { studyId: { in: user.studyIds } }] }
        : {},
    include: { study: { select: { code: true } }, _count: { select: { communications: true } } },
    orderBy: [{ approvalStatus: "asc" }, { category: "asc" }, { name: "asc" }],
  });
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-[13px] text-ink-2">
        <FileCheck2 className="mt-0.5 size-4 shrink-0 text-brand-700" />
        <p>
          Mensagens a participantes usam apenas <strong className="font-medium text-ink">textos aprovados pelo CEP</strong>. O Polo Chat preenche somente variáveis operacionais (nome, data, horário, estudo). Modelos em revisão ou rascunho
          ficam visíveis, mas não podem ser enviados. Os pareceres exibidos são fictícios.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {templates.map((t) => (
          <Card key={t.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-ink">{t.name}</span>
              <StatusBadge map={TEMPLATE_APPROVAL} value={t.approvalStatus} />
              <Badge>{TEMPLATE_CATEGORY[t.category]}</Badge>
              <Badge tone={t.study ? "blue" : "neutral"}>{t.study ? t.study.code : "Institucional"}</Badge>
            </div>
            <p className="mt-3 rounded-lg bg-subtle p-3 text-[13px] leading-relaxed text-ink ring-1 ring-line">
              <Highlighted body={t.body} />
            </p>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
              <span>Versão {t.version}</span>
              <span>{t.cepReference ?? "Sem parecer"}</span>
              {t.approvedAt && <span>Aprovado em {formatDate(t.approvedAt)}</span>}
              <span>{t._count.communications} envios registrados</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
