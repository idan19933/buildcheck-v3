import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Plus, Minus, RotateCcw, Layers, FileWarning,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { PreviewSheet, RenderedSheets, SheetRender } from '../types';
import { Badge } from './ui';
import { cn } from '../lib/utils';

interface Props {
  dxfFileId: string;
  rendered: RenderedSheets | string[] | null | undefined;
}

const TYPE_LABELS_HE: Record<string, string> = {
  floor_plan:      'תוכנית קומה',
  roof_plan:       'תוכנית גג',
  cross_section:   'חתך',
  elevation:       'חזית',
  site_plan:       'תוכנית פיתוח',
  survey:          'מדידה',
  parking_section: 'חנייה',
  index_page:      'תיק מידע',
  area_calculation:'חישוב שטחים',
  other:           'אחר',
  unclassified:    'אחר',
};

const TYPE_PLATE_PREFIX: Record<string, string> = {
  floor_plan: 'PL', roof_plan: 'RF', cross_section: 'SC', elevation: 'EL',
  site_plan: 'ST', survey: 'SV', parking_section: 'PK', index_page: 'IX',
  area_calculation: 'AR', other: 'DR', unclassified: 'DR',
};

const TYPE_TONES: Record<string, 'success' | 'warning' | 'danger' | 'brand' | 'info' | 'neutral'> = {
  floor_plan:      'success',
  roof_plan:       'info',
  cross_section:   'brand',
  elevation:       'warning',
  site_plan:       'success',
  survey:          'danger',
  parking_section: 'info',
  index_page:      'neutral',
  area_calculation:'brand',
  other:           'neutral',
  unclassified:    'neutral',
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
      if (aiSheets.length > 0) return { sheets: aiSheets, isPreview: false };
      const previews = rendered.previews ?? [];
      return { sheets: previews.map(previewToSheet), isPreview: previews.length > 0 };
    }
    return {
      sheets: (rendered as string[]).map((filename, i): SheetRender => ({
        sheet_num: i + 1, filename,
        label_he: filename.replace(/\.[a-z]+$/i, ''),
        label_en: filename.replace(/\.[a-z]+$/i, ''),
        type: 'unclassified', icon: '', scale: null,
        geo_viewport: null, ann_viewport: null,
        pair_score: 0, entity_count: 0, bbox: [0, 0, 0, 0],
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
    <section>
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-5 pb-3 border-b border-border">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted font-latin" dir="ltr">
            {isPreview ? 'Quick Preview' : 'Drawing Sheets'} · <span className="tabular-nums">{sheets.length.toString().padStart(2, '0')}</span>
          </div>
          <h2 className="text-xl font-semibold text-text mt-1">דפי התכנית</h2>
        </div>
        {isPreview && (
          <div className="hidden sm:flex items-center gap-2 text-xs text-brand">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand" />
            </span>
            <span>תוויות AI מתעדכנות…</span>
          </div>
        )}
      </div>

      {/* Filter chips */}
      {types.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <FilterChip active={activeType === 'all'} label="הכול" count={sheets.length} onClick={() => setActiveType('all')} />
          {types.map(t => (
            <FilterChip key={t} active={activeType === t}
              label={TYPE_LABELS_HE[t] || t} count={typeCounts[t]}
              onClick={() => setActiveType(t)} />
          ))}
        </div>
      )}

      {/* Plate grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((sheet) => (
          <SheetPlate
            key={sheet.filename + '-' + sheet.sheet_num}
            sheet={sheet}
            dxfFileId={dxfFileId}
            onOpen={() => setOpenIdx(sheets.indexOf(sheet))}
          />
        ))}
      </div>

      {openIdx != null && (
        <SheetLightbox
          dxfFileId={dxfFileId} sheets={sheets}
          index={openIdx}
          onIndexChange={setOpenIdx}
          onClose={() => setOpenIdx(null)}
        />
      )}
    </section>
  );
}

// ───────────────────────────────────────────────── chip

function FilterChip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-full border transition-colors duration-fast',
        active
          ? 'bg-brand text-white border-brand'
          : 'bg-surface text-text-soft border-border hover:bg-surface-muted hover:text-text',
      )}
    >
      <span className="font-medium">{label}</span>
      <span className={cn(
        'text-xs tabular-nums font-latin px-1.5 py-0.5 rounded-full',
        active ? 'bg-white/20' : 'bg-surface-muted',
      )} dir="ltr">
        {count}
      </span>
    </button>
  );
}

// ───────────────────────────────────────────────── plate

function SheetPlate({ sheet, dxfFileId, onOpen }: { sheet: SheetRender; dxfFileId: string; onOpen: () => void }) {
  const src = `/api/renders/${dxfFileId}/${encodeURIComponent(sheet.filename)}`;
  const [imgError, setImgError] = useState(false);
  const plateCode = `${TYPE_PLATE_PREFIX[sheet.type] || 'DR'}.${String(sheet.sheet_num).padStart(2, '0')}`;
  const tone = TYPE_TONES[sheet.type] || 'neutral';

  return (
    <button
      onClick={onOpen}
      className={cn(
        'group text-right block w-full overflow-hidden',
        'bg-surface border border-border rounded-md shadow-xs',
        'transition-all duration-base',
        'hover:shadow-md hover:-translate-y-0.5 hover:border-brand/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
      )}
    >
      {/* metadata strip */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-alt">
        <span className="font-latin text-[10px] tracking-wider text-text-muted" dir="ltr">{plateCode}</span>
        <Badge tone={tone} size="sm">{TYPE_LABELS_HE[sheet.type] || sheet.type}</Badge>
      </div>

      {/* canvas */}
      <div className="relative aspect-[5/4] bg-white overflow-hidden border-b border-border">
        {!imgError ? (
          <img src={src} alt={sheet.label_he} loading="lazy"
            className="absolute inset-0 w-full h-full object-contain p-3 transition-transform duration-slow group-hover:scale-[1.02]"
            onError={() => setImgError(true)} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
            <FileWarning className="h-6 w-6 mb-2 opacity-60" />
            <span className="text-xs">לא ניתן להציג</span>
          </div>
        )}
      </div>

      {/* footer */}
      <div className="px-3 py-3">
        <div className="text-base font-semibold text-text leading-snug truncate" title={sheet.label_he}>
          {sheet.label_he}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-muted">
          <span className="font-latin tabular-nums" dir="ltr">{sheet.scale || '—'}</span>
          <span className="flex items-center gap-1 font-latin" dir="ltr" title="מקור">
            <Layers className="h-3 w-3" />
            <span className="tabular-nums">
              {sheet.geo_viewport?.replace('VIEWPORT', 'V') || '—'}
              {sheet.ann_viewport && sheet.ann_viewport !== sheet.geo_viewport
                ? ` + ${sheet.ann_viewport.replace('VIEWPORT', 'V')}` : ''}
            </span>
          </span>
        </div>
      </div>

      {/* hover accent */}
      <div className="h-0.5 bg-brand scale-x-0 group-hover:scale-x-100 origin-end transition-transform duration-base" />
    </button>
  );
}

// ───────────────────────────────────────────────── lightbox

function SheetLightbox({
  dxfFileId, sheets, index, onIndexChange, onClose,
}: {
  dxfFileId: string; sheets: SheetRender[]; index: number;
  onIndexChange: (i: number) => void; onClose: () => void;
}) {
  const sheet = sheets[index];
  const src = `/api/renders/${dxfFileId}/${encodeURIComponent(sheet.filename)}`;
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  useEffect(() => { setScale(1); setPan({ x: 0, y: 0 }); }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndexChange(Math.max(0, index - 1));
      if (e.key === 'ArrowLeft')  onIndexChange(Math.min(sheets.length - 1, index + 1));
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

  const tone = TYPE_TONES[sheet.type] || 'neutral';
  const plateCode = `${TYPE_PLATE_PREFIX[sheet.type] || 'DR'}.${String(sheet.sheet_num).padStart(2, '0')}`;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-ink-300"
      style={{ background: 'radial-gradient(ellipse at center, #1a2030 0%, #0a0e16 80%)' }}
      role="dialog"
      aria-modal="true"
    >
      {/* Top toolbar */}
      <header className="relative z-10 flex items-center justify-between gap-4 px-5 py-3 bg-black/40 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-latin text-xs tracking-[0.22em] text-white/70" dir="ltr">{plateCode}</span>
          <span className="h-4 w-px bg-white/15" />
          <h3 className="text-lg sm:text-xl text-white font-semibold truncate">{sheet.label_he}</h3>
          <Badge tone={tone} size="sm">{TYPE_LABELS_HE[sheet.type] || sheet.type}</Badge>
        </div>

        <div className="flex items-center gap-1">
          <span className="hidden sm:inline-block text-[11px] text-white/60 font-latin tabular-nums px-2" dir="ltr">
            {String(index + 1).padStart(2, '0')} / {String(sheets.length).padStart(2, '0')}
          </span>
          <ToolbarButton onClick={() => setScale(s => Math.max(s / 1.25, 0.4))} label="הקטן">
            <Minus className="h-4 w-4" />
          </ToolbarButton>
          <span className="text-[11px] text-white/60 font-latin tabular-nums w-12 text-center" dir="ltr">
            {Math.round(scale * 100)}%
          </span>
          <ToolbarButton onClick={() => setScale(s => Math.min(s * 1.25, 8))} label="הגדל">
            <Plus className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }} label="איפוס">
            <RotateCcw className="h-4 w-4" />
          </ToolbarButton>
          <span className="h-5 w-px bg-white/15 mx-1" />
          <ToolbarButton onClick={onClose} label="סגור">
            <X className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </header>

      {/* Stage */}
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
          className="bg-white shadow-xl relative"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: 'center',
            transition: isDragging ? 'none' : 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)',
            width: 'min(92vw, 1200px)',
            maxHeight: '78vh',
            aspectRatio: '4/3',
          }}
        >
          <img src={src} alt={sheet.label_he}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            draggable={false} />
        </div>

        {/* Prev/next (RTL) */}
        <NavBtn className="end-3" onClick={() => onIndexChange(Math.max(0, index - 1))} disabled={index === 0} aria-label="הקודם">
          <ChevronRight className="h-5 w-5" />
        </NavBtn>
        <NavBtn className="start-3" onClick={() => onIndexChange(Math.min(sheets.length - 1, index + 1))} disabled={index === sheets.length - 1} aria-label="הבא">
          <ChevronLeft className="h-5 w-5" />
        </NavBtn>
      </div>

      {/* Bottom strip */}
      <footer className="relative z-10 px-5 py-2 bg-black/40 backdrop-blur-md border-t border-white/5">
        <div className="flex items-center justify-between text-[11px] text-white/60 font-latin tracking-wider">
          <div className="flex items-center gap-4" dir="ltr">
            <span>SCALE <span className="text-white">{sheet.scale || '—'}</span></span>
            <span>ENTITIES <span className="text-white tabular-nums">{sheet.entity_count.toLocaleString()}</span></span>
            <span className="hidden sm:inline">
              SOURCE <span className="text-white">
                {sheet.geo_viewport || '—'}{sheet.ann_viewport && sheet.ann_viewport !== sheet.geo_viewport ? ` + ${sheet.ann_viewport}` : ''}
              </span>
            </span>
          </div>
          <div className="hidden sm:block text-white/50">SCROLL לזום · גרור להזזה · ESC ליציאה</div>
        </div>
      </footer>
    </div>
  );
}

function ToolbarButton({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-md transition-colors duration-fast"
    >
      {children}
    </button>
  );
}

function NavBtn({ children, onClick, disabled, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      disabled={disabled}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 z-10',
        'h-10 w-10 flex items-center justify-center',
        'bg-black/60 backdrop-blur text-white',
        'border border-white/10 rounded-full',
        'transition-all duration-fast',
        disabled
          ? 'opacity-20 cursor-default'
          : 'hover:bg-brand hover:border-brand hover:scale-110',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
