import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useRoomStore, type Toast } from '@/store/room';

const icons = {
  info: <Info size={16} className="text-accent" />,
  error: <AlertCircle size={16} className="text-danger" />,
  success: <CheckCircle2 size={16} className="text-success" />,
} as const;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useRoomStore((s) => s.dismissToast);
  // Renewal (same-key toast fired again) restarts the auto-dismiss timer.
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 4000);
    return () => clearTimeout(t);
  }, [toast.id, toast.renewedAt, dismiss]);
  return (
    <div className="glass pointer-events-auto flex min-w-0 items-center gap-2.5 rounded-xl px-4 py-3 shadow-xl animate-slide-up">
      {icons[toast.kind]}
      <p className="min-w-0 break-words text-sm">{toast.text}</p>
    </div>
  );
}

/** Non-focus-stealing announcements (aria-live polite). */
export function Toasts() {
  const toasts = useRoomStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-24 left-1/2 z-[110] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
