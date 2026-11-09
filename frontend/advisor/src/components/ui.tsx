import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useTranslation } from "@have/shared/i18n";
import { ApiError } from "@have/shared/api";

export function Input({
  label,
  ...props
}: ComponentProps<"input"> & { label: string }) {
  const { t } = useTranslation("advisor");
  return (
    <label className="advisor-field">
      <span>{t(label)}</span>
      <input {...props} />
    </label>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <p className="advisor-error" role="alert">
      {message}
    </p>
  ) : null;
}
export function useOperation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run<T>(work: () => Promise<T>, success?: (value: T) => void) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await work();
      if (mounted.current) success?.(value);
      return value;
    } catch (failure) {
      if (
        mounted.current &&
        !(failure instanceof DOMException && failure.name === "AbortError")
      )
        setError(
          failure instanceof ApiError
            ? [failure.message, ...Object.values(failure.fields)].join(" ")
            : "The request could not be completed.",
        );
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation("advisor");
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.isConnected && previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="advisor-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label={t("close")} onClick={close}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export async function downloadBlob(work: Promise<Blob>, name: string) {
  const blob = await work,
    url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
