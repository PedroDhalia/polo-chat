"use client";

import type { TaskPriority } from "@prisma/client";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Spinner, useActionRunner } from "@/components/ui/toast";
import { TASK_PRIORITY } from "@/domain/labels";
import { createTaskAction } from "@/server/actions/tasks";

interface Options {
  studies: { id: string; code: string }[];
  users: { id: string; name: string }[];
  participants: { id: string; fullName: string; studyId: string }[];
}

const field = "h-9 w-full rounded-lg border-0 bg-surface px-2.5 text-[13px] ring-1 ring-line-strong ring-inset focus:ring-2 focus:ring-brand-400";

export function NewTaskButton({ options, defaultAssignee, defaultDate }: { options: Options; defaultAssignee: string; defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useActionRunner();
  const [form, setForm] = useState({ title: "", studyId: options.studies[0]?.id ?? "", participantId: "", priority: "MEDIA" as TaskPriority, dueDate: defaultDate, assigneeId: defaultAssignee, description: "" });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses("primary", "md")}>
        <Plus className="size-4" /> Nova pendência
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form
            className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-pop)]"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => createTaskAction({ ...form, participantId: form.participantId || undefined }), {
                onSuccess: () => {
                  setOpen(false);
                  setForm((f) => ({ ...f, title: "", description: "", participantId: "" }));
                },
              });
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">Nova pendência</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-ink-3 hover:text-ink" aria-label="Fechar">
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[12.5px] font-medium text-ink-2">O que precisa ser feito?</span>
                <input autoFocus required value={form.title} onChange={(e) => set("title", e.target.value)} className={field} placeholder="Ex.: Ligar para confirmar transporte" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Estudo</span>
                  <select value={form.studyId} onChange={(e) => setForm((f) => ({ ...f, studyId: e.target.value, participantId: "" }))} className={field}>
                    {options.studies.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Participante (opcional)</span>
                  <select value={form.participantId} onChange={(e) => set("participantId", e.target.value)} className={field}>
                    <option value="">—</option>
                    {options.participants
                      .filter((p) => p.studyId === form.studyId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.fullName}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Prioridade</span>
                  <select value={form.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)} className={field}>
                    {(Object.keys(TASK_PRIORITY) as TaskPriority[]).map((p) => (
                      <option key={p} value={p}>
                        {TASK_PRIORITY[p].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Prazo</span>
                  <input type="date" required value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} className={field} />
                </label>
                <label className="col-span-2 block">
                  <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Responsável</span>
                  <select value={form.assigneeId} onChange={(e) => set("assigneeId", e.target.value)} className={field}>
                    {options.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-[12.5px] font-medium text-ink-2">Detalhes (opcional)</span>
                <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} className={`${field} h-auto resize-none py-2`} />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className={buttonClasses("ghost", "md")}>
                Cancelar
              </button>
              <button type="submit" disabled={pending} className={buttonClasses("primary", "md")}>
                {pending && <Spinner />} Criar pendência
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
