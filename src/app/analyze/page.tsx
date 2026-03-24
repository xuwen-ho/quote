"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { DetectedRoom, GenerateQuoteResponse } from "@/lib/types";

/* ── Mock fallback rooms (used when no session data / sample plan) ── */
const MOCK_ROOMS: DetectedRoom[] = [
  { type: "bedroom",    name: "Master Bedroom", areaSqft: 198, dimensions: { width: 14, length: 14.1, unit: "ft" } },
  { type: "bathroom",  name: "Bathroom",        areaSqft: 56,  dimensions: { width: 7,  length: 8,   unit: "ft" } },
  { type: "living_room", name: "Living Room",   areaSqft: 238, dimensions: { width: 14, length: 17,  unit: "ft" } },
];

const ROOM_TYPES = [
  "Bedroom", "Master Bedroom", "Bathroom", "Living Room",
  "Kitchen", "Dining Room", "Study", "Storage", "Hallway",
];

/* Room type → normalized key matching DetectedRoom.type */
function normalizeType(display: string): string {
  return display.toLowerCase().replace(/\s+/g, "_");
}

const TYPE_COLOUR: Record<string, { stroke: string; fill: string; label: string }> = {
  master_bedroom: { stroke: "#7A9E7E", fill: "rgba(122,158,126,0.22)", label: "#5E7D62" },
  bedroom:        { stroke: "#7A9E7E", fill: "rgba(122,158,126,0.22)", label: "#5E7D62" },
  bathroom:       { stroke: "#6488C8", fill: "rgba(100,136,200,0.22)", label: "#4A68A4" },
  living_room:    { stroke: "#C8A064", fill: "rgba(200,160,100,0.22)", label: "#A07840" },
  kitchen:        { stroke: "#C86464", fill: "rgba(200,100,100,0.22)", label: "#A04040" },
  dining_room:    { stroke: "#B47AB4", fill: "rgba(180,120,180,0.22)", label: "#8A5A8A" },
  study:          { stroke: "#64B4B4", fill: "rgba(100,180,180,0.22)", label: "#408A8A" },
  storage:        { stroke: "#A0A0A0", fill: "rgba(160,160,160,0.22)", label: "#707070" },
  hallway:        { stroke: "#B4A064", fill: "rgba(180,160,100,0.22)", label: "#907840" },
};

function roomColor(type: string) {
  return TYPE_COLOUR[type.toLowerCase()] ?? { stroke: "#888", fill: "rgba(136,136,136,0.18)", label: "#666" };
}

/* SVG layout positions for up to 6 rooms */
const SVG_POSITIONS = [
  { x: 52, y: 8,  w: 44, h: 38 },
  { x: 8,  y: 8,  w: 38, h: 38 },
  { x: 8,  y: 52, w: 88, h: 40 },
  { x: 8,  y: 52, w: 42, h: 40 },
  { x: 52, y: 52, w: 44, h: 40 },
  { x: 52, y: 8,  w: 20, h: 38 },
];

interface RoomRow {
  id: string;
  name: string;
  type: string;   // normalized
  displayType: string;  // pretty label
  areaSqft: number;
  areaSqm: number;
  svgX: number; svgY: number; svgW: number; svgH: number;
}

function toRows(rooms: DetectedRoom[]): RoomRow[] {
  return rooms.slice(0, 6).map((r, i) => {
    const pos = SVG_POSITIONS[i] ?? SVG_POSITIONS[0];
    const areaSqm = r.dimensions.unit === "ft"
      ? Number((r.areaSqft * 0.0929).toFixed(1))
      : Number(r.areaSqft.toFixed(1));
    // Determine pretty display type from name field
    const displayType = r.name;
    return {
      id: String(i + 1),
      name: r.name,
      type: r.type.toLowerCase(),
      displayType,
      areaSqft: r.areaSqft,
      areaSqm,
      svgX: pos.x, svgY: pos.y, svgW: pos.w, svgH: pos.h,
    };
  });
}

