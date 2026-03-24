"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import RatesPanel from "@/components/RatesPanel";
import type { QuotationSummary, QuotationLineItem, DetectedRoom, RateItem } from "@/lib/types";

/* ── Mock fallback for when no session data ── */
const MOCK_SUMMARY: QuotationSummary = {
  lineItems: [
    { category: "Flooring",   itemName: "Engineered oak parquet",  unit: "sqft", quantity: 198, unitCost: 7.90,  totalCost: 1564.2,  room: "Master Bedroom" },
    { category: "Painting",   itemName: "Walls & ceiling",         unit: "sqft", quantity: 198, unitCost: 1.11,  totalCost: 219.78,  room: "Master Bedroom" },
    { category: "Electrical", itemName: "Lighting points",         unit: "point",quantity: 2,   unitCost: 180,   totalCost: 360,     room: "Master Bedroom" },
    { category: "Flooring",   itemName: "Polished micro-concrete", unit: "sqft", quantity: 238, unitCost: 11.15, totalCost: 2653.7,  room: "Living Room" },
    { category: "Painting",   itemName: "Feature wall + ceiling",  unit: "sqft", quantity: 238, unitCost: 1.30,  totalCost: 309.4,   room: "Living Room" },
    { category: "Electrical", itemName: "Pendants & recessed",     unit: "point",quantity: 4,   unitCost: 180,   totalCost: 720,     room: "Living Room" },
    { category: "Plumbing",   itemName: "Fixture installation",    unit: "unit", quantity: 1,   unitCost: 2800,  totalCost: 2800,    room: "Bathroom" },
    { category: "Electrical", itemName: "Fan & vanity lighting",   unit: "point",quantity: 2,   unitCost: 180,   totalCost: 360,     room: "Bathroom" },
  ],
  subtotal: 8987.08,
  margin: 0.10,
  marginAmount: 898.71,
  grandTotal: 9885.79,
};

const CAT_COLOUR: Record<string, { bg: string; text: string; dot: string }> = {
  Flooring:   { bg: "rgba(200,160,100,.13)", text: "#A07840", dot: "#C8A064" },
  Painting:   { bg: "rgba(122,158,126,.13)", text: "#5E7D62", dot: "#7A9E7E" },
  Electrical: { bg: "rgba(100,136,200,.13)", text: "#4A68A4", dot: "#6488C8" },
  Plumbing:   { bg: "rgba(100,168,200,.13)", text: "#3A7890", dot: "#64A8C8" },
  Carpentry:  { bg: "rgba(176,112,128,.13)", text: "#8A4A58", dot: "#B07080" },
  Tiling:     { bg: "rgba(168,136,200,.13)", text: "#6A4A8A", dot: "#A888C8" },
  General:    { bg: "rgba(140,140,140,.13)", text: "#666666", dot: "#999999" },
};

function catStyle(cat: string) {
  return CAT_COLOUR[cat] ?? { bg: "rgba(140,140,140,.13)", text: "#666", dot: "#888" };
}

