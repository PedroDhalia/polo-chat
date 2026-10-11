import { STUDY_STATUS } from "@/domain/labels";
import { PACE_LABEL, recruitmentPace } from "@/domain/pace";
import { formatDate } from "@/lib/dates";
import { can, getCurrentUser } from "@/server/auth/session";
import { getChannelBreakdown } from "@/server/queries/recruitment";
import { recruitmentByStudy } from "@/server/queries/reports";
import { recordAudit } from "@/server/services/audit";

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Exporta o relatório de recrutamento em CSV (separador ";" para abrir direto no Excel em pt-BR). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!can(user, "reports.view")) return new Response("Acesso restrito", { status: 403 });
  const studyId = new URL(request.url).searchParams.get("estudo") ?? undefined;
  const [studies, channels] = await Promise.all([recruitmentByStudy(user, studyId), getChannelBreakdown(user, { studyId, weeks: 12 })]);

  const lines: (string | number)[][] = [
    ["Relatório de recrutamento — Plátano Ops (dados fictícios)"],
    ["Gerado em", formatDate(new Date())],
    [],
    ["Estudo", "Patrocinador", "Status", "Meta", "Incluídos", "Em triagem", "% da meta", "Previstos (plano)", "Situação"],
    ...studies.map((s) => {
      const pace = recruitmentPace(s);
      return [s.code, s.sponsor, STUDY_STATUS[s.status].label, s.targetEnrollment, s.enrolledCount, s.screeningCount, `${Math.round((s.enrolledCount / s.targetEnrollment) * 100)}%`, pace?.expected ?? "", pace ? PACE_LABEL[pace.status].label : "—"];
    }),
    [],
    ["Canal (últimas 12 semanas)", "Candidatos", "Contatados", "Responderam", "Incluídos", "Taxa de resposta", "Conversão"],
    ...channels.map((c) => [c.label, c.base, c.contacted, c.responded, c.included, `${Math.round(c.responseRate * 100)}%`, `${(c.conversion * 100).toFixed(1).replace(".", ",")}%`]),
  ];
  const csv = "﻿" + lines.map((l) => l.map(csvCell).join(";")).join("\r\n");
  await recordAudit({ actor: { type: "USER", user }, action: "report.exported", entityType: "Report", summary: "Relatório de recrutamento exportado (CSV)" });
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="recrutamento-platano-ops.csv"` },
  });
}
