"use client";

import { useState, useEffect } from "react";
import type { RateItem } from "@/lib/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialMargin?: number;
  onApply?: (margin: number, overrides: RateItem[]) => void;
}

/* Fallback categories if API unavailable */
const DEFAULT_CATEGORIES = [
  { name: "Flooring",   unit: "sqft",    defaultRate: 7.90,  min: 2,   max: 30   },
  { name: "Painting",   unit: "sqft",    defaultRate: 1.11,  min: 0.5, max: 5    },
  { name: "Electrical", unit: "point",   defaultRate: 180,   min: 50,  max: 500  },
  { name: "Plumbing",   unit: "fixture", defaultRate: 350,   min: 100, max: 900  },
  { name: "Carpentry",  unit: "sqft",    defaultRate: 12,    min: 3,   max: 50   },
  { name: "Tiling",     unit: "sqft",    defaultRate: 8.83,  min: 2,   max: 30   },
];

const CAT_ICONS: Record<string, string> = {
  Flooring: "⬛", Painting: "🖌", Electrical: "⚡",
  Plumbing: "🔧", Carpentry: "🪚", Tiling: "◼",
};

interface CategoryState {
  name: string;
  unit: string;
  currentRate: number;
  defaultRate: number;
  min: number;
  max: number;
  itemName: string;
  category: string;
}

