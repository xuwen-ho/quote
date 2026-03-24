"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { AnalysisResult } from "@/lib/types";

const SAMPLES = [
  { name: "Studio Flat", rooms: "3 rooms", area: "45 m²" },
  { name: "2-Bed Apartment", rooms: "5 rooms", area: "82 m²" },
  { name: "Terraced House", rooms: "8 rooms", area: "140 m²" },
];

/* ── Tiny inline SVG floor-plan previews ── */
function MiniPlan({ variant }: { variant: number }) {
  if (variant === 0)
    return (
      <svg width="80" height="56" viewBox="0 0 80 56" fill="none">
        <rect x="4" y="4" width="72" height="48" stroke="#1C2B3A" strokeWidth="2.5" fill="#FAF8F4" />
        <line x1="28" y1="4" x2="28" y2="34" stroke="#1C2B3A" strokeWidth="2" />
        <line x1="4" y1="34" x2="28" y2="34" stroke="#1C2B3A" strokeWidth="2" />
        <rect x="8"  y="8"  width="14" height="10" rx="1.5" fill="white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.15))" }} />
        <rect x="33" y="8"  width="36" height="20" rx="1.5" fill="white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.15))" }} />
        <rect x="8"  y="38" width="62" height="12" rx="1.5" fill="white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.15))" }} />
      </svg>
    );
  if (variant === 1)
    return (
      <svg width="80" height="56" viewBox="0 0 80 56" fill="none">
        <rect x="4" y="4" width="72" height="48" stroke="#1C2B3A" strokeWidth="2.5" fill="#FAF8F4" />
        <line x1="40" y1="4"  x2="40" y2="56" stroke="#1C2B3A" strokeWidth="2" />
        <line x1="4" y1="28" x2="40" y2="28" stroke="#1C2B3A" strokeWidth="2" />
        <rect x="8"  y="8"  width="26" height="16" rx="1.5" fill="white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.15))" }} />
        <rect x="8"  y="30" width="26" height="18" rx="1.5" fill="white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.15))" }} />
        <rect x="44" y="8"  width="28" height="40" rx="1.5" fill="white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.15))" }} />
      </svg>
    );
  return (
    <svg width="80" height="56" viewBox="0 0 80 56" fill="none">
      <rect x="4" y="4" width="72" height="48" stroke="#1C2B3A" strokeWidth="2.5" fill="#FAF8F4" />
      <line x1="28" y1="4"  x2="28" y2="28" stroke="#1C2B3A" strokeWidth="2" />
      <line x1="52" y1="4"  x2="52" y2="28" stroke="#1C2B3A" strokeWidth="2" />
      <line x1="4"  y1="28" x2="76" y2="28" stroke="#1C2B3A" strokeWidth="2" />
      <rect x="7"  y="7"  width="18" height="18" rx="1" fill="white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.12))" }} />
      <rect x="31" y="7"  width="18" height="18" rx="1" fill="white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.12))" }} />
      <rect x="55" y="7"  width="18" height="18" rx="1" fill="white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.12))" }} />
      <rect x="7"  y="32" width="62" height="16" rx="1" fill="white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.12))" }} />
    </svg>
  );
}

type UploadState = "idle" | "uploading" | "analyzing" | "error";

