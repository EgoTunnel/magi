import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-[var(--color-border)] px-8 py-6">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-faint)] font-technical">
            {eyebrow}
          </div>
        )}
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-text)]">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-[var(--color-text-muted)]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "accent" | "ghost" | "danger" }) {
  const base =
    "focus-ring inline-flex items-center justify-center gap-1.5 rounded-[3px] px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none";
  const styles = {
    default:
      "border border-[var(--color-border-strong)] text-[var(--color-text)] bg-[var(--color-bg-raised)] hover:bg-[var(--color-surface-2)]",
    accent: "bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-strong)]",
    ghost: "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]",
    danger: "text-[var(--color-danger)] hover:bg-[var(--color-surface)] border border-transparent hover:border-[var(--color-border)]",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`focus-ring w-full rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[13.5px] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`focus-ring w-full rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[13.5px] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] ${props.className ?? ""}`}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
      {children}
    </label>
  );
}

export function Tag({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" }) {
  return (
    <span
      className={`inline-flex items-center rounded-[3px] border px-1.5 py-0.5 text-[10.5px] font-technical uppercase tracking-[0.06em] ${
        tone === "accent"
          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
          : "border-[var(--color-border)] text-[var(--color-text-faint)]"
      }`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[4px] border border-dashed border-[var(--color-border)] px-8 py-14 text-center">
      <div className="text-[14px] font-medium text-[var(--color-text)]">{title}</div>
      {description && <div className="max-w-sm text-[13px] text-[var(--color-text-muted)]">{description}</div>}
      {action}
    </div>
  );
}
