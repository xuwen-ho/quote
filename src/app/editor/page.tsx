"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";

/* ── Types ── */
interface FurnitureItem {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;   // px
  h: number;   // px
  widthCm: number;
  depthCm: number;
  rotation: number;  // 0 | 90 | 180 | 270
}

type Tab = "furniture" | "room" | "materials" | "3d";

/* ── Helpers ── */
const PX_PER_CM = 0.70;

function cmToPx(cm: number) {
  return Math.round(cm * PX_PER_CM);
}

function mkItem(tpl: (typeof CATALOG)[number]): FurnitureItem {
  return {
    id: `${tpl.name.replace(/\s+/g, "_")}_${Date.now()}`,
    name: tpl.name,
    x: 90, y: 200,
    w: cmToPx(tpl.wCm),
    h: cmToPx(tpl.dCm),
    widthCm: tpl.wCm,
    depthCm: tpl.dCm,
    rotation: 0,
  };
}

/* ── Catalog ── */
const CATALOG = [
  { name: "Single Bed",      wCm: 100, dCm: 200 },
  { name: "Queen Bed",       wCm: 160, dCm: 200 },
  { name: "King Bed",        wCm: 180, dCm: 210 },
  { name: "Sofa 2-Seater",   wCm: 150, dCm:  80 },
  { name: "Sofa 3-Seater",   wCm: 210, dCm:  85 },
  { name: "Dining Table 4",  wCm: 120, dCm:  80 },
  { name: "Desk",            wCm: 120, dCm:  60 },
  { name: "Wardrobe",        wCm: 120, dCm:  60 },
  { name: "Nightstand",      wCm:  50, dCm:  50 },
  { name: "Coffee Table",    wCm: 120, dCm:  60 },
  { name: "Armchair",        wCm:  90, dCm:  90 },
  { name: "Bookshelf",       wCm: 100, dCm:  30 },
] as const;

/* ── Initial furniture (matches the SVG floor plan) ── */
const INITIAL: FurnitureItem[] = [
  { id: "bed",   name: "Queen Bed",             x: 104, y: 18,  w: cmToPx(160), h: cmToPx(200), widthCm: 160, depthCm: 200, rotation: 0 },
  { id: "ns1",   name: "Nightstand",            x:  68, y: 30,  w: cmToPx(50),  h: cmToPx(50),  widthCm: 50,  depthCm: 50,  rotation: 0 },
  { id: "ns2",   name: "Nightstand",            x: 208, y: 30,  w: cmToPx(50),  h: cmToPx(50),  widthCm: 50,  depthCm: 50,  rotation: 0 },
  { id: "sofa1", name: "Modular Sofa Section",  x:  28, y: 248, w: cmToPx(210), h: cmToPx(85),  widthCm: 210, depthCm: 85,  rotation: 0 },
  { id: "sofa2", name: "Corner Section",        x: 174, y: 248, w: cmToPx(85),  h: cmToPx(140), widthCm: 85,  depthCm: 140, rotation: 0 },
  { id: "ct",    name: "Coffee Table",          x:  60, y: 320, w: cmToPx(120), h: cmToPx(60),  widthCm: 120, depthCm: 60,  rotation: 0 },
];

/* ── Floor plan walls constant ── */
const CANVAS_W = 262;
const CANVAS_H = 422;