export default function HomePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const processFile = useCallback(async (file: File) => {
    setUploadState("uploading");
    setErrorMsg("");

    try {
      // Step 1: Upload the file
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error ?? "Upload failed");
      }
      const { url: fileUrl } = await uploadRes.json();

      // Step 2: Analyze the floor plan
      setUploadState("analyzing");
      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl }),
      });
      if (!analyzeRes.ok) {
        const err = await analyzeRes.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error ?? "Analysis failed");
      }
      const analysis: AnalysisResult = await analyzeRes.json();

      // Store results in sessionStorage for the analyze page
      sessionStorage.setItem("qf_analysis", JSON.stringify({
        fileUrl,
        fileName: file.name,
        rooms: analysis.rooms,
        totalAreaSqft: analysis.totalAreaSqft,
        confidence: analysis.confidence,
      }));

      router.push("/analyze");
    } catch (err) {
      setUploadState("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  }, [router]);

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const isProcessing = uploadState === "uploading" || uploadState === "analyzing";

  const statusLabel =
    uploadState === "uploading" ? "Uploading floor plan…" :
    uploadState === "analyzing" ? "AI is analyzing rooms…" : "";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--cream)" }}>
      {/* Dot grid */}
      <div className="fixed inset-0 dot-grid pointer-events-none" style={{ opacity: 0.55 }} />

      {/* ── Header ── */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2.5">
          {/* Blueprint logo mark */}
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center"
            style={{ background: "var(--charcoal)" }}
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <rect x="1.5" y="1.5" width="12" height="12" rx="1" stroke="white" strokeWidth="1.25" />
              {[4, 7.5, 11].map((x) => (
                <line key={x} x1={x} y1="1.5" x2={x} y2="13.5" stroke="white" strokeWidth="0.6" strokeOpacity="0.45" />
              ))}
              {[4.5, 7.5, 10.5].map((y) => (
                <line key={y} x1="1.5" y1={y} x2="13.5" y2={y} stroke="white" strokeWidth="0.6" strokeOpacity="0.45" />
              ))}
            </svg>
          </div>
          <span className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--charcoal)" }}>
            QuoteFlow
          </span>
        </div>

        <nav className="flex items-center gap-5">
          <a href="#" className="text-sm font-medium" style={{ color: "var(--stone)" }}>
            How it works
          </a>
          <button
            className="px-4 py-2 rounded-full text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: "var(--charcoal)", color: "white" }}
          >
            Sign in
          </button>
        </nav>
      </header>

      {/* ── Hero ── */}
      <main className="relative z-10 flex-1 flex flex-col items-center px-6 pt-16 pb-20">
        {/* Tag */}
        <p
          className="text-xs font-semibold uppercase tracking-[0.18em] mb-5"
          style={{ color: "var(--sage-dark)" }}
        >
          For Interior Designers
        </p>

        {/* Headline */}
        <h1
          className="text-center text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] mb-5"
          style={{ color: "var(--charcoal)" }}
        >
          Instant renovation
          <br />
          <em className="not-italic" style={{ color: "var(--sage)" }}>quotes.</em>
        </h1>
        <p
          className="text-center text-lg leading-relaxed mb-12 max-w-md"
          style={{ color: "var(--stone)" }}
        >
          Drop a floor plan. Our AI maps every room and dimension, then produces a
          complete, client-ready quote in under 30 seconds.
        </p>

        {/* ── Drop zone ── */}
        <div className="w-full max-w-xl">
          <div
            onDragOver={isProcessing ? undefined : onDragOver}
            onDragLeave={isProcessing ? undefined : onDragLeave}
            onDrop={isProcessing ? undefined : onDrop}
            onClick={isProcessing ? undefined : () => inputRef.current?.click()}
            className="relative rounded-2xl border-2 border-dashed transition-all duration-200"
            style={{
              borderColor: isDragging ? "var(--sage)" : uploadState === "error" ? "#C86464" : "var(--cream-border)",
              background: isDragging
                ? "rgba(122,158,126,0.07)"
                : "rgba(255,255,255,0.65)",
              backdropFilter: "blur(10px)",
              padding: "56px 40px",
              cursor: isProcessing ? "default" : "pointer",
            }}
          >
            {isProcessing ? (
              <div className="flex flex-col items-center gap-4">
                <div
                  className="w-11 h-11 rounded-full border-2 border-t-transparent animate-spin-slow"
                  style={{ borderColor: "var(--sage)", borderTopColor: "transparent" }}
                />
                <p className="text-sm font-medium" style={{ color: "var(--charcoal)" }}>
                  {statusLabel}
                </p>
              </div>
            ) : uploadState === "error" ? (
              <div className="flex flex-col items-center gap-4">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(200,100,100,0.11)" }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ color: "#C86464" }}>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
                    <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-base font-semibold mb-1" style={{ color: "#C86464" }}>
                    {errorMsg}
                  </p>
                  <p className="text-sm" style={{ color: "var(--stone)" }}>
                    Click to try again
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-5">
                {/* Upload icon */}
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(122,158,126,0.11)" }}
                >
                  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" style={{ color: "var(--sage)" }}>
                    <path d="M13 17V9M13 9L9 13M13 9L17 13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M5 20.5C3.62 20.5 2.5 19.38 2.5 18V8C2.5 6.62 3.62 5.5 5 5.5H9.5L11.5 3.5H14.5L16.5 5.5H21C22.38 5.5 23.5 6.62 23.5 8V18C23.5 19.38 22.38 20.5 21 20.5H5Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>

                <div className="text-center">
                  <p className="text-lg font-semibold mb-1.5" style={{ color: "var(--charcoal)" }}>
                    {isDragging ? "Release to upload" : "Drag & Drop your Floor Plan"}
                  </p>
                  <p className="text-sm" style={{ color: "var(--stone)" }}>
                    PDF, PNG, or JPG · Max 10 MB
                  </p>
                </div>

                <div className="flex items-center gap-3 w-52">
                  <div className="flex-1 h-px" style={{ background: "var(--cream-border)" }} />
                  <span className="text-xs font-medium" style={{ color: "var(--stone)" }}>or</span>
                  <div className="flex-1 h-px" style={{ background: "var(--cream-border)" }} />
                </div>

                <button
                  className="px-6 py-2.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{ background: "var(--charcoal)", color: "white" }}
                >
                  Browse Files
                </button>
              </div>
            )}

            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              onChange={onFileInput}
            />
          </div>

          {/* Trust pills */}
          <div className="flex items-center justify-center gap-6 mt-5">
            {[
              { icon: "⚡", label: "Under 30 seconds" },
              { icon: "🔒", label: "No account needed" },
              { icon: "📄", label: "PDF export" },
            ].map((p) => (
              <span key={p.label} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--stone)" }}>
                {p.icon} {p.label}
              </span>
            ))}
          </div>
        </div>

        {/* ── Sample projects ── */}
        <div className="w-full max-w-xl mt-14">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-center mb-4"
            style={{ color: "var(--stone)" }}
          >
            Or try a sample
          </p>
          <div className="grid grid-cols-3 gap-3">
            {SAMPLES.map((s, i) => (
              <button
                key={s.name}
                onClick={() => {
                  // Clear any previous session data so analyze page uses its mock data
                  sessionStorage.removeItem("qf_analysis");
                  router.push("/analyze");
                }}
                className="text-left p-3.5 rounded-xl border transition-all hover:shadow-md"
                style={{
                  background: "rgba(255,255,255,0.72)",
                  borderColor: "var(--cream-border)",
                  backdropFilter: "blur(8px)",
                }}
              >
                <div
                  className="w-full rounded-lg mb-3 flex items-center justify-center"
                  style={{ background: "var(--cream-dark)", height: 72 }}
                >
                  <MiniPlan variant={i} />
                </div>
                <p className="text-sm font-semibold mb-0.5" style={{ color: "var(--charcoal)" }}>
                  {s.name}
                </p>
                <p className="text-xs" style={{ color: "var(--stone)" }}>
                  {s.rooms} · {s.area}
                </p>
              </button>
            ))}
          </div>
        </div>
      </main>

      <footer className="relative z-10 py-5 text-center text-xs" style={{ color: "var(--stone)" }}>
        QuoteFlow · Precision quoting for interior designers
      </footer>
    </div>
  );
}