function fmt(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/* Group line items by room */
function groupByRoom(items: QuotationLineItem[]) {
  const map = new Map<string, QuotationLineItem[]>();
  for (const item of items) {
    const key = item.room ?? "General";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

interface SessionData {
  summary: QuotationSummary;
  quoteId: string | null;
  margin: number;
  rooms: DetectedRoom[];
}

export default function QuotePage() {
  const router = useRouter();
  const [summary, setSummary] = useState<QuotationSummary>(MOCK_SUMMARY);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [margin, setMargin] = useState(10);
  const [rooms, setRooms] = useState<DetectedRoom[]>([]);
  const [showRates, setShowRates] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("qf_quote");
      if (stored) {
        const data: SessionData = JSON.parse(stored);
        if (data.summary) setSummary(data.summary);
        if (data.quoteId) setQuoteId(data.quoteId);
        if (typeof data.margin === "number") setMargin(data.margin);
        if (Array.isArray(data.rooms)) setRooms(data.rooms);
      }
    } catch {
      // fall back to mock
    }
  }, []);

  const handleRatesApply = useCallback(async (newMargin: number, overrides: RateItem[]) => {
    if (rooms.length === 0) {
      // No real rooms in session, just update margin display
      setMargin(newMargin);
      setShowRates(false);
      return;
    }

    try {
      const res = await fetch("/api/quotes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rooms,
          rates: overrides.length > 0 ? overrides : undefined,
          margin: newMargin / 100,
        }),
      });
      if (!res.ok) throw new Error("Recalculation failed");
      const data = await res.json();

      setSummary(data.summary);
      setMargin(newMargin);
      if (data.quoteId) setQuoteId(data.quoteId);

      // Update session
      sessionStorage.setItem("qf_quote", JSON.stringify({
        summary: data.summary,
        quoteId: data.quoteId ?? null,
        margin: newMargin,
        rooms,
      }));
    } catch {
      // Keep existing summary, just close panel
    }

    setShowRates(false);
  }, [rooms]);

  const handleExportPDF = async () => {
    if (!quoteId) return;
    setExportLoading(true);
    try {
      window.open(`/api/quotes/${quoteId}/pdf`, "_blank");
    } finally {
      setExportLoading(false);
    }
  };

  const grouped = groupByRoom(summary.lineItems);
  const displayMargin = Math.round(summary.margin * 100);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--cream)" }}>
      <div className="fixed inset-0 dot-grid pointer-events-none" style={{ opacity: 0.4 }} />

      {/* ── Header ── */}
      <header
        className="relative z-20 flex items-center gap-3 px-6 py-4 border-b"
        style={{
          borderColor: "var(--cream-border)",
          background: "rgba(245,240,232,0.95)",
          backdropFilter: "blur(12px)",
        }}
      >
        <button
          onClick={() => router.push("/analyze")}
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M11 14L6 9L11 4" stroke="var(--charcoal)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex-1">
          <p className="text-[11px] font-medium" style={{ color: "var(--stone)" }}>Quotation</p>
          <p className="text-sm font-semibold" style={{ color: "var(--charcoal)" }}>
            {quoteId ? `Quote #${quoteId.slice(-8).toUpperCase()}` : "Draft Quote"}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Customize rates */}
          <button
            onClick={() => setShowRates(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium border transition-colors hover:bg-black/4"
            style={{ borderColor: "var(--cream-border)", color: "var(--charcoal)" }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M4.5 7C4.5 5.62 5.62 4.5 7 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <path d="M9.5 7C9.5 8.38 8.38 9.5 7 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            Customize Rates
          </button>

          {/* Export PDF */}
          <button
            onClick={quoteId ? handleExportPDF : undefined}
            disabled={!quoteId || exportLoading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold transition-opacity hover:opacity-80"
            style={{
              background: "var(--sage)",
              color: "white",
              opacity: (!quoteId || exportLoading) ? 0.6 : 1,
              cursor: quoteId ? "pointer" : "not-allowed",
            }}
            title={!quoteId ? "PDF export requires a saved quote (sign in to save)" : "Export as PDF"}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v8M4.5 6.5L7 9l2.5-2.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 10v1.5A1.5 1.5 0 003.5 13h7A1.5 1.5 0 0012 11.5V10" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            {exportLoading ? "Exporting…" : "Export PDF"}
          </button>

          {/* Open editor */}
          <button
            onClick={() => router.push("/editor")}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: "var(--charcoal)", color: "white" }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect x="1" y="1" width="11" height="11" rx="1.5" stroke="white" strokeWidth="1.2" />
              <path d="M4 4h5M4 6.5h5M4 9h3" stroke="white" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
            Floor Plan Editor
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="relative z-10 flex-1 max-w-5xl mx-auto w-full px-6 py-8">

        {/* Summary card */}
        <div
          className="rounded-2xl p-6 mb-8 flex flex-wrap items-center gap-6"
          style={{ background: "var(--charcoal)", color: "white" }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-50 mb-2">
              Total Quotation
            </p>
            <p className="text-4xl font-semibold tracking-tight">{fmt(summary.grandTotal)}</p>
            <p className="text-sm opacity-50 mt-1">
              Subtotal {fmt(summary.subtotal)} + {displayMargin}% margin ({fmt(summary.marginAmount)})
            </p>
          </div>

          <div className="flex items-center gap-8">
            {[
              { label: "Rooms",      value: grouped.size },
              { label: "Line Items", value: summary.lineItems.length },
              { label: "Margin",     value: `${displayMargin}%` },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-2xl font-semibold">{s.value}</p>
                <p className="text-[11px] opacity-50 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Table per room */}
        {Array.from(grouped.entries()).map(([roomName, items]) => {
          const roomSubtotal = items.reduce((s, i) => s + i.totalCost, 0);
          return (
            <div
              key={roomName}
              className="rounded-2xl overflow-hidden mb-4"
              style={{
                background: "rgba(255,255,255,0.82)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              {/* Room header */}
              <div
                className="flex items-center justify-between px-6 py-4 border-b"
                style={{ borderColor: "var(--cream-dark)" }}
              >
                <h3 className="text-sm font-semibold" style={{ color: "var(--charcoal)" }}>
                  {roomName}
                </h3>
                <span className="text-sm font-semibold" style={{ color: "var(--charcoal)" }}>
                  {fmt(roomSubtotal)}
                </span>
              </div>

              {/* Items table */}
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: `1px solid var(--cream-dark)` }}>
                    {["Category", "Description", "Unit", "Qty", "Rate", "Total"].map((h) => (
                      <th
                        key={h}
                        className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--stone)" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const c = catStyle(item.category);
                    return (
                      <tr
                        key={idx}
                        className="transition-colors hover:bg-black/[0.018]"
                        style={{ borderBottom: idx < items.length - 1 ? "1px solid #F0EBE3" : "none" }}
                      >
                        <td className="px-6 py-3.5">
                          <span
                            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ background: c.bg, color: c.text }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
                            {item.category}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-sm" style={{ color: "var(--charcoal)" }}>
                          {item.itemName}
                        </td>
                        <td className="px-6 py-3.5 text-xs font-mono" style={{ color: "var(--stone)" }}>
                          {item.unit}
                        </td>
                        <td className="px-6 py-3.5 text-sm font-mono" style={{ color: "var(--charcoal)" }}>
                          {item.quantity}
                        </td>
                        <td className="px-6 py-3.5 text-sm font-mono" style={{ color: "var(--charcoal)" }}>
                          {fmt(item.unitCost)}
                        </td>
                        <td className="px-6 py-3.5 text-sm font-semibold font-mono" style={{ color: "var(--charcoal)" }}>
                          {fmt(item.totalCost)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}

        {/* Grand total row */}
        <div
          className="rounded-2xl px-6 py-5 flex items-center justify-between"
          style={{ background: "rgba(255,255,255,0.82)", boxShadow: "var(--shadow-sm)" }}
        >
          <span className="text-sm font-semibold" style={{ color: "var(--stone)" }}>
            Grand Total (incl. {displayMargin}% margin)
          </span>
          <span className="text-2xl font-semibold" style={{ color: "var(--charcoal)" }}>
            {fmt(summary.grandTotal)}
          </span>
        </div>

        {!quoteId && (
          <p className="text-center text-xs mt-4" style={{ color: "var(--stone)" }}>
            Sign in to save your quote and enable PDF export
          </p>
        )}
      </main>

      <RatesPanel
        isOpen={showRates}
        onClose={() => setShowRates(false)}
        initialMargin={margin}
        onApply={handleRatesApply}
      />
    </div>
  );
}
