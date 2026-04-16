import { useState } from 'react';
import { X, Image as ImageIcon } from 'lucide-react';

interface Props {
  dxfFileId: string;
  images: string[];
}

export default function DxfPreview({ dxfFileId, images }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  if (!images?.length) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6">
      <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
        <ImageIcon className="w-4 h-4 text-indigo-600" />
        תצוגה מקדימה של ה-DXF
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {images.map((name) => {
          const src = `/api/renders/${dxfFileId}/${encodeURIComponent(name)}`;
          return (
            <button
              key={name}
              onClick={() => setOpen(src)}
              className="relative aspect-[4/3] rounded-md overflow-hidden bg-[#1e1e2e] border border-slate-200 hover:border-indigo-400 transition"
            >
              <img src={src} alt={name} className="w-full h-full object-contain" loading="lazy" />
              <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-xs py-1 px-2 truncate">
                {name.replace(/\.(png|jpg|jpeg|webp)$/i, '')}
              </div>
            </button>
          );
        })}
      </div>

      {open && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50"
          onClick={() => setOpen(null)}
        >
          <button
            onClick={() => setOpen(null)}
            className="absolute top-4 left-4 text-white bg-white/10 hover:bg-white/20 rounded-full p-2"
          >
            <X className="w-5 h-5" />
          </button>
          <img src={open} alt="preview" className="max-w-[95vw] max-h-[92vh] object-contain" />
        </div>
      )}
    </div>
  );
}
