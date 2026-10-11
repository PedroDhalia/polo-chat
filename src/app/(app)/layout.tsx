import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ToastProvider } from "@/components/ui/toast";
import { can, getCurrentUser } from "@/server/auth/session";
import { getShellData } from "@/server/queries/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const shell = await getShellData(user);
  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <Sidebar user={user} users={shell.users} counts={{ tasks: shell.myOpenTasks, inbox: shell.attentionConversations }} />
        <div className="min-w-0 flex-1 py-2 pr-2">
          <div className="flex min-h-[calc(100vh-16px)] flex-col rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
            <Topbar notifications={shell.notifications} unread={shell.unreadNotifications} canSearch={can(user, "participants.view")} />
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
