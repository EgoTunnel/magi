"use client";

import { useEffect, useState } from "react";
import { Button, Input, Label, Panel } from "@/components/ui";

interface ModelInfo {
  id: string;
  provider: "anthropic" | "openrouter";
  label: string;
  description: string;
  speed: string;
  supportsTools?: boolean;
}
interface RoleInfo {
  id: string;
  label: string;
  description: string;
}
interface SpendTotals {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  hasUnpricedEvents: boolean;
}
interface ModelSpend extends SpendTotals {
  provider: string;
  model: string;
}
interface AnthropicModelPrice {
  promptPerM: number;
  completionPerM: number;
}
interface EmbeddingModelInfo {
  id: string;
  label: string;
  description: string;
}
interface BackfillStatus {
  status: "idle" | "running" | "complete" | "error";
  processed: number;
  total: number;
  model: string | null;
  error?: string;
}

function formatCost(totals: SpendTotals): string {
  if (totals.costUsd === 0 && totals.hasUnpricedEvents) return "unpriced";
  const value = `$${totals.costUsd.toFixed(totals.costUsd < 1 ? 4 : 2)}`;
  return totals.hasUnpricedEvents ? `${value}+` : value;
}

function formatTokens(totals: SpendTotals): string {
  return `${(totals.promptTokens + totals.completionTokens).toLocaleString()} tokens`;
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
  const [reasoningEfforts, setReasoningEfforts] = useState<string[]>([]);
  const [effortAssignments, setEffortAssignments] = useState<Record<string, string>>({});
  const [crossProjectSearch, setCrossProjectSearch] = useState(true);
  const [toolsList, setToolsList] = useState<{ name: string; description: string }[]>([]);
  const [disabledTools, setDisabledToolsState] = useState<string[]>([]);

  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModelInfo[]>([]);
  const [embeddingModelId, setEmbeddingModelIdState] = useState<string | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus | null>(null);
  const [savingEmbeddingModel, setSavingEmbeddingModel] = useState(false);

  const [allTimeSpend, setAllTimeSpend] = useState<SpendTotals | null>(null);
  const [todaySpend, setTodaySpend] = useState<SpendTotals | null>(null);
  const [spendByModel, setSpendByModel] = useState<ModelSpend[]>([]);
  const [anthropicPricing, setAnthropicPricingState] = useState<Record<string, AnthropicModelPrice>>({});
  const [savingPricing, setSavingPricing] = useState(false);

  async function loadAll() {
    const [settingsRes, modelsRes, usageRes, embeddingModelsRes, backfillRes] = await Promise.all([
      fetch("/api/settings"),
      fetch("/api/models"),
      fetch("/api/usage"),
      fetch("/api/embedding-models"),
      fetch("/api/embeddings/backfill"),
    ]);
    const settings = await settingsRes.json();
    const modelsData = await modelsRes.json();
    const usage = await usageRes.json();
    const embeddingModelsData = await embeddingModelsRes.json();
    const backfill = await backfillRes.json();
    setAnthropicKeySet(settings.anthropicKeySet);
    setAnthropicKeyPreview(settings.anthropicKeyPreview);
    setOpenRouterKeySet(settings.openRouterKeySet);
    setOpenRouterKeyPreview(settings.openRouterKeyPreview);
    setOpenRouterModelCount(settings.openRouterModelCount);
    setOpenRouterFetchedAt(settings.openRouterModelsFetchedAt);
    setCrossProjectSearch(settings.crossProjectSearchEnabled);
    setEmbeddingModelIdState(settings.embeddingModelId);
    setToolsList(settings.tools ?? []);
    setDisabledToolsState(settings.disabledTools ?? []);
    setModels(modelsData.models);
    setRoles(modelsData.roles);
    setAssignments(modelsData.assignments);
    setReasoningEfforts(modelsData.reasoningEfforts ?? []);
    setEffortAssignments(modelsData.reasoningEffortAssignments ?? {});
    setEmbeddingModels(embeddingModelsData.models ?? []);
    setBackfillStatus(backfill.status ?? null);
    setAllTimeSpend(usage.allTime);
    setTodaySpend(usage.today);
    setSpendByModel(usage.byModel);
    setAnthropicPricingState(usage.anthropicPricing);
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

  async function assignEffort(role: string, effort: string) {
    setEffortAssignments((a) => ({ ...a, [role]: effort }));
    await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, reasoningEffort: effort }),
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

  async function toggleTool(name: string) {
    const next = disabledTools.includes(name) ? disabledTools.filter((t) => t !== name) : [...disabledTools, name];
    setDisabledToolsState(next);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabledTools: next }),
    });
  }

  async function saveEmbeddingModel(modelId: string) {
    setSavingEmbeddingModel(true);
    setEmbeddingModelIdState(modelId);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeddingModelId: modelId }),
    });
    setSavingEmbeddingModel(false);
  }

  async function startBackfill() {
    const res = await fetch("/api/embeddings/backfill", { method: "POST" });
    const data = await res.json();
    if (data.ok) setBackfillStatus({ status: "running", processed: 0, total: 0, model: embeddingModelId });
  }

  // Poll while a backfill is actually running — same cadence as the Agent/
  // Connection run viewers elsewhere in the app.
  useEffect(() => {
    if (backfillStatus?.status !== "running") return;
    const handle = setInterval(async () => {
      const res = await fetch("/api/embeddings/backfill");
      const data = await res.json();
      setBackfillStatus(data.status ?? null);
    }, 2000);
    return () => clearInterval(handle);
  }, [backfillStatus?.status]);

  function setAnthropicPrice(modelId: string, field: keyof AnthropicModelPrice, value: string) {
    const parsed = parseFloat(value);
    setAnthropicPricingState((prev) => ({
      ...prev,
      [modelId]: { ...(prev[modelId] ?? { promptPerM: 0, completionPerM: 0 }), [field]: Number.isNaN(parsed) ? 0 : parsed },
    }));
  }

  async function saveAnthropicPricing() {
    setSavingPricing(true);
    await fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicPricing }),
    });
    setSavingPricing(false);
    loadAll();
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
          Reasoning effort only applies to OpenRouter models and is automatically adjusted to whatever the
          assigned model actually supports; Anthropic&apos;s API has no equivalent control here.
        </p>
        <Panel className="divide-y divide-[var(--color-border)]">
          {roles.map((role) => (
            <div key={role.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <div className="text-[13.5px] font-medium text-[var(--color-text)]">{role.label}</div>
                <div className="text-[12px] text-[var(--color-text-muted)]">{role.description}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  // "low" is the provider-level implicit default for a role
                  // with no explicit override — pre-select it so the dropdown
                  // never shows "None" for a role nobody's actually touched
                  // (browsers default an unmatched value to the first option).
                  value={effortAssignments[role.id] ?? "low"}
                  onChange={(e) => assignEffort(role.id, e.target.value)}
                  className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
                >
                  {reasoningEfforts.map((e) => (
                    <option key={e} value={e}>
                      {e[0].toUpperCase() + e.slice(1)}
                    </option>
                  ))}
                </select>
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
                          {m.supportsTools === false ? " — no tool use" : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>
          ))}
        </Panel>
      </section>

      <section>
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-text)]">Tools &amp; permissions</h2>
        <p className="mb-3 text-[13px] text-[var(--color-text-muted)]">
          The model can request a tool; Magi&apos;s tool layer is what actually executes it — read-only, no
          external access. Turning one off here applies everywhere: conversations, Agents, Councils, and
          Connections. Skills and individual Agent runs can narrow this further, but never widen past it.
        </p>
        <Panel className="mb-3 divide-y divide-[var(--color-border)]">
          {toolsList.map((t) => {
            const enabled = !disabledTools.includes(t.name);
            return (
              <div key={t.name} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-[var(--color-text)] font-technical">{t.name}</div>
                  <div className="truncate text-[12px] text-[var(--color-text-muted)]">{t.description}</div>
                </div>
                <button
                  onClick={() => toggleTool(t.name)}
                  className="focus-ring relative h-5 w-9 shrink-0 rounded-full border border-[var(--color-border-strong)] transition-colors"
                  style={{ background: enabled ? "var(--color-accent)" : "var(--color-surface-2)" }}
                  aria-pressed={enabled}
                  aria-label={`Toggle ${t.name}`}
                >
                  <span
                    className="absolute top-[1px] h-[17px] w-[17px] rounded-full bg-[var(--color-bg-raised)] transition-transform"
                    style={{ transform: enabled ? "translateX(17px)" : "translateX(1px)" }}
                  />
                </button>
              </div>
            );
          })}
        </Panel>
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
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-text)]">Semantic search</h2>
        <p className="mb-3 text-[13px] text-[var(--color-text-muted)]">
          Lets the Archive page search by meaning, not just wording. Anthropic has no embeddings API,
          so — same as the Image Lab — this requires an OpenRouter key specifically. OpenRouter
          doesn&apos;t list embedding models in its regular catalog, so this is a short, hand-picked
          selection rather than the live dropdown used elsewhere.
        </p>
        {!openRouterKeySet ? (
          <Panel className="px-4 py-3.5 text-[13px] text-[var(--color-text-muted)]">
            Add an OpenRouter key above to enable semantic search.
          </Panel>
        ) : (
          <Panel className="px-4 py-4">
            <Label>Embedding model</Label>
            <select
              value={embeddingModelId ?? ""}
              onChange={(e) => saveEmbeddingModel(e.target.value)}
              disabled={savingEmbeddingModel}
              className="focus-ring w-full rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[13.5px] text-[var(--color-text)]"
            >
              <option value="" disabled>
                Choose a model…
              </option>
              {embeddingModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
              Switching models doesn&apos;t lose anything already indexed — it just goes unused until you
              switch back, or you rebuild the index for the new model.
            </p>

            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[13.5px] font-medium text-[var(--color-text)]">Index</div>
                <Button
                  variant="accent"
                  onClick={startBackfill}
                  disabled={!embeddingModelId || backfillStatus?.status === "running"}
                >
                  {backfillStatus?.status === "running" ? "Building…" : "Build index"}
                </Button>
              </div>
              {backfillStatus?.status === "running" && (
                <div className="text-[12.5px] text-[var(--color-text-muted)] font-technical">
                  {backfillStatus.processed} / {backfillStatus.total} embedded
                </div>
              )}
              {backfillStatus?.status === "complete" && (
                <div className="text-[12.5px] text-[var(--color-text-muted)]">
                  Up to date — {backfillStatus.processed} item(s) indexed for the current model.
                </div>
              )}
              {backfillStatus?.status === "error" && (
                <div className="text-[12.5px] text-[var(--color-danger)]">
                  {backfillStatus.error === "NO_EMBEDDING_MODEL"
                    ? "Choose an embedding model above first."
                    : `Index build failed: ${backfillStatus.error}`}
                </div>
              )}
              <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
                New and edited content is embedded automatically going forward. Build the index once to
                cover everything that already existed, or after switching models.
              </p>
            </div>
          </Panel>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-text)]">Usage &amp; cost</h2>
        <p className="mb-3 text-[13px] text-[var(--color-text-muted)]">
          Every model call — conversations, Agents, Councils, Connections, and archive questions — is
          logged with its token counts. Cost is computed automatically for OpenRouter models from their
          own live pricing catalog; Anthropic doesn&apos;t expose pricing via API, so its cost only appears
          once you enter a rate below.
        </p>
        <Panel className="mb-3 flex divide-x divide-[var(--color-border)]">
          <div className="flex-1 px-4 py-3.5">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-faint)]">All time</div>
            <div className="mt-1 text-[16px] font-semibold text-[var(--color-text)] font-technical">
              {allTimeSpend ? formatCost(allTimeSpend) : "—"}
            </div>
            <div className="text-[12px] text-[var(--color-text-muted)]">{allTimeSpend ? formatTokens(allTimeSpend) : ""}</div>
          </div>
          <div className="flex-1 px-4 py-3.5">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-faint)]">Today</div>
            <div className="mt-1 text-[16px] font-semibold text-[var(--color-text)] font-technical">
              {todaySpend ? formatCost(todaySpend) : "—"}
            </div>
            <div className="text-[12px] text-[var(--color-text-muted)]">{todaySpend ? formatTokens(todaySpend) : ""}</div>
          </div>
        </Panel>

        {spendByModel.length > 0 && (
          <Panel className="mb-3 divide-y divide-[var(--color-border)]">
            {spendByModel.map((m) => (
              <div key={`${m.provider}:${m.model}`} className="flex items-center justify-between gap-4 px-4 py-2.5 text-[13px]">
                <span className="truncate text-[var(--color-text)] font-technical">{m.model}</span>
                <span className="shrink-0 text-[var(--color-text-muted)]">
                  {formatTokens(m)} · {formatCost(m)}
                </span>
              </div>
            ))}
          </Panel>
        )}

        {modelsByProvider.anthropic.length > 0 && (
          <Panel className="px-4 py-4">
            <div className="mb-3 text-[13.5px] font-medium text-[var(--color-text)]">Anthropic pricing (optional)</div>
            <p className="mb-3 text-[12px] text-[var(--color-text-muted)]">
              Dollars per million tokens, from your Anthropic rate card. Leave a model blank to keep
              showing its tokens without a cost.
            </p>
            <div className="flex flex-col gap-2.5">
              {modelsByProvider.anthropic.map((m) => (
                <div key={m.id} className="flex items-center gap-2.5">
                  <span className="w-40 shrink-0 truncate text-[12.5px] text-[var(--color-text-muted)]">{m.label}</span>
                  <Input
                    type="number"
                    placeholder="$/M in"
                    value={anthropicPricing[m.id]?.promptPerM ?? ""}
                    onChange={(e) => setAnthropicPrice(m.id, "promptPerM", e.target.value)}
                  />
                  <Input
                    type="number"
                    placeholder="$/M out"
                    value={anthropicPricing[m.id]?.completionPerM ?? ""}
                    onChange={(e) => setAnthropicPrice(m.id, "completionPerM", e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Button variant="accent" onClick={saveAnthropicPricing} disabled={savingPricing}>
                {savingPricing ? "Saving…" : "Save pricing"}
              </Button>
            </div>
          </Panel>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-text)]">About this build</h2>
        <p className="text-[13px] leading-relaxed text-[var(--color-text-muted)]">
          This is a working subset of the full Magi vision: Projects, persistent Project instructions,
          streaming conversations with tool use and automatic model selection, deliberate memory,
          full-text and semantic archive search, reusable Skills with per-Skill tool permissions, the
          Magi Council in Independent Analysis, Debate, or Red Team mode, Agents that pursue an
          objective across multiple steps with per-run tool permissions, an Image Lab with Style Guides
          and Characters for visual continuity, cross-Project
          connection discovery, Project export/import (including ingesting a ChatGPT or Claude data
          export), usage &amp; cost tracking across every model call, and per-role reasoning-effort
          control. Model support covers Anthropic directly and every model OpenRouter proxies; the
          provider layer is built to add more without touching the rest of the app.
        </p>
      </section>
    </div>
  );
}
