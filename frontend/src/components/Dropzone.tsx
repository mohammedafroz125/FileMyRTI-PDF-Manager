import { useRef, useState, type DragEvent } from "react";
import { UploadCloud } from "lucide-react";

type Props = {
  label: string;
  hint: string;
  multiple?: boolean;
  accept: string;
  onFiles: (files: File[]) => void;
};

export function Dropzone({ label, hint, multiple, accept, onFiles }: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
        over
          ? "border-blue-500 bg-blue-50/80 shadow-md scale-[1.01]"
          : "border-slate-200 bg-slate-50/50 hover:border-blue-400 hover:bg-blue-50/30 hover:shadow-sm"
      }`}
    >
      <div className="mb-3 rounded-2xl bg-blue-50 p-3.5 text-blue-600 border border-blue-100 shadow-sm group-hover:scale-110 group-hover:-translate-y-1 transition-all duration-300">
        <UploadCloud className="h-7 w-7 text-blue-600 group-hover:animate-pulse" />
      </div>
      <p className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight">{label}</p>
      <p className="mt-1 text-[11px] text-slate-500 font-medium">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
