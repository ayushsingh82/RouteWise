import type { Metadata } from "next";
import Dashboard from "../dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Analyze a workflow or recorded LLM traffic and see what routing would save, with every number tagged by how well it's proven.",
};

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Dashboard />
    </div>
  );
}