export default function RatesPanel({ isOpen, onClose, initialMargin = 10, onApply }: Props) {
  const [margin, setMargin] = useState(initialMargin);
  const [categories, setCategories] = useState<CategoryState[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /* Sync margin when parent updates */
  useEffect(() => {
    setMargin(initialMargin);
  }, [initialMargin]);

  /* Load rates from API when panel opens */
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);

    fetch("/api/rates")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.rates) && data.rates.length > 0) {
          // Group by category, pick representative item per category for the slider
          const byCategory = new Map<string, RateItem[]>();
          for (const rate of data.rates as RateItem[]) {
            if (!byCategory.has(rate.category)) byCategory.set(rate.category, []);
            byCategory.get(rate.category)!.push(rate);
          }

          const cats: CategoryState[] = Array.from(byCategory.entries())
            .filter(([cat]) => cat !== "General")
            .map(([cat, items]) => {
              const first = items[0];
              const fallback = DEFAULT_CATEGORIES.find((c) => c.name.toLowerCase() === cat.toLowerCase());
              return {
                name: cat,
                unit: first.unit,
                currentRate: first.unitCost,
                defaultRate: first.unitCost,
                min: fallback?.min ?? 1,
                max: fallback?.max ?? first.unitCost * 5,
                itemName: first.itemName,
                category: cat,
              };
            });

          setCategories(cats);
        } else {
          // Fall back to defaults
          setCategories(DEFAULT_CATEGORIES.map((c) => ({
            name: c.name, unit: c.unit, currentRate: c.defaultRate,
            defaultRate: c.defaultRate, min: c.min, max: c.max,
            itemName: c.name.toLowerCase(), category: c.name,
          })));
        }
      })
      .catch(() => {
        setCategories(DEFAULT_CATEGORIES.map((c) => ({
          name: c.name, unit: c.unit, currentRate: c.defaultRate,
          defaultRate: c.defaultRate, min: c.min, max: c.max,
          itemName: c.name.toLowerCase(), category: c.name,
        })));
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  const setRate = (name: string, val: number) =>
    setCategories((prev) => prev.map((c) => c.name === name ? { ...c, currentRate: val } : c));

  const handleSave = async () => {
    setSaving(true);

    const changedRates: RateItem[] = categories
      .filter((c) => c.currentRate !== c.defaultRate)
      .map((c) => ({
        category: c.category,
        itemName: c.itemName,
        unitCost: c.currentRate,
        unit: c.unit,
      }));

    // Build full override list for recalculation
    const allRates: RateItem[] = categories.map((c) => ({
      category: c.category,
      itemName: c.itemName,
      unitCost: c.currentRate,
      unit: c.unit,
    }));

    // Try to persist custom rates (only works if user is authenticated)
    if (changedRates.length > 0) {
      try {
        await fetch("/api/rates", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rates: changedRates }),
        });
      } catch {
        // Silently ignore — user may not be authenticated
      }
    }

    setSaving(false);
    onApply?.(margin, allRates);
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30"
          style={{ background: "rgba(28,43,58,0.35)", backdropFilter: "blur(4px)" }}
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <aside
        className="fixed top-0 right-0 bottom-0 z-40 flex flex-col w-full max-w-sm"
        style={{
          background: "var(--cream)",
          boxShadow: "-4px 0 36px rgba(28,43,58,0.13)",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-5 border-b"
          style={{ borderColor: "var(--cream-border)" }}
        >
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--charcoal)" }}>
              Customize Rates
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--stone)" }}>
              Override costs &amp; margins
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-black/6"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1.5 1.5L11.5 11.5M11.5 1.5L1.5 11.5" stroke="var(--charcoal)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

          {/* Global margin */}
          <div
            className="p-4 rounded-xl border"
            style={{ background: "rgba(255,255,255,0.75)", borderColor: "var(--cream-border)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold" style={{ color: "var(--charcoal)" }}>
                Global Margin
              </p>
              <div className="flex items-center gap-0.5">
                <input
                  type="number"
                  value={margin}
                  min={0} max={100}
                  onChange={(e) => setMargin(Math.min(100, Math.max(0, Number(e.target.value))))}
                  className="w-10 text-right text-sm font-semibold bg-transparent border-none outline-none"
                  style={{ color: "var(--charcoal)" }}
                />
                <span className="text-sm font-semibold" style={{ color: "var(--charcoal)" }}>%</span>
              </div>
            </div>
            <input
              type="range" min={0} max={50} value={margin}
              onChange={(e) => setMargin(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: "var(--sage)" }}
            />
            <div className="flex justify-between mt-1">
              <span className="text-[11px]" style={{ color: "var(--stone)" }}>0%</span>
              <span className="text-[11px]" style={{ color: "var(--stone)" }}>50%</span>
            </div>
          </div>

          {/* Per-category rates */}
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--stone)" }}>
            Unit Rates
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div
                className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin-slow"
                style={{ borderColor: "var(--sage)", borderTopColor: "transparent" }}
              />
            </div>
          ) : (
            categories.map((cat) => {
              const changed = cat.currentRate !== cat.defaultRate;
              return (
                <div
                  key={cat.name}
                  className="p-4 rounded-xl border"
                  style={{
                    background: "rgba(255,255,255,0.75)",
                    borderColor: changed ? "var(--sage)" : "var(--cream-border)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold flex items-center gap-1.5" style={{ color: "var(--charcoal)" }}>
                      <span className="text-xs">{CAT_ICONS[cat.name] ?? "·"}</span>
                      {cat.name}
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--stone)" }}>
                      per {cat.unit}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={cat.min} max={cat.max} step={0.5} value={cat.currentRate}
                      onChange={(e) => setRate(cat.name, Number(e.target.value))}
                      className="flex-1"
                      style={{ accentColor: "var(--sage)" }}
                    />
                    <div
                      className="flex items-center gap-0.5 rounded-lg px-2.5 py-1"
                      style={{ background: "rgba(245,240,232,0.9)", border: "1px solid var(--cream-border)" }}
                    >
                      <span className="text-xs" style={{ color: "var(--stone)" }}>$</span>
                      <input
                        type="number"
                        value={cat.currentRate}
                        min={cat.min} max={cat.max} step={0.5}
                        onChange={(e) => setRate(cat.name, Number(e.target.value))}
                        className="w-14 text-sm font-semibold text-right bg-transparent border-none outline-none"
                        style={{ color: "var(--charcoal)" }}
                      />
                    </div>
                  </div>

                  {changed && (
                    <button
                      onClick={() => setRate(cat.name, cat.defaultRate)}
                      className="mt-2 text-[11px] transition-opacity hover:opacity-70"
                      style={{ color: "var(--stone)" }}
                    >
                      Reset to default (${cat.defaultRate})
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-5 border-t"
          style={{ borderColor: "var(--cream-border)" }}
        >
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-85 flex items-center justify-center gap-2"
            style={{ background: "var(--charcoal)", color: "white" }}
          >
            {saving ? (
              <>
                <span
                  className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin-slow"
                  style={{ borderColor: "white", borderTopColor: "transparent" }}
                />
                Recalculating…
              </>
            ) : "Save & Recalculate"}
          </button>
          <button
            onClick={onClose}
            className="w-full py-2.5 text-sm mt-1.5 transition-opacity hover:opacity-70"
            style={{ color: "var(--stone)" }}
          >
            Cancel
          </button>
        </div>
      </aside>
    </>
  );
}
