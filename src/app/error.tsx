"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-segment error boundary. Catches anything thrown while rendering a
 * page under the root layout; the layout itself is covered by global-error.tsx.
 * `retry()` re-fetches and re-renders the segment (reset() would only clear
 * the error state without re-running the server work).
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">Something went wrong</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        The page hit an unexpected error. Your data is untouched — trying again usually works.
        {error.digest ? <span className="mt-2 block font-mono text-xs opacity-70">ref: {error.digest}</span> : null}
      </p>
      <div className="flex gap-3">
        <button onClick={() => retry()} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900">
          Try again
        </button>
        <Link href="/" className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-white/15 dark:text-zinc-200">
          Home
        </Link>
      </div>
    </div>
  );
}
