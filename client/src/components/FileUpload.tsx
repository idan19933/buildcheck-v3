import { useRef, useState } from 'react';
import { Upload, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

interface Props {
  accept: string;
  label: string;
  currentName?: string | null;
  onUpload: (file: File) => Promise<void>;
}

export default function FileUpload({ accept, label, currentName, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      await onUpload(file);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'העלאה נכשלה';
      toast.error(msg);
    } finally { setBusy(false); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'w-full border-2 border-dashed rounded-md p-8 text-center cursor-pointer transition-all duration-base',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
        dragging && 'border-brand bg-brand-soft scale-[1.01]',
        !dragging && currentName && 'border-success bg-success-soft/40',
        !dragging && !currentName && 'border-border hover:border-brand hover:bg-surface-muted',
        busy && 'opacity-70 pointer-events-none',
      )}
    >
      {busy ? (
        <div className="flex flex-col items-center gap-2 text-text-soft">
          <Loader2 className="h-7 w-7 animate-spin text-brand" />
          <span className="text-sm">מעלה…</span>
        </div>
      ) : currentName ? (
        <div className="flex flex-col items-center gap-2">
          <CheckCircle2 className="h-7 w-7 text-success" />
          <span className="text-sm font-medium text-text truncate max-w-full" title={currentName}>
            {currentName}
          </span>
          <span className="text-xs text-text-soft">לחץ כדי להחליף קובץ</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-text-soft">
          <Upload className="h-7 w-7 text-text-muted" />
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-text-muted font-latin" dir="ltr">{accept}</span>
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
    </button>
  );
}