export default function EditorPage() {
  const router = useRouter();

  const [furniture, setFurniture]       = useState<FurnitureItem[]>(INITIAL);
  const [selected, setSelected]         = useState<string | null>(null);
  const [activeTab, setActiveTab]       = useState<Tab>("room");
  const [snap, setSnap]                 = useState(true);
  const [showMenu, setShowMenu]         = useState(false);
  const [showCatalog, setShowCatalog]   = useState(false);
  const [showClearDlg, setShowClearDlg] = useState(false);
  const [history, setHistory]           = useState<FurnitureItem[][]>([INITIAL]);
  const [histIdx, setHistIdx]           = useState(0);

  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  const selectedItem = furniture.find((f) => f.id === selected) ?? null;

  /* ── History helpers ── */
  const commit = useCallback(
    (next: FurnitureItem[]) => {
      setHistory((h) => [...h.slice(0, histIdx + 1), next]);
      setHistIdx((i) => i + 1);
      setFurniture(next);
    },
    [histIdx]
  );

  const undo = () => {
    if (histIdx > 0) {
      const ni = histIdx - 1;
      setHistIdx(ni);
      setFurniture(history[ni]);
      setSelected(null);
    }
  };
  const redo = () => {
    if (histIdx < history.length - 1) {
      const ni = histIdx + 1;
      setHistIdx(ni);
      setFurniture(history[ni]);
    }
  };

  /* ── Drag ── */
  const onPointerDown = (e: ReactPointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const item = furniture.find((f) => f.id === id)!;
    setSelected(id);
    dragRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX: item.x,
      origY: item.y,
    };
  };

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setFurniture((prev) =>
        prev.map((f) => {
          if (f.id !== dragRef.current!.id) return f;
          let nx = dragRef.current!.origX + dx;
          let ny = dragRef.current!.origY + dy;
          if (snap) {
            nx = Math.round(nx / 10) * 10;
            ny = Math.round(ny / 10) * 10;
          }
          return { ...f, x: nx, y: ny };
        })
      );
    },
    [snap]
  );

  const onPointerUp = useCallback(() => {
    if (dragRef.current) {
      // commit to history after drag ends
      setFurniture((current) => {
        commit(current);
        return current;
      });
      dragRef.current = null;
    }
  }, [commit]);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  /* ── Actions ── */
  const rotateSelected = () => {
    if (!selected) return;
    commit(
      furniture.map((f) =>
        f.id === selected
          ? { ...f, rotation: (f.rotation + 90) % 360, w: f.h, h: f.w, widthCm: f.depthCm, depthCm: f.widthCm }
          : f
      )
    );
  };

  const deleteSelected = () => {
    if (!selected) return;
    commit(furniture.filter((f) => f.id !== selected));
    setSelected(null);
  };

  const clearAll = () => {
    commit([]);
    setSelected(null);
    setShowClearDlg(false);
  };

  const updateDim = (field: "widthCm" | "depthCm", val: number) => {
    if (!selected) return;
    setFurniture((prev) =>
      prev.map((f) => {
        if (f.id !== selected) return f;
        if (field === "widthCm") return { ...f, widthCm: val, w: cmToPx(val) };
        return { ...f, depthCm: val, h: cmToPx(val) };
      })
    );
  };

  const addItem = (tpl: (typeof CATALOG)[number]) => {
    const next = [...furniture, mkItem(tpl)];
    commit(next);
    setSelected(next[next.length - 1].id);
    setShowCatalog(false);
  };

  /* ─────────────────────────────────────────── render ── */
  return (
    <div
      className="h-screen flex flex-col overflow-hidden select-none"
      style={{ background: "var(--charcoal)" }}
    >
      {/* ══ Top navigation bar ══ */}
      <header
        className="relative z-20 flex items-center gap-1.5 px-3 py-2.5"
        style={{
          background: "rgba(20,32,46,0.97)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {/* Undo / Redo */}
        {[
          { label: "undo", disabled: histIdx === 0, action: undo,
            path: "M3 8C3 5.24 5.24 3 8 3C9.76 3 11.3 3.92 12.2 5.3M3 5V8H6" },
          { label: "redo", disabled: histIdx >= history.length - 1, action: redo,
            path: "M13 8C13 5.24 10.76 3 8 3C6.24 3 4.7 3.92 3.8 5.3M13 5V8H10" },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={btn.action}
            disabled={btn.disabled}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10 disabled:opacity-25"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {btn.path.split("M").filter(Boolean).map((p, i) => (
                <path key={i} d={`M${p}`} stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </svg>
          </button>
        ))}

        <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.1)" }} />

        {/* Back */}
        <button
          onClick={() => router.push("/quote")}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M9 12L4.5 7.5L9 3" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <h1 className="flex-1 text-center text-sm font-semibold text-white">
          Project: Studio Flat
        </h1>

        {/* Share */}
        <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="11" cy="2.5" r="1.5" stroke="white" strokeWidth="1.2" />
            <circle cx="3.5" cy="7.5" r="1.5" stroke="white" strokeWidth="1.2" />
            <circle cx="11" cy="12.5" r="1.5" stroke="white" strokeWidth="1.2" />
            <line x1="4.9" y1="6.6" x2="9.6" y2="3.4" stroke="white" strokeWidth="1.1" />
            <line x1="4.9" y1="8.4" x2="9.6" y2="11.6" stroke="white" strokeWidth="1.1" />
          </svg>
        </button>

        {/* Three-dot menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              {[2.5, 7.5, 12.5].map((y) => (
                <circle key={y} cx="7.5" cy={y} r="1.1" fill="white" />
              ))}
            </svg>
          </button>

          {showMenu && (
            <div
              className="absolute right-0 top-10 rounded-xl overflow-hidden z-40 min-w-[190px]"
              style={{ background: "white", boxShadow: "0 8px 36px rgba(0,0,0,0.22)" }}
            >
              <button
                onClick={() => { setShowClearDlg(true); setShowMenu(false); }}
                className="w-full text-left px-4 py-3 text-sm flex items-center gap-2.5 hover:bg-black/4 transition-colors"
                style={{ color: "#C83232" }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 3.5h10M9.5 3.5V2A.5.5 0 009 1.5H5a.5.5 0 00-.5.5v1.5M11 3.5L10.5 12a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5L3 3.5" stroke="#C83232" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                Clear All Furniture
              </button>
              <div className="h-px mx-4" style={{ background: "#F0EBE3" }} />
              {["Save as New Version", "Duplicate Project"].map((label) => (
                <button
                  key={label}
                  className="w-full text-left px-4 py-3 text-sm flex items-center gap-2.5 hover:bg-black/4 transition-colors"
                  style={{ color: "var(--charcoal)" }}
                  onClick={() => setShowMenu(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="var(--charcoal)" strokeWidth="1.2" />
                    <path d="M5 7h4M7 5v4" stroke="var(--charcoal)" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ══ Canvas ══ */}
      <div
        className="flex-1 relative overflow-auto"
        onClick={() => { setSelected(null); setShowMenu(false); }}
        style={{
          background: "#F5F0E8",
          backgroundImage: "radial-gradient(circle, #C5B99A 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {/* Floor plan SVG — walls */}
        <div
          ref={canvasRef}
          className="relative mx-auto my-5"
          style={{ width: CANVAS_W, height: CANVAS_H }}
        >
          {/* Walls layer */}
          <svg
            width={CANVAS_W}
            height={CANVAS_H}
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            className="absolute inset-0"
            style={{ pointerEvents: "none" }}
          >
            {/* Background paper */}
            <rect width={CANVAS_W} height={CANVAS_H} fill="#FAF8F4" />

            {/* Outer walls */}
            <rect x="8" y="8" width="246" height="406" fill="none" stroke="#1C2B3A" strokeWidth="5" />

            {/* Bathroom vertical divider */}
            <line x1="120" y1="8"   x2="120" y2="150" stroke="#1C2B3A" strokeWidth="4" />
            {/* Bathroom horizontal divider */}
            <line x1="8"  y1="150" x2="254" y2="150" stroke="#1C2B3A" strokeWidth="4" />

            {/* Bathroom door */}
            <line x1="50" y1="108" x2="50" y2="150" stroke="#1C2B3A" strokeWidth="2" />
            <path d="M 50 150 A 42 42 0 0 0 92 150" fill="none" stroke="#1C2B3A" strokeWidth="1.5" />

            {/* Main entrance door */}
            <line x1="8" y1="258" x2="8" y2="310" stroke="#FAF8F4" strokeWidth="5.5" />
            <line x1="8" y1="258" x2="52" y2="258" stroke="#1C2B3A" strokeWidth="2" />
            <path d="M 8 258 A 44 44 0 0 1 8 302" fill="none" stroke="#1C2B3A" strokeWidth="1.5" />

            {/* Windows */}
            <line x1="130" y1="8"  x2="220" y2="8"  stroke="#1C2B3A"              strokeWidth="2" />
            <line x1="130" y1="11" x2="220" y2="11" stroke="rgba(150,200,220,.95)" strokeWidth="3" />
            <line x1="50"  y1="414" x2="180" y2="414" stroke="#1C2B3A"              strokeWidth="2" />
            <line x1="50"  y1="411" x2="180" y2="411" stroke="rgba(150,200,220,.95)" strokeWidth="3" />

            {/* Fixed bathroom fixtures */}
            {/* Toilet */}
            <rect x="20" y="20" width="36" height="50" rx="5" fill="white" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,.11))" }} />
            <ellipse cx="38" cy="60" rx="15" ry="18" fill="white" stroke="rgba(180,175,165,.5)" strokeWidth="1" />
            {/* Sink */}
            <rect x="82" y="18" width="30" height="28" rx="5" fill="white" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,.11))" }} />
            <circle cx="97" cy="32" r="8" fill="rgba(190,215,235,.4)" stroke="rgba(180,175,165,.5)" strokeWidth="0.75" />
          </svg>

          {/* Draggable furniture items */}
          {furniture.map((item) => {
            const isSel = selected === item.id;
            return (
              <div
                key={item.id}
                onPointerDown={(e) => onPointerDown(e, item.id)}
                onClick={(e) => { e.stopPropagation(); setSelected(item.id); }}
                style={{
                  position: "absolute",
                  left: item.x,
                  top:  item.y,
                  width:  item.w,
                  height: item.h,
                  cursor: "grab",
                  zIndex: isSel ? 20 : 10,
                  touchAction: "none",
                }}
              >
                {/* The piece */}
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    background: "white",
                    borderRadius: 6,
                    border: isSel
                      ? "2px solid var(--sage)"
                      : "1.5px solid rgba(200,195,185,.45)",
                    boxShadow: isSel
                      ? "0 10px 36px rgba(28,43,58,0.22), 0 2px 6px rgba(28,43,58,0.1)"
                      : "0 3px 10px rgba(28,43,58,0.11), 0 1px 3px rgba(28,43,58,0.07)",
                    transform: isSel ? "translateY(-2px)" : "none",
                    transition: "box-shadow .14s ease, transform .14s ease",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {/* Inner detail line */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 5,
                      border: "1px solid rgba(200,195,185,.28)",
                      borderRadius: 3,
                      background: "rgba(245,240,232,.28)",
                    }}
                  />
                  {/* Dimension label on selection */}
                  {isSel && (
                    <span
                      style={{
                        position: "absolute",
                        bottom: 4, left: 0, right: 0,
                        textAlign: "center",
                        fontSize: 9,
                        fontWeight: 600,
                        color: "var(--charcoal)",
                        opacity: 0.6,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {item.widthCm}×{item.depthCm}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Floating: snap toggle ── */}
        <button
          onClick={(e) => { e.stopPropagation(); setSnap(!snap); }}
          className="absolute bottom-5 right-5 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all"
          style={{
            background: snap ? "var(--charcoal)" : "white",
            border: "1.5px solid rgba(28,43,58,.14)",
          }}
          title={snap ? "Snap on" : "Snap off"}
        >
          {/* Magnet icon */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M3.5 4v5a5.5 5.5 0 0011 0V4"
              stroke={snap ? "white" : "var(--charcoal)"}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <line x1="3.5" y1="4" x2="3.5" y2="7" stroke={snap ? "white" : "var(--charcoal)"} strokeWidth="2.5" strokeLinecap="round" />
            <line x1="14.5" y1="4" x2="14.5" y2="7" stroke={snap ? "white" : "var(--charcoal)"} strokeWidth="2.5" strokeLinecap="round" />
            <line x1="1.5" y1="4" x2="5.5" y2="4" stroke={snap ? "white" : "var(--charcoal)"} strokeWidth="1.4" strokeLinecap="round" />
            <line x1="12.5" y1="4" x2="16.5" y2="4" stroke={snap ? "white" : "var(--charcoal)"} strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        {/* ── Clear confirm dialog ── */}
        {showClearDlg && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(28,43,58,0.5)", backdropFilter: "blur(4px)" }}
            onClick={() => setShowClearDlg(false)}
          >
            <div
              className="rounded-2xl p-6 mx-6 max-w-sm w-full"
              style={{ background: "white" }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-base font-semibold mb-2" style={{ color: "var(--charcoal)" }}>
                Clear all furniture?
              </p>
              <p className="text-sm mb-5" style={{ color: "var(--stone)" }}>
                This removes all movable items from the canvas. Walls and room layout remain intact.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearDlg(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border"
                  style={{ borderColor: "var(--cream-border)", color: "var(--charcoal)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={clearAll}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: "#C83232", color: "white" }}
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Furniture catalog drawer ── */}
        {showCatalog && (
          <div
            className="absolute bottom-0 left-0 right-0 z-30 rounded-t-2xl"
            style={{
              background: "white",
              boxShadow: "0 -8px 36px rgba(0,0,0,0.16)",
              maxHeight: "58%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "var(--cream-dark)" }}
            >
              <p className="text-sm font-semibold" style={{ color: "var(--charcoal)" }}>
                Add Furniture
              </p>
              <button onClick={() => setShowCatalog(false)}>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M1.5 1.5L11.5 11.5M11.5 1.5L1.5 11.5" stroke="var(--charcoal)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div
              className="p-4 grid grid-cols-3 gap-2.5 overflow-y-auto"
              style={{ maxHeight: "calc(58vh - 60px)" }}
            >
              {CATALOG.map((tpl) => (
                <button
                  key={tpl.name}
                  onClick={() => addItem(tpl)}
                  className="text-left p-3 rounded-xl border transition-all hover:shadow-sm"
                  style={{ borderColor: "var(--cream-border)" }}
                >
                  <div
                    className="w-full rounded-lg mb-2 flex items-center justify-center"
                    style={{ background: "var(--cream-dark)", height: 52 }}
                  >
                    <div
                      style={{
                        width:  Math.min(cmToPx(tpl.wCm) * 0.35, 60),
                        height: Math.min(cmToPx(tpl.dCm) * 0.35, 34),
                        background: "white",
                        borderRadius: 3,
                        boxShadow: "0 2px 5px rgba(0,0,0,.1)",
                        border: "1px solid rgba(200,195,185,.5)",
                      }}
                    />
                  </div>
                  <p className="text-[11px] font-semibold" style={{ color: "var(--charcoal)" }}>
                    {tpl.name}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--stone)" }}>
                    {tpl.wCm}×{tpl.dCm} cm
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══ Bottom UI (tabs + bottom sheet) ══ */}
      <div
        className="relative z-20 flex-shrink-0"
        style={{
          background: "rgba(20,32,46,0.97)",
          borderTop: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {/* Tabs */}
        <div className="flex">
          {(
            [
              { id: "furniture", label: "Add Furniture", icon: "⊞" },
              { id: "room",      label: "Edit Room",     icon: "✏" },
              { id: "materials", label: "Materials",     icon: "⬡" },
              { id: "3d",        label: "3D View",       icon: "▣" },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab(tab.id);
                  if (tab.id === "furniture") setShowCatalog(true);
                }}
                className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors"
                style={{
                  color: active ? "var(--sage)" : "rgba(255,255,255,0.42)",
                  borderTop: active
                    ? "2px solid var(--sage)"
                    : "2px solid transparent",
                }}
              >
                <span className="text-[11px]">{tab.icon}</span>
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── Bottom sheet — selected item ── */}
        {selectedItem && (
          <div
            className="px-4 pb-4 pt-3 border-t"
            style={{ borderColor: "rgba(255,255,255,0.07)" }}
          >
            {/* Item title + actions */}
            <div className="flex items-center justify-between mb-3.5">
              <div>
                <p
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: "rgba(255,255,255,0.38)" }}
                >
                  Selected
                </p>
                <p className="text-sm font-semibold text-white">{selectedItem.name}</p>
              </div>
              <div className="flex items-center gap-2">
                {/* Rotate */}
                <button
                  onClick={(e) => { e.stopPropagation(); rotateSelected(); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
                  style={{ background: "rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.8)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M1.5 6a4.5 4.5 0 014.5-4.5c1.12 0 2.15.41 2.93 1.08" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    <path d="M10.5 6a4.5 4.5 0 01-4.5 4.5c-1.12 0-2.15-.41-2.93-1.08" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    <path d="M8.5 1.5l1.5 1-1 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Rotate 90°
                </button>
                {/* Delete */}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSelected(); }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(200,50,50,0.18)", color: "#FF7070" }}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M1.5 3h10M9 3V2a.5.5 0 00-.5-.5h-4A.5.5 0 004 2v1M10 3l-.5 8a.5.5 0 01-.5.5H4a.5.5 0 01-.5-.5L3 3" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Dimension sliders */}
            <div className="space-y-2.5">
              {(["Width", "Depth"] as const).map((dim) => {
                const field = dim === "Width" ? "widthCm" : "depthCm";
                const val   = selectedItem[field];
                return (
                  <div key={dim} className="flex items-center gap-3">
                    <span
                      className="text-xs font-medium w-9 flex-shrink-0"
                      style={{ color: "rgba(255,255,255,0.5)" }}
                    >
                      {dim}
                    </span>
                    <input
                      type="range"
                      min={40} max={400} value={val}
                      onChange={(e) => updateDim(field, Number(e.target.value))}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 h-1.5"
                      style={{ accentColor: "var(--sage)" }}
                    />
                    {/* Numeric input */}
                    <div
                      className="flex items-center gap-0.5 rounded-lg px-2.5 py-1.5"
                      style={{ background: "rgba(255,255,255,0.08)" }}
                    >
                      <input
                        type="number"
                        value={val}
                        min={40} max={400}
                        onChange={(e) => updateDim(field, Number(e.target.value))}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => commit(furniture)}
                        className="w-11 text-xs font-mono font-semibold text-right bg-transparent outline-none text-white"
                      />
                      <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.38)" }}>cm</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
