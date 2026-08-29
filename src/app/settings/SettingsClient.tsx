"use client";

import { useEffect, useState } from "react";
import { Button, Input, Label, Panel } from "@/components/ui";

interface ModelInfo {
  id: string;
  provider: "anthropic" | "openrouter";
  label: string;
  description: string;
  speed: string;
}
interface RoleInfo {
  id: string;
  label: string;
  description: string;
}

const PROVIDER_LABEL: Record<ModelInfo["provider"], string> = {
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
};

export function SettingsClient() {
  const [anthropicKeySet, setAnthropicKeySet] = useState(false);
  const [anthropicKeyPreview, setAnthropicKeyPreview] = useState<string | null>(null);
  const [anthropicInput, setAnthropicInput] = useState("");
  const [savingAnthropic, setSavingAnthropic] = useState(false);

  const [openRouterKeySet, setOpenRouterKeySet] = useState(false);
  const [openRouterKeyPreview, setOpenRouterKeyPreview] = useState<string | null>(null);
  const [openRouterInput, setOpenRouterInput] = useState("");
  const [savingOpenRouter, setSavingOpenRouter] = useState(false);
  const [openRouterModelCount, setOpenRouterModelCount] = useState(0);
  const [openRouterFetchedAt, setOpenRouterFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openRouterError, setOpenRouterError] = useState<string | null>(null);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [crossProjectSearch, setCrossProjectSearch] = useState(true);

  async function loadAll() {
    const [settingsRes, modelsRes] = await Promise.all([fetch("/api/settings"), fetch("/api/models")]);
    const settings = await settingsRes.json();
    const modelsData = await modelsRes.json();
    setAnthropicKeySet(settings.anthropicKeySet);
    setAnthropicKeyPreview(settings.anthropicKeyPreview);
    setOpenRouterKeySet(settings.openRouterKeySet);
    setOpenRouterKeyPreview(settings.openRouterKeyPreview);
    setOpenRouterModelCount(settings.openRouterModelCount);
    setOpenRouterFetchedAt(settings.openRouterModelsFetchedAt);
    setCrossProjectSearch(settings.crossProjectSearchEnabled);
    setModels(modelsData.models);
    setRoles(modelsData.roles);
    setAssignments(modelsData.assignments);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function saveAnthropicKey() {
    setSavingAnthropic(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: anthropicInput }),
    });
    setAnthropicInput("");
    setSavingAnthropic(false);
    loadAll();
  }

  async function removeAnthropicKey() {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: "" }),
    });
    loadAll();
  }

  async function saveOpenRouterKey() {
    setSavingOpenRouter(true);
    setOpenRouterError(null);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openRouterApiKey: openRouterInput }),
    });
    const data = await res.json();
    if (data.openRouterRefreshError) setOpenRouterError(data.openRouterRefreshError);
    setOpenRouterInput("");
    setSavingOpenRouter(false);
    loadAll();
  }

  async function removeOpenRouterKey() {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openRouterApiKey: "" }),
    });
    loadAll();
  }

  async function refreshModels() {
    setRefreshing(true);
    setOpenRouterError(null);
    const res = await fetch("/api/models/refresh", { method: "POST" });
    const data = await res.json();
    if (!data.ok) setOpenRouterError(data.error ?? "Could not refresh the model list.");
    setRefreshing(false);
    loadAll();
  }

  async function assignRole(role: string, modelId: string) {
    setAssignments((a) => ({ ...a, [role]: modelId }));
    await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, modelId }),
    });
  }

  async function toggleCrossProjectSearch() {
    const next = !crossProjectSearch;
    setCrossProjectSearch(next);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crossProjectSearchEnabled: next }),
    });
  }

  const modelsByProvider = {
    anthropic: models.filter((m) => m.provider === "anthropic"),
    openrouter: models.filter((m) => m.provider === "openrouter"),
  };

  return (
    <div className="mx-auto max-w-2xl px-8 py-8 flex flex-col gap-8">
      <section>
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-text)]">Providers</h2>
        <p className="mb-3 text-[13px] text-[var(--color-text-muted)]">
          Keys are stored locally in Magi&apos;s own database on this machine and used only to call each
          provider&apos;s API directly from your local server — never sent anywhere else. Configure as many
          as you like; models from every configured provider show up together below.
        </p>

        <Panel className="mb-3 px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[13.5px] font-medium text-[var(--color-text)]">Anthropic</div>
          </div>
          {anthropicKeySet && (
            <div className="mb-3 flex items-center justify-between text-[13px]">
              <span className="text-[var(--color-text-muted)] font-technical">
                Current key: {anthropicKeyPreview ?? "configured via environment"}
              </span>
              <Button variant="danger" onClick={removeAnthropicKey}>
                Remove
              </Button>
            </div>
          )}
          <Label>API key</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="sk-ant-…"
              value={anthropicInput}
              onChange={(e) => setAnthropicInput(e.target.value)}
            />
            <Button variant="accent" onClick={saveAnthropicKey} disabled={!anthropicInput || savingAnthropic}>
              Save
            </Button>
          </div>
        </Panel>

        <Panel className="px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[13.5px] font-medium text-[var(--color-text)]">OpenRouter</div>
            {openRouterKeySet && (
              <Button variant="ghost" onClick={refreshModels} disabled={refreshing}>
                {refreshing ? "Refreshing…" : "Refresh models"}
              </Button>
            )}
          </div>
          {openRouterKeySet && (
            <div className="mb-3 flex items-center justify-between text-[13px]">
              <span className="text-[var(--color-text-muted)] font-technical">
                Current key: {openRouterKeyPreview ?? "configured via environment"} — {openRouterModelCount} models
                {openRouterFetchedAt ? `, updated ${new Date(openRouterFetchedAt).toLocaleString()}` : ""}
              </span>
              <Button variant="danger" onClick={removeOpenRouterKey}>
                Remove
              </Button>
            </div>
          )}
          {openRouterError && (
            <div className="mb-3 rounded-[4px] border border-[var(--color-danger)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
              {openRouterError}
            </div>
          )}
          <Label>API key</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="sk-or-…"
              value={openRouterInput}
              onChange={(e) => setOpenRouterInput(e.target.value)}
            />
            <Button variant="accent" onClick={saveOpenRouterKey} disabled={!openRouterInput || savingOpenRouter}>
              {savingOpenRouter ? "Saving…" : "Save"}
            </Button>
          </div>
          <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
            OpenRouter&apos;s model catalog is fetched live from their API — nothing is hardcoded here, so it
            stays current as they add and retire models.
          </p>
        </Panel>
      </section>

      <section>
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-text)]">Model roles</h2>
        <p className="mb-3 text-[13px] text-[var(--color-text-muted)]">
          Skills, Councils, Agents, and conversations ask for a role — &quot;the reasoner,&quot; &quot;the
          critic&quot; — rather than a hardcoded model. Reassign a role here and every caller upgrades at
          once, whichever provider it comes from. This is how Magi survives a model becoming obsolete.
        </p>
        <Panel className="divide-y divide-[var(--color-border)]">
          {roles.map((role) => (
            <div key={role.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-[13.5px] font-medium text-[var(--color-text)]">{role.label}</div>
                <div className="text-[12px] text-[var(--color-text-muted)]">{role.description}</div>
              </div>
              <select
                value={assignments[role.id] ?? ""}
                onChange={(e) => assignRole(role.id, e.target.value)}
                className="focus-ring max-w-[220px] rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
              >
                {modelsByProvider.anthropic.length > 0 && (
                  <optgroup label={PROVIDER_LABEL.anthropic}>
                    {modelsByProvider.anthropic.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {modelsByProvider.openrouter.length > 0 && (
                  <optgroup label={PROVIDER_LABEL.openrouter}>
                    {modelsByProvider.openrouter.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          ))}
        </Panel>
      </section>

      <section>
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-text)]">Tools &amp; permissions</h2>
        <p className="mb-3 text-[13px] text-[var(--color-text-muted)]">
          The model can request a tool; Magi&apos;s tool layer is what actually executes it. Magi currently
          offers <span className="font-technical text-[12px]">search_archive</span> and{" "}
          <span className="font-technical text-[12px]">calculator</span> — read-only, no external access.
        </p>
        <Panel className="flex items-center justify-between px-4 py-3.5">
          <div>
            <div className="text-[13.5px] font-medium text-[var(--color-text)]">Cross-Project search</div>
            <div className="text-[12px] text-[var(--color-text-muted)]">
              Let Magi search other Projects when a conversation, Council, or Agent asks for it. Turning
              this off restricts search_archive to the current Project only.
            </div>
          </div>
          <button
            onClick={toggleCrossProjectSearch}
            className="focus-ring relative h-5 w-9 shrink-0 rounded-full border border-[var(--color-border-strong)] transition-colors"
            style={{ background: crossProjectSearch ? "var(--color-accent)" : "var(--color-surface-2)" }}
            aria-pressed={crossProjectSearch}
            aria-label="Toggle cross-Project search"
          >
            <span
              className="absolute top-[1px] h-[17px] w-[17px] rounded-full bg-[var(--color-bg-raised)] transition-transform"
              style={{ transform: crossProjectSearch ? "translateX(17px)" : "translateX(1px)" }}
            />
          </button>
        </Panel>
      </section>

      <section>
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-text)]">About this build</h2>
        <p className="text-[13px] leading-relaxed text-[var(--color-text-muted)]">
          This is an early, working subset of the full Magi vision: Projects, persistent Project
          instructions, streaming conversations with tool use, deliberate memory, full-text archive search,
          reusable Skills, the Magi Council, Agents that pursue an objective across multiple steps, an
          Image Lab with Style Guides and Characters for visual continuity, and Project export/import.
          Model support covers Anthropic directly and every model OpenRouter proxies; the provider layer is
          built to add more without touching the rest of the app. Cross-Project connection discovery is
          architected for but not yet built.
        </p>
      </section>
    </div>
  );
}
