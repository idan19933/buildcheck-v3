import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Maximize2, Minimize2, Plus, Minus, RotateCcw,
  Layers, FileWarning, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { PreviewSheet, RenderedSheets, SheetRender } from '../types';

interface Props {
  dxfFileId: string;
  rendered: RenderedSheets | string[] | null | undefined;
}

const TYPE_LABELS_HE: Record<string, string> = {
  floor_plan: 'תוכניות קומה',
  roof_plan: 'תוכניות גג',
  cross_section: 'חתכים',
  elevation: 'חזיתות',
  site_plan: 'תוכניות פיתוח',
  survey: 'מדידה',
  parking_section: 'חנייה',
  index_page: 'תיק מידע',
  unclassified: 'אחר',
};

const TYPE_PLATE_PREFIX: Record<string, string> = {
  floor_plan: 'PL',
  roof_plan: 'RF',
  cross_section: 'SC',
  elevation: 'EL',
  site_plan: 'ST',
  survey: 'SV',
  parking_section: 'PK',
  index_page: 'IX',
  unclassified: 'DR',
};

const TYPE_TINTS: Record<string, string> = {
  floor_plan: 'bg-emerald-50 text-emerald-800 ring-emerald-700/15',
  roof_plan: 'bg-sky-50 text-sky-800 ring-sky-700/15',
  cross_section: 'bg-violet-50 text-violet-800 ring-violet-700/15',
  elevation: 'bg-amber-50 text-amber-800 ring-amber-700/15',
  site_plan: 'bg-lime-50 text-lime-800 ring-lime-700/15',
  survey: 'bg-rose-50 text-rose-800 ring-rose-700/15',
  parking_section: 'bg-blue-50 text-blue-800 ring-blue-700/15',
  index_page: 'bg-stone-100 text-stone-800 ring-stone-700/15',
  unclassified: 'bg-stone-50 text-stone-700 ring-stone-700/10',
};

function isRenderedSheets(v: unknown): v is RenderedSheets {
  return !!v && typeof v === 'object' && Array.isArray((v as RenderedSheets).sheets);
}

function previewToSheet(p: PreviewSheet): SheetRender {
  return {
    sheet_num: p.index,
    filename: p.filename,
    label_he: 'תצוגה מהירה',
    label_en: p.geometry_vp && p.annotation_vp
      ? `${p.geometry_vp} + ${p.annotation_vp}`
      : (p.geometry_vp || p.annotation_vp || p.block || 'preview'),
    type: 'unclassified',
    icon: '',
    scale: null,
    geo_viewport: p.geometry_vp ?? null,
    ann_viewport: p.annotation_vp ?? null,
    pair_score: 0,
    entity_count: p.line_count,
    bbox: [0, 0, 0, 0],
  };
}