export default function AnalyzePage() {
  const router = useRouter();
  const [rows, setRows] = useState<RoomRow[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [generating, setGenerating] = useState(false);

  /* Load from sessionStorage on mount */
  useEffect(() => {
    let initialRooms = MOCK_ROOMS;
    try {
      const stored = sessionStorage.getItem("qf_analysis");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.rooms) && parsed.rooms.length > 0) {
          initialRooms = parsed.rooms;
        }
        if (parsed.fileUrl) setFileUrl(parsed.fileUrl);
      }
    } catch {
      // fall back to mock
    }
    setRows(toRows(initialRooms));
  }, []);

  /* Staggered box reveal */
  useEffect(() => {
    if (rows.length === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    rows.forEach((r, i) =>
      timers.push(setTimeout(() => setVisible((v) => [...v, r.id]), 700 + i * 550))
    );
    return () => timers.forEach(clearTimeout);
  }, [rows]);

  const totalSqm = rows.reduce((s, r) => s + r.areaSqm, 0).toFixed(1);

  const handleTypeChange = (id: string, newDisplay: string) => {
    setRows((prev) => prev.map((r) =>
      r.id === id
        ? { ...r, displayType: newDisplay, type: normalizeType(newDisplay) }
        : r
    ));
  };

  const handleConfirm = async () => {
    setConfirmed(true);
    setGenerating(true);

    try {
      // Build DetectedRoom array from current row state
      const rooms: DetectedRoom[] = rows.map((r) => ({
        type: r.type,
        name: r.displayType,
        areaSqft: r.areaSqft,
        dimensions: { width: Math.sqrt(r.areaSqft), length: Math.sqrt(r.areaSqft), unit: "ft" },
      }));

      const res = await fetch("/api/quotes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rooms, margin: 0.10 }),
      });

      if (!res.ok) throw new Error("Quote generation failed");

      const data: GenerateQuoteResponse = await res.json();

      sessionStorage.setItem("qf_quote", JSON.stringify({
        summary: data.summary,
        quoteId: data.quoteId ?? null,
        margin: 10,
        rooms,
      }));

      router.push("/quote");
    } catch {
      setConfirmed(false);
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--cream)" }}>
      <div className="fixed inset-0 dot-grid pointer-events-none" style={{ opacity: 0.5 }} />

      {/* ── Header ── */}
      <header
        className="relative z-10 flex items-center gap-3 px-6 py-4 border-b"
        style={{
          borderColor: "var(--cream-border)",
          background: "rgba(245,240,232,0.9)",
          backdropFilter: "blur(12px)",
        }}
      >
        <button
          onClick={() => router.push("/")}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-black/5"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M11 14L6 9L11 4" stroke="var(--charcoal)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex-1">
          <p className="text-[11px] font-medium" style={{ color: "var(--stone)" }}>AI Analysis</p>
          <p className="text-sm font-semibold" style={{ color: "var(--charcoal)" }}>
            {fileUrl ? fileUrl.split("/").pop() : "Sample Floor Plan"}
          </p>
        </div>

        {/* Scanning badge */}
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: "rgba(122,158,126,0.12)", color: "var(--sage-dark)" }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: "var(--sage)",
              animation: visible.length < rows.length ? "pulse-dot 1s ease infinite" : "none",
            }}
          />
          {visible.length < rows.length ? "Scanning rooms…" : "Analysis complete"}
        </div>
      </header>

      {/* ── Body ── */}
      <main className="relative z-10 flex-1 flex flex-col lg:flex-row gap-6 p-6 max-w-6xl w-full mx-auto">

        {/* Left — floor plan / image */}
        <div className="flex-1 min-w-0">
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "#FAF8F4",
              boxShadow: "var(--shadow-md)",
              aspectRatio: "4/3",
              position: "relative",
            }}
          >
            {fileUrl && (fileUrl.endsWith(".png") || fileUrl.endsWith(".jpg") || fileUrl.endsWith(".jpeg")) ? (
              /* Show actual uploaded image */
              <div className="relative w-full h-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl}
                  alt="Floor plan"
                  className="w-full h-full object-contain"
                  style={{ background: "#FAF8F4" }}
                />
                {/* Animated room labels overlay */}
                <div className="absolute inset-0 flex flex-col items-end justify-start p-4 gap-2 pointer-events-none">
                  {rows.map((r) =>
                    visible.includes(r.id) ? (
                      <div
                        key={r.id}
                        className="animate-fade-up flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={{ background: roomColor(r.type).stroke, color: "white", opacity: 0.9 }}
                      >
                        <span>{r.displayType}</span>
                        <span style={{ opacity: 0.75 }}>{r.areaSqm} m²</span>
                      </div>
                    ) : null
                  )}
                </div>
              </div>
            ) : (
              /* Static SVG visualization */
              <svg viewBox="0 0 100 95" className="w-full h-full">
                <defs>
                  <pattern id="dots" x="0" y="0" width="5" height="5" patternUnits="userSpaceOnUse">
                    <circle cx="0.5" cy="0.5" r="0.3" fill="#C5B99A" opacity="0.55" />
                  </pattern>
                </defs>
                <rect width="100" height="95" fill="url(#dots)" />

                {/* Room colour fills */}
                {rows.map((r) =>
                  visible.includes(r.id) ? (
                    <rect
                      key={`fill-${r.id}`}
                      x={r.svgX} y={r.svgY} width={r.svgW} height={r.svgH}
                      fill={roomColor(r.type).fill}
                      rx="0.5"
                      className="animate-box-appear"
                    />
                  ) : null
                )}

                {/* Walls */}
                <rect x="8" y="8" width="84" height="84" fill="none" stroke="#1C2B3A" strokeWidth="2.5" />
                <line x1="46" y1="8"  x2="46" y2="46" stroke="#1C2B3A" strokeWidth="2" />
                <line x1="8" y1="46" x2="92" y2="46" stroke="#1C2B3A" strokeWidth="2" />
                {/* Doors */}
                <line x1="38" y1="38" x2="38" y2="30" stroke="#1C2B3A" strokeWidth="0.8" opacity="0.5" />
                <path d="M 46 38 Q 38 38 38 30" fill="none" stroke="#1C2B3A" strokeWidth="1" />
                <line x1="8"  y1="60" x2="16" y2="68" stroke="#1C2B3A" strokeWidth="0.8" opacity="0.5" />
                <path d="M 8 60 Q 16 60 16 68" fill="none" stroke="#1C2B3A" strokeWidth="1" />
                {/* Windows */}
                <line x1="55" y1="8"   x2="75" y2="8"   stroke="#1C2B3A"             strokeWidth="1" />
                <line x1="55" y1="8.5" x2="75" y2="8.5" stroke="rgba(150,200,220,.9)" strokeWidth="1.5" />
                <line x1="20" y1="92"  x2="50" y2="92"  stroke="#1C2B3A"             strokeWidth="1" />
                <line x1="20" y1="91.5" x2="50" y2="91.5" stroke="rgba(150,200,220,.9)" strokeWidth="1.5" />

                {/* Furniture */}
                <rect x="56" y="14" width="28" height="20" rx="1.5" fill="white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,.14))" }} />
                <rect x="56" y="14" width="28" height="5"  rx="1.5" fill="rgba(200,195,185,.4)" />
                <circle cx="60" cy="18" r="1.5" fill="rgba(180,175,165,.6)" />
                <circle cx="80" cy="18" r="1.5" fill="rgba(180,175,165,.6)" />
                <rect x="11" y="14" width="10" height="14" rx="2" fill="white" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.1))" }} />
                <ellipse cx="16" cy="26" rx="4.5" ry="5" fill="white" stroke="rgba(180,175,165,.5)" strokeWidth="0.5" />
                <rect x="25" y="10" width="12" height="10" rx="2" fill="white" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.1))" }} />
                <circle cx="31" cy="15" r="3" fill="rgba(190,215,235,.35)" stroke="rgba(180,175,165,.5)" strokeWidth="0.5" />
                <rect x="12" y="57" width="52" height="16" rx="2" fill="white" style={{ filter: "drop-shadow(0 1px 5px rgba(0,0,0,.12))" }} />
                <rect x="12" y="59" width="52" height="5"  rx="2" fill="rgba(200,195,185,.25)" />
                <rect x="56" y="57" width="16" height="26" rx="2" fill="white" style={{ filter: "drop-shadow(0 1px 5px rgba(0,0,0,.12))" }} />
                <rect x="20" y="77" width="24" height="12" rx="1.5" fill="white" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.09))" }} />

                {/* Detection boxes */}
                {rows.map((r) =>
                  visible.includes(r.id) ? (
                    <g key={`box-${r.id}`} className="animate-box-appear">
                      <rect
                        x={r.svgX} y={r.svgY} width={r.svgW} height={r.svgH}
                        fill="none"
                        stroke={roomColor(r.type).stroke}
                        strokeWidth="0.75"
                        strokeDasharray="2,1"
                        rx="0.5"
                      />
                      <rect
                        x={r.svgX + 1} y={r.svgY + 1}
                        width={r.svgW - 2} height="7"
                        fill={roomColor(r.type).stroke}
                        rx="0.5" opacity="0.88"
                      />
                      <text
                        x={r.svgX + r.svgW / 2} y={r.svgY + 5.8}
                        textAnchor="middle" fontSize="3.4" fill="white"
                        fontWeight="700" fontFamily="system-ui"
                      >
                        {r.displayType}
                      </text>
                      <text
                        x={r.svgX + r.svgW / 2} y={r.svgY + r.svgH - 2}
                        textAnchor="middle" fontSize="2.8"
                        fill={roomColor(r.type).label} fontFamily="system-ui"
                      >
                        {r.areaSqm} m²
                      </text>
                    </g>
                  ) : null
                )}
              </svg>
            )}
          </div>
        </div>

        {/* Right — confirmation panel */}
        <div className="lg:w-80 xl:w-96 flex-shrink-0">
          <div
            className="rounded-2xl p-6"
            style={{
              background: "rgba(255,255,255,0.82)",
              boxShadow: "var(--shadow-md)",
              backdropFilter: "blur(14px)",
            }}
          >
            {/* Summary row */}
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(122,158,126,0.12)" }}
              >
                <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
                  <path d="M2.5 9L7 13.5L14.5 5" stroke="var(--sage)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--charcoal)" }}>
                  We found {rows.length} rooms
                </p>
                <p className="text-xs" style={{ color: "var(--stone)" }}>
                  Total area: {totalSqm} m²
                </p>
              </div>
            </div>

            <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--stone)" }}>
              Detected Rooms
            </p>

            {/* Room list */}
            <div className="space-y-2 mb-5">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{ background: "rgba(245,240,232,0.85)" }}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: roomColor(r.type).stroke }}
                  />
                  <select
                    value={r.displayType}
                    onChange={(e) => handleTypeChange(r.id, e.target.value)}
                    className="flex-1 text-sm font-medium bg-transparent border-none outline-none cursor-pointer"
                    style={{ color: "var(--charcoal)" }}
                  >
                    {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span className="text-xs font-mono flex-shrink-0" style={{ color: "var(--stone)" }}>
                    {r.areaSqm} m²
                  </span>
                </div>
              ))}

              <button
                className="w-full px-3 py-2.5 rounded-xl border border-dashed text-sm font-medium transition-colors hover:bg-black/[0.02]"
                style={{ borderColor: "var(--cream-border)", color: "var(--stone)" }}
              >
                + Add missing room
              </button>
            </div>

            {/* Context callout */}
            <div
              className="p-4 rounded-xl mb-5 text-sm"
              style={{ background: "rgba(122,158,126,0.09)" }}
            >
              <p className="font-semibold mb-0.5" style={{ color: "var(--charcoal)" }}>
                {rows.map((r) => r.displayType).join(" · ")}
              </p>
              <p style={{ color: "var(--stone)" }}>
                Adjust any room type above if the AI got it wrong, then confirm.
              </p>
            </div>

            <button
              onClick={handleConfirm}
              disabled={confirmed || rows.length === 0}
              className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98]"
              style={{ background: "var(--charcoal)", color: "white", opacity: rows.length === 0 ? 0.5 : 1 }}
            >
              {generating ? (
                <>
                  <span
                    className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin-slow"
                    style={{ borderColor: "white", borderTopColor: "transparent" }}
                  />
                  Generating quote…
                </>
              ) : (
                <>
                  Looks Good, Generate Quote
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M2.5 7.5H12.5M12.5 7.5L8.5 3.5M12.5 7.5L8.5 11.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
