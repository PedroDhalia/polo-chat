import { CalendarDays, ChartColumn, FlaskConical, Funnel, LayoutDashboard, ListChecks, MessagesSquare, Settings, Users, Wallet } from "lucide-react";
import { roleCan, type Permission } from "@/domain/permissions";
import type { SessionUser } from "@/server/auth/session";
import { Logo } from "./logo";
import { SidebarLink } from "./sidebar-link";
import { UserSwitcher } from "./user-switcher";

const NAV: { label: string; href: string; icon: React.ReactNode; permission: Permission; badge?: "tasks" | "inbox" }[] = [
  { label: "Dashboard", href: "/", icon: <LayoutDashboard />, permission: "studies.view" },
  { label: "Estudos", href: "/estudos", icon: <FlaskConical />, permission: "studies.view" },
  { label: "Recrutamento", href: "/recrutamento", icon: <Funnel />, permission: "participants.view" },
  { label: "Participantes", href: "/participantes", icon: <Users />, permission: "participants.view" },
  { label: "Comunicação", href: "/comunicacao", icon: <MessagesSquare />, permission: "communication.view", badge: "inbox" },
  { label: "Agenda", href: "/agenda", icon: <CalendarDays />, permission: "agenda.view" },
  { label: "Pendências", href: "/pendencias", icon: <ListChecks />, permission: "tasks.view", badge: "tasks" },
  { label: "Financeiro", href: "/financeiro", icon: <Wallet />, permission: "finance.view" },
  { label: "Relatórios", href: "/relatorios", icon: <ChartColumn />, permission: "reports.view" },
  { label: "Configurações", href: "/configuracoes", icon: <Settings />, permission: "studies.view" },
];

export function Sidebar({
  user,
  users,
  counts,
}: {
  user: SessionUser;
  users: { id: string; name: string; role: SessionUser["role"]; jobTitle: string }[];
  counts: { tasks: number; inbox: number };
}) {
  return (
    <aside className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col px-3 py-4">
      <div className="px-2 pb-5">
        <Logo />
      </div>
      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV.filter((n) => roleCan(user.role, n.permission)).map((n) => (
          <SidebarLink key={n.href} href={n.href} icon={n.icon} badge={n.badge ? counts[n.badge] : undefined} badgeTone={n.badge === "inbox" ? "alert" : "default"}>
            {n.label}
          </SidebarLink>
        ))}
      </nav>
      <div className="mb-3 rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-[11.5px] leading-snug text-ink-3">
        <span className="font-medium text-ink-2">Ambiente de demonstração.</span> Todos os dados são fictícios. Integrações simuladas.
      </div>
      <UserSwitcher current={user} users={users} />
    </aside>
  );
}
