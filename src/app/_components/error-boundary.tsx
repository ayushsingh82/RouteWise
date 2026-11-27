"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches render-time crashes in a subtree (e.g. an API response that passed
 * shape validation but carries an unexpected value) so one bad result shows a
 * recoverable message instead of blanking the whole dashboard. Route-level
 * failures are handled by app/error.tsx and app/global-error.tsx.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; onRetry?: () => void; label?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Dashboard render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-4 text-sm text-rose-700 dark:text-rose-400">
        <div className="font-medium">{this.props.label ?? "This section couldn't be displayed."}</div>
        <p className="mt-1 opacity-80">The data came back in a shape the dashboard didn&apos;t expect. Nothing was lost — try again, or pick a different source.</p>
        <button
          onClick={() => {
            this.setState({ error: null });
            this.props.onRetry?.();
          }}
          className="mt-3 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
        >
          Try again
        </button>
      </div>
    );
  }
}
