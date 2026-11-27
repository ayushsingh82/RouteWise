import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-5xl font-semibold tabular-nums text-zinc-300 dark:text-zinc-700">404</div>
      <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Nothing here</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">That page doesn&apos;t exist. The dashboard is the place to start.</p>
      <div className="flex gap-3">
        <Link href="/dashboard" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900">Open dashboard</Link>
        <Link href="/" className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-white/15 dark:text-zinc-200">Home</Link>
      </div>
    </div>
  );
}
