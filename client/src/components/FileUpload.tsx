import { useRef, useState } from 'react';
import { Upload, CheckCircle2 } from 'lucide-react';

interface Props {
  accept: string;
  label: string;
  currentName?: string | null;
  onUpload: (file: File) => Promise<void>;
}

export default function FileUpload({ accept, label, currentName, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true); setErr(null);
    try { await onUpload(file); }
    catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setErr(msg);
    } finally { setBusy(false); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
          busy ? 'bg-slate-50' : 'hover:bg-slate-50'
        } ${currentName ? 'border-emerald-400' : 'border-slate-300'}`}
      >
        {currentName ? (
          <div className="flex items-center justify-center gap-2 text-emerald-700">
            <CheckCircle2 className="w-5 h-5" />
            <span className="truncate">{currentName}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-slate-500">
            <Upload className="w-6 h-6" />
            <span className="text-sm">{label}</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>
      {busy && <div className="text-xs text-slate-500 mt-2">מעלה…</div>}
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </div>
  );
}
