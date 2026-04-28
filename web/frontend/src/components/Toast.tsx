import { useEffect } from "react";

export type ToastKind = "info" | "success" | "error";

export interface ToastMessage {
  kind: ToastKind;
  text: string;
}

interface Props {
  toast: ToastMessage | null;
  onClose: () => void;
}

export function Toast({ toast, onClose }: Props) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, toast.kind === "error" ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  if (!toast) return null;
  return <div className={`toast ${toast.kind}`}>{toast.text}</div>;
}
