import { ImageResponse } from "next/og";

export const alt = "RouteWise — find the LLM spend that never needed a frontier model";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0a0a0a", color: "#ededed", padding: 72 }}>
        <div style={{ fontSize: 34, fontWeight: 600 }}>RouteWise</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>Find the LLM spend that never needed a frontier model.</div>
          <div style={{ fontSize: 30, color: "#9aa1ad" }}>Prove it on your own traces before you change anything.</div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {[["Modeled", "#b68a1a"], ["Benchmarked", "#2f7f8f"], ["Replayed", "#2d7ff9"], ["Measured", "#2e9e5b"], ["Verified", "#1b8a3e"]].map(([label, color]) => (
            <div key={label} style={{ border: `2px solid ${color}`, color, borderRadius: 99, padding: "6px 18px", fontSize: 24, fontWeight: 600 }}>{label}</div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
