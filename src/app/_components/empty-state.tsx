import type { ReactNode } from "react";

export function EmptyState({ title, children, icon = "∅" }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-black/15 px-6 py-8 text-center dark:border-white/15">
      <div aria-hidden className="text-2xl text-zinc-400">{icon}</div>
      <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{title}</div>
      {children && <div className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">{children}</div>}
    </div>
  );
}
