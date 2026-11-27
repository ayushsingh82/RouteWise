"use client";

/** Last-resort boundary for failures in the root layout itself. Renders its own <html>/<body>; global styles don't apply here. */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0a0a0a", color: "#ededed", display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <div role="alert" style={{ maxWidth: 420, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>RouteWise hit an unexpected error</h1>
          <p style={{ opacity: 0.7, fontSize: 14, margin: "0 0 20px" }}>Reloading usually fixes it. Nothing you analyzed was stored or lost.</p>
          <button onClick={() => retry()} style={{ background: "#ededed", color: "#0a0a0a", border: 0, borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
