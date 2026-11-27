import Link from "next/link";
import { SAMPLE_DATASETS } from "@/lib/ingest/sample-data";
import { loadCalls } from "@/lib/ingest/load";
import { anonymizeCalls } from "@/lib/ingest/anonymize";
import { buildEvidenceReportFromCalls } from "@/lib/report/evidence";
import { TIER_COLOR, TIER_INFO, TIER_ORDER } from "@/lib/report/tiers";
import { badgeForReport } from "@/lib/report/badge";

// Rendered at build time from the bundled sample: the numbers on this page are computed, not typed in.
async function sampleHeadline() {
  const d = SAMPLE_DATASETS.find((s) => s.id === "langsmith-support-ops")!;
  const { calls } = loadCalls(d.raw());
  const report = await buildEvidenceReportFromCalls(anonymizeCalls(calls).calls, { title: "Support ops agent", generatedAt: "2026-01-01T00:00:00.000Z" });
  return { report, badge: badgeForReport(report), calls: calls.length };
}

const PROXY_SNIPPET = `# 1. Watch — forwards everything unchanged, records what routing WOULD save
npx routewise-proxy --ledger ledger.jsonl

# 2. Point your existing client at it (no code changes)
export OPENAI_BASE_URL=http://localhost:8787/v1
export ANTHROPIC_BASE_URL=http://localhost:8787

# 3. Enforce — only on tasks that passed shadow replay of your own traces
npx routewise-proxy --mode enforce --shadow-trace langsmith-export.json`;

const FORMATS = ["LangSmith", "OpenTelemetry / OpenInference", "Claude Code", "Codex", "OpenAI logs"];

export default async function Home() {
  const { report, badge, calls } = await sampleHeadline();
  const t = report.totals;
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5 sm:px-10">
        <span className="font-semibold tracking-tight">RouteWise</span>
        <nav className="flex items-center gap-5 text-sm text-zinc-600 dark:text-zinc-400">
          <a href="#how" className="hover:text-zinc-950 dark:hover:text-zinc-50">How it works</a>
          <a href="#evidence" className="hover:text-zinc-950 dark:hover:text-zinc-50">Evidence</a>
          <a href="#proxy" className="hover:text-zinc-950 dark:hover:text-zinc-50">Proxy</a>
          <Link href="/dashboard" className="rounded-full bg-zinc-950 px-4 py-1.5 font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Dashboard</Link>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-24 px-6 pb-24 pt-12 sm:px-10">
        <section className="flex flex-col items-start gap-6">
          <div className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-white/15 dark:text-zinc-400">
            Spend intelligence sparingly
          </div>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Find the LLM spend that never needed a frontier model — and prove it before you change anything.
          </h1>
          <p className="max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
            RouteWise breaks your agent traffic into tasks, decides which need judgment and which are a cache lookup or a cheap model, and replays that policy over your real traces first. Every saving comes tagged with how well it&apos;s proven.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard" className="rounded-full bg-zinc-950 px-6 py-2.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Analyze a sample trace</Link>
            <a href="#proxy" className="rounded-full border border-black/10 px-6 py-2.5 text-sm font-medium dark:border-white/15">Drop-in proxy</a>
          </div>

          <div className="mt-4 grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Sample spend today", `$${t.baselineUsd.toFixed(2)}`],
              ["Claimed savings", pct(t.savedPct)],
              ["Evidence-backed", pct(t.evidenceBackedShare)],
              ["A modeled-only guess", pct(t.modeledSavedPct)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/[.03]">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">{k}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Computed live from a bundled synthetic sample ({calls} calls, LangSmith format). Note the gap: replaying on real traffic found less than a naive estimate would have promised.
          </p>
        </section>

        <section id="how" className="flex flex-col gap-8">
          <h2 className="text-2xl font-semibold tracking-tight">Prove it first, then enforce</h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {[
              ["1 · Ingest", `Bring traces you already have: ${FORMATS.join(", ")}. Emails, keys, card numbers, phone numbers, IPs and home-directory names are anonymized before anything is analyzed.`],
              ["2 · Shadow", "The routing policy is replayed over your recorded calls in order, learning only from earlier traffic. Each cache hit or downgrade is checked against the answer your model actually gave."],
              ["3 · Enforce", "Flip the proxy from shadow to enforce. It only acts on tasks that passed shadow, serves cache hits locally, and sends bounded tasks to a cheaper tier."],
            ].map(([h, b]) => (
              <li key={h} className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[.03]">
                <h3 className="font-semibold">{h}</h3>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{b}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="evidence" className="flex flex-col gap-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">No unearned percentages</h2>
            <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
              A routing tool that quotes &ldquo;90% savings&rdquo; from arithmetic isn&apos;t telling you much. Every dollar here belongs to one of five evidence tiers, from weakest to strongest — and the headline number says which.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TIER_ORDER.map((k) => (
              <li key={k} className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/[.03]">
                <span className="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold" style={{ color: TIER_COLOR[k], borderColor: TIER_COLOR[k] }}>{TIER_INFO[k].label}</span>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{TIER_INFO[k].description}</p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/[.03]">
            <div dangerouslySetInnerHTML={{ __html: badge }} />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">A README badge that always states its tier next to the number. Shareable HTML and PDF reports come from the same data.</p>
          </div>
        </section>

        <section id="proxy" className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">A drop-in proxy, not another SDK</h2>
          <p className="max-w-2xl text-zinc-600 dark:text-zinc-400">
            An OpenAI- and Anthropic-compatible proxy with no runtime dependencies. Your keys pass straight through; the ledger it writes holds routing metadata only — never prompts or credentials.
          </p>
          <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-5 text-sm leading-relaxed text-zinc-100"><code>{PROXY_SNIPPET}</code></pre>
        </section>

        <section className="flex flex-col items-start gap-4 rounded-2xl border border-black/10 bg-white p-8 dark:border-white/10 dark:bg-white/[.03]">
          <h2 className="text-2xl font-semibold tracking-tight">See your own numbers</h2>
          <p className="max-w-xl text-zinc-600 dark:text-zinc-400">Drop in a trace export and get a per-task report you can share. Uploads are anonymized and never stored.</p>
          <Link href="/dashboard" className="rounded-full bg-zinc-950 px-6 py-2.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Open the dashboard</Link>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-6 py-8 text-xs text-zinc-500 sm:px-10 dark:text-zinc-400">
        MIT licensed · Prices in reports are illustrative defaults — substitute your contract rates before quoting dollars.
      </footer>
    </div>
  );
}
