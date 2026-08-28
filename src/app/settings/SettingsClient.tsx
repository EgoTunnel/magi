"use client";

import { useEffect, useState } from "react";
import { Button, Input, Label, Panel } from "@/components/ui";

interface ModelInfo {
  id: string;
  label: string;
  description: string;
  speed: string;
}
interface RoleInfo {
  id: string;
  label: string;
  description: string;
}

export function SettingsClient() {
  const [keySet, setKeySet] = useState(false);
  const [keyPreview, setKeyPreview] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  async function loadAll() {
    const [settingsRes, modelsRes] = await Promise.all([fetch("/api/settings"), fetch("/api/models")]);
    const settings = await settingsRes.json();
    const modelsData = await modelsRes.json();
    setKeySet(settings.anthropicKeySet);
    setKeyPreview(settings.anthropicKeyPreview);
    setModels(modelsData.models);
    setRoles(modelsData.roles);
    setAssignments(modelsData.assignments);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function saveKey() {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: apiKeyInput }),
    });
    setApiKeyInput("");
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    loadAll();
  }

  async function removeKey() {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: "" }),
    });
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

  return (
    <div className="mx-auto max-w-2xl px-8 py-8 flex flex-col gap-8">
      <section>
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-text)]">Anthropic API key</h2>
        <p className="mb-3 text-[13px] text-[var(--color-text-muted)]">
          Stored locally in Magi&apos;s own database on this machine. It is used only to call Anthropic&apos;s
          API directly from your local server — never sent anywhere else.
        </p>
        <Panel className="px-4 py-4">
          {keySet && (
            <div className="mb-3 flex items-center justify-between text-[13px]">
              <span className="text-[var(--color-text-muted)] font-technical">
                Current key: {keyPreview ?? "configured via environment"}
              </span>
              <Button variant="danger" onClick={removeKey}>
                Remove
              </Button>
            </div>
          )}
          <Label>New API key</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="sk-ant-…"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
            <Button variant="accent" onClick={saveKey} disabled={!apiKeyInput || saving}>
              {saved ? "Saved" : "Save"}
            </Button>
          </div>
        </Panel>
      </section>

      <section>
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-text)]">Model roles</h2>
        <p className="mb-3 text-[13px] text-[var(--color-text-muted)]">
          Skills, Councils, and conversations ask for a role — &quot;the reasoner,&quot; &quot;the
          critic&quot; — rather than a hardcoded model. Reassign a role here and every caller upgrades at
          once. This is how Magi survives a model becoming obsolete.
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
                className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </Panel>
      </section>

      <section>
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-text)]">About this build</h2>
        <p className="text-[13px] leading-relaxed text-[var(--color-text-muted)]">
          This is an early, working subset of the full Magi vision: Projects, persistent Project
          instructions, streaming conversations, deliberate memory, full-text archive search, reusable
          Skills, and the Magi Council. Model support currently covers Anthropic; the provider layer is
          built to add others without touching the rest of the app. Agents, the full Image Studio, and
          import/export are architected for but not yet built.
        </p>
      </section>
    </div>
  );
}