export default function DxfPreview({ dxfFileId, rendered }: Props) {
  const { sheets, isPreview } = useMemo(() => {
    if (!rendered) return { sheets: [] as SheetRender[], isPreview: false };
    if (isRenderedSheets(rendered)) {
      const aiSheets = rendered.sheets || [];
      // Prefer AI sheets when they've landed; otherwise show deterministic previews.
      if (aiSheets.length > 0) {
        return { sheets: aiSheets, isPreview: false };
      }
      const previews = rendered.previews ?? [];
      return { sheets: previews.map(previewToSheet), isPreview: previews.length > 0 };
    }
    // Legacy shape: bare string[] of filenames.
    return {
      sheets: (rendered as string[]).map((filename, i): SheetRender => ({
        sheet_num: i + 1,
        filename,
        label_he: filename.replace(/\.[a-z]+$/i, ''),
        label_en: filename.replace(/\.[a-z]+$/i, ''),
        type: 'unclassified',
        icon: '',
        scale: null,
        geo_viewport: null,
        ann_viewport: null,
        pair_score: 0,
        entity_count: 0,
        bbox: [0, 0, 0, 0],
      })),
      isPreview: false,
    };
  }, [rendered]);

  const [activeType, setActiveType] = useState<string>('all');
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (activeType === 'all') return sheets;
    return sheets.filter(s => s.type === activeType);
  }, [sheets, activeType]);

  if (!sheets.length) return null;

  const typeCounts = sheets.reduce<Record<string, number>>((acc, s) => {
    acc[s.type] = (acc[s.type] || 0) + 1;
    return acc;
  }, {});
  const types = Object.keys(typeCounts);

  return (
    <section className="mb-10">
      {/* Header bar */}
      <header className="flex items-end justify-between gap-4 mb-5 pb-3 border-b border-ink-300/15">
        <div>
          <div className="font-mono text-[10px] tracking-[0.22em] text-ink-50 uppercase mb-1">
            {isPreview ? 'Quick Preview' : 'Drawing Sheets'} · {sheets.length.toString().padStart(2, '0')}
          </div>
          <h2 className="font-serif text-2xl text-ink-300 leading-tight">
            דפי התכנית
          </h2>
        </div>
        {isPreview ? (
          <div className="hidden sm:flex items-center gap-2 font-mono text-[10px] text-terra-600 text-left tracking-wider">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-terra-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-terra-500" />
            </span>
            <span>AI labels processing…</span>
          </div>
        ) : (
          <div className="hidden sm:block font-mono text-[10px] text-ink-50 text-left tracking-wider">
            <div>Composite render</div>
            <div className="text-ink-100">geo + annotations</div>
          </div>
        )}
      </header>

      {/* Type filter chips */}
      {types.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <FilterChip
            active={activeType === 'all'}
            label="הכול"
            count={sheets.length}
            onClick={() => setActiveType('all')}
          />
          {types.map(t => (
            <FilterChip
              key={t}
              active={activeType === t}
              label={TYPE_LABELS_HE[t] || t}
              count={typeCounts[t]}
              onClick={() => setActiveType(t)}
            />
          ))}
        </div>
      )}

      {/* Plate grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filtered.map((sheet) => {
          const idx = sheets.indexOf(sheet);
          return (
            <SheetPlate
              key={sheet.filename}
              sheet={sheet}
              dxfFileId={dxfFileId}
              onOpen={() => setOpenIdx(idx)}
            />
          );
        })}
      </div>

      {openIdx != null && (
        <SheetLightbox
          dxfFileId={dxfFileId}
          sheets={sheets}
          index={openIdx}
          onIndexChange={setOpenIdx}
          onClose={() => setOpenIdx(null)}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- chip

function FilterChip({
  active, label, count, onClick,
}: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'group inline-flex items-center gap-2 px-3 py-1.5 text-xs',
        'border transition-all duration-150',
        active
          ? 'bg-ink-300 text-paper-50 border-ink-300'
          : 'bg-paper-50 text-ink-100 border-ink-300/15 hover:border-terra-500/40 hover:text-terra-600',
      ].join(' ')}
    >
      <span className="font-medium">{label}</span>
      <span
        className={[
          'font-mono text-[10px] tabular-nums px-1.5 py-0.5 rounded-sm',
          active ? 'bg-paper-50/15 text-paper-100' : 'bg-ink-300/8 text-ink-50 group-hover:bg-terra-500/10',
        ].join(' ')}
      >
        {count}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- plate

function SheetPlate({
  sheet, dxfFileId, onOpen,
}: { sheet: SheetRender; dxfFileId: string; onOpen: () => void }) {
  const src = `/api/renders/${dxfFileId}/${encodeURIComponent(sheet.filename)}`;
  const [imgError, setImgError] = useState(false);
  const plateCode = `${TYPE_PLATE_PREFIX[sheet.type] || 'DR'}.${String(sheet.sheet_num).padStart(2, '0')}`;
  const tint = TYPE_TINTS[sheet.type] || TYPE_TINTS.unclassified;

  return (
    <button
      onClick={onOpen}
      className={[
        'group text-right block w-full',
        'bg-paper-50 border border-ink-300/12 shadow-plate',
        'transition-all duration-200 ease-out',
        'hover:shadow-plate-hover hover:-translate-y-0.5 hover:border-terra-500/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/40',
      ].join(' ')}
    >
      {/* top metadata strip */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ink-300/10 bg-paper-100/60">
        <span className="font-mono text-[10px] tracking-wider text-ink-100">
          {plateCode}
        </span>
        <span
          className={[
            'inline-flex items-center px-1.5 py-0.5 text-[10px]',
            'ring-1 rounded-sm font-medium tracking-wide',
            tint,
          ].join(' ')}
        >
          {TYPE_LABELS_HE[sheet.type] || sheet.type}
        </span>
      </div>

      {/* sheet preview canvas */}
      <div className="relative aspect-[5/4] bg-white overflow-hidden border-b border-ink-300/10">
        {/* Subtle grid pattern behind sheet, very faint */}
        <div
          className="absolute inset-0 opacity-[0.035] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(to right, #14181F 1px, transparent 1px), linear-gradient(to bottom, #14181F 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />
        {!imgError ? (
          <img
            src={src}
            alt={sheet.label_he}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-contain p-3 transition-transform duration-300 group-hover:scale-[1.02]"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-ink-50">
            <FileWarning className="w-6 h-6 mb-2 opacity-60" />
            <span className="text-xs">לא ניתן להציג</span>
          </div>
        )}
        {/* corner crop marks for the architectural plate feel */}
        <CornerMark className="top-1.5 right-1.5" />
        <CornerMark className="top-1.5 left-1.5 rotate-90" />
        <CornerMark className="bottom-1.5 right-1.5 -rotate-90" />
        <CornerMark className="bottom-1.5 left-1.5 rotate-180" />
      </div>

      {/* footer caption */}
      <div className="px-3 py-3">
        <div className="font-serif text-base text-ink-300 leading-snug truncate" title={sheet.label_he}>
          {sheet.label_he}
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-ink-50">
          <span className="tabular-nums">
            {sheet.scale || '—'}
          </span>
          <span className="flex items-center gap-1 opacity-80" title="מקור (gemoetry + annotations)">
            <Layers className="w-3 h-3" />
            <span className="tabular-nums">
              {sheet.geo_viewport?.replace('VIEWPORT', 'V') || '—'}
              {sheet.ann_viewport && ` + ${sheet.ann_viewport.replace('VIEWPORT', 'V')}`}
            </span>
          </span>
        </div>
      </div>

      {/* bottom hover accent */}
      <div className="h-0.5 bg-terra-500 scale-x-0 group-hover:scale-x-100 origin-right transition-transform duration-200" />
    </button>
  );
}

