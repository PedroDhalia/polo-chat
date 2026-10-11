import type { ActorType, TimelineEventType } from "@prisma/client";
import { CalendarCheck, CalendarClock, CalendarX, CheckCheck, ClipboardCheck, ClipboardList, FileText, MessageCircle, Phone, ReceiptText, RefreshCw, Send, StickyNote, UserRoundSearch, UserRoundCheck } from "lucide-react";
import { formatDayMonth, formatTime } from "@/lib/dates";
import { cn } from "@/lib/cn";

const ICON: Record<TimelineEventType, { icon: React.ReactNode; cls: string }> = {
  FORM_RECEIVED: { icon: <FileText />, cls: "bg-teal-50 text-teal-700" },
  PRESCREENING_STARTED: { icon: <UserRoundSearch />, cls: "bg-violet-50 text-violet-700" },
  PRESCREENING_COMPLETED: { icon: <UserRoundCheck />, cls: "bg-violet-50 text-violet-700" },
  MESSAGE_SENT: { icon: <Send />, cls: "bg-brand-50 text-brand-700" },
  MESSAGE_RECEIVED: { icon: <MessageCircle />, cls: "bg-sky-50 text-sky-700" },
  CALL_LOGGED: { icon: <Phone />, cls: "bg-stone-100 text-ink-2" },
  VISIT_SCHEDULED: { icon: <CalendarClock />, cls: "bg-brand-50 text-brand-700" },
  VISIT_CONFIRMED: { icon: <CalendarCheck />, cls: "bg-brand-50 text-brand-700" },
  VISIT_RESCHEDULE_REQUESTED: { icon: <RefreshCw />, cls: "bg-violet-50 text-violet-700" },
  VISIT_COMPLETED: { icon: <CheckCheck />, cls: "bg-emerald-50 text-emerald-700" },
  VISIT_MISSED: { icon: <CalendarX />, cls: "bg-red-50 text-red-700" },
  STATUS_CHANGED: { icon: <RefreshCw />, cls: "bg-stone-100 text-ink-2" },
  TASK_CREATED: { icon: <ClipboardList />, cls: "bg-amber-50 text-amber-700" },
  TASK_COMPLETED: { icon: <ClipboardCheck />, cls: "bg-emerald-50 text-emerald-700" },
  REIMBURSEMENT_CREATED: { icon: <ReceiptText />, cls: "bg-stone-100 text-ink-2" },
  NOTE: { icon: <StickyNote />, cls: "bg-stone-100 text-ink-2" },
};

export interface TimelineItem {
  id: string;
  type: TimelineEventType;
  title: string;
  description: string | null;
  source: string | null;
  actorType: ActorType;
  actor: { name: string } | null;
  occurredAt: Date;
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative">
      {items.map((e, i) => {
        const meta = ICON[e.type];
        const who = e.actorType === "AUTOMATION" ? "Automação" : e.actorType === "INTEGRATION" ? "Integração" : e.actor?.name ?? null;
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < items.length - 1 && <span className="absolute top-8 bottom-0 left-[13px] w-px bg-line" />}
            <span className={cn("relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-surface [&_svg]:size-3.5", meta.cls)}>{meta.icon}</span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[12.5px] font-medium text-ink-3 tnum">
                  {formatDayMonth(e.occurredAt)} · {formatTime(e.occurredAt)}
                </span>
                <span className="text-[13.5px] font-medium text-ink">{e.title}</span>
              </div>
              {e.description && <p className="mt-0.5 text-[12.5px] text-ink-2">{e.description}</p>}
              {(e.source || who) && (
                <p className="mt-0.5 text-[11.5px] text-ink-3">
                  {[e.source, who && who !== e.source ? who : null].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