function CornerMark({ className = '' }: { className?: string }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10"
      className={`absolute text-ink-300/30 ${className}`}
    >
      <path d="M 0 5 L 0 0 L 5 0" fill="none" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}

// ---------------------------------------------------------------- lightbox

function SheetLightbox({
  dxfFileId, sheets, index, onIndexChange, onClose,
}: {
  dxfFileId: string;
  sheets: SheetRender[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const sheet = sheets[index];
  const src = `/api/renders/${dxfFileId}/${encodeURIComponent(sheet.filename)}`;
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Reset transform when switching sheets
  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [index]);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // RTL: ArrowRight = previous, ArrowLeft = next
      if (e.key === 'ArrowRight') onIndexChange(Math.max(0, index - 1));
      if (e.key === 'ArrowLeft') onIndexChange(Math.min(sheets.length - 1, index + 1));
      if (e.key === '+' || e.key === '=') setScale(s => Math.min(s * 1.25, 8));
      if (e.key === '-' || e.key === '_') setScale(s => Math.max(s / 1.25, 0.4));
      if (e.key === '0') { setScale(1); setPan({ x: 0, y: 0 }); }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [index, sheets.length, onClose, onIndexChange]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(s => Math.max(0.4, Math.min(8, s * delta)));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  };
  const onMouseUp = () => setIsDragging(false);

  const tint = TYPE_TINTS[sheet.type] || TYPE_TINTS.unclassified;
  const plateCode = `${TYPE_PLATE_PREFIX[sheet.type] || 'DR'}.${String(sheet.sheet_num).padStart(2, '0')}`;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background:
          'radial-gradient(ellipse at center, #1a2030 0%, #0a0e16 80%)',
      }}
    >
      {/* drafting-table grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Top toolbar */}
      <header className="relative z-10 flex items-center justify-between gap-4 px-5 py-3 bg-ink-300/40 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-xs tracking-[0.22em] text-paper-300/80">
            {plateCode}
          </span>
          <span className="h-4 w-px bg-white/15" />
          <h3 className="font-serif text-lg sm:text-xl text-paper-50 truncate">
            {sheet.label_he}
          </h3>
          <span
            className={[
              'inline-flex items-center px-1.5 py-0.5 text-[10px] ring-1 rounded-sm font-medium',
              tint,
            ].join(' ')}
          >
            {TYPE_LABELS_HE[sheet.type] || sheet.type}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* counter */}
          <span className="hidden sm:inline-block font-mono text-[10px] text-paper-300/70 tabular-nums px-2">
            {String(index + 1).padStart(2, '0')} / {String(sheets.length).padStart(2, '0')}
          </span>
          <ToolbarButton onClick={() => setScale(s => Math.max(s / 1.25, 0.4))} label="הקטן">
            <Minus className="w-4 h-4" />
          </ToolbarButton>
          <span className="font-mono text-[10px] text-paper-300/70 tabular-nums w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <ToolbarButton onClick={() => setScale(s => Math.min(s * 1.25, 8))} label="הגדל">
            <Plus className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }} label="איפוס">
            <RotateCcw className="w-4 h-4" />
          </ToolbarButton>
          <span className="h-5 w-px bg-white/15 mx-1" />
          <ToolbarButton onClick={onClose} label="סגור">
            <X className="w-4 h-4" />
          </ToolbarButton>
        </div>
      </header>

      {/* Sheet stage */}
      <div
        className="relative flex-1 overflow-hidden flex items-center justify-center select-none"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'default' }}
      >
        <div
          className="bg-white shadow-sheet relative"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: 'center',
            transition: isDragging ? 'none' : 'transform 200ms ease-out',
            width: 'min(92vw, 1200px)',
            maxHeight: '78vh',
            aspectRatio: '4/3',
          }}
        >
          <img
            src={src}
            alt={sheet.label_he}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            draggable={false}
          />
        </div>

        {/* Prev/next nav (RTL — right is back, left is forward) */}
        <NavBtn className="right-3" onClick={() => onIndexChange(Math.max(0, index - 1))} disabled={index === 0}>
          <ChevronRight className="w-5 h-5" />
        </NavBtn>
        <NavBtn className="left-3" onClick={() => onIndexChange(Math.min(sheets.length - 1, index + 1))} disabled={index === sheets.length - 1}>
          <ChevronLeft className="w-5 h-5" />
        </NavBtn>
      </div>

      {/* Bottom strip — sheet metadata */}
      <footer className="relative z-10 px-5 py-2 bg-ink-300/40 backdrop-blur-md border-t border-white/5">
        <div className="flex items-center justify-between text-[10px] text-paper-300/70 font-mono tracking-wider">
          <div className="flex items-center gap-4">
            <span>SCALE <span className="text-paper-50">{sheet.scale || '—'}</span></span>
            <span>ENTITIES <span className="text-paper-50 tabular-nums">{sheet.entity_count.toLocaleString()}</span></span>
            <span className="hidden sm:inline">
              SOURCE <span className="text-paper-50">
                {sheet.geo_viewport || '—'}{sheet.ann_viewport ? ` + ${sheet.ann_viewport}` : ''}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>SCROLL לזום · גרור להזזה · ESC ליציאה</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ToolbarButton({
  children, onClick, label,
}: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-1.5 text-paper-200 hover:text-paper-50 hover:bg-white/8 rounded-sm transition-colors"
    >
      {children}
    </button>
  );
}

function NavBtn({
  children, onClick, disabled, className = '',
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      className={[
        'absolute top-1/2 -translate-y-1/2 z-10',
        'w-10 h-10 flex items-center justify-center',
        'bg-ink-300/60 backdrop-blur text-paper-50',
        'border border-white/10 rounded-full',
        'transition-all duration-150',
        disabled
          ? 'opacity-20 cursor-default'
          : 'hover:bg-terra-500 hover:border-terra-500 hover:scale-110',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}
