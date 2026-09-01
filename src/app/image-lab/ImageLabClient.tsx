"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Input, Label, Panel, Tag, Textarea } from "@/components/ui";
import { IconAttach, IconEdit, IconPlus, IconTrash } from "@/components/icons";
import { arrayBufferToBase64 } from "@/lib/clientFiles";
import { MagiSpinner } from "@/components/MagiSpinner";

interface Project {
  id: string;
  name: string;
}
interface StyleGuide {
  id: string;
  name: string;
  description: string;
}
interface Character {
  id: string;
  name: string;
  description: string;
  reference_image_id: string | null;
}
interface GeneratedImage {
  id: string;
  prompt: string;
  model: string;
  style_guide_id: string | null;
  character_ids: string[];
  source_image_id: string | null;
  created_at: string;
}
interface ImageModel {
  id: string;
  label: string;
  description: string;
  editsImages: boolean;
}

export function ImageLabClient() {
  const router = useRouter();
  // Read the ?project= query param on the client only, rather than via
  // next/navigation's useSearchParams(): that hook requires a Suspense
  // boundary, and Suspense + SSR streaming got stuck (rendered but never
  // revealed) on a fresh hard load of a URL that already had the param —
  // reliably, reproducibly, with client-side navigation to the same state
  // unaffected. This sidesteps it rather than fighting it.
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    setProjectId(new URLSearchParams(window.location.search).get("project"));
  }, []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [modelsConfigured, setModelsConfigured] = useState(true);
  const [styleGuides, setStyleGuides] = useState<StyleGuide[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [images, setImages] = useState<GeneratedImage[]>([]);

  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [styleGuideId, setStyleGuideId] = useState("");
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [sourceImage, setSourceImage] = useState<GeneratedImage | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [styleFormOpen, setStyleFormOpen] = useState(false);
  const [styleName, setStyleName] = useState("");
  const [styleDescription, setStyleDescription] = useState("");

  const [charFormOpen, setCharFormOpen] = useState(false);
  const [charName, setCharName] = useState("");
  const [charDescription, setCharDescription] = useState("");
  const [charPhotoFile, setCharPhotoFile] = useState<File | null>(null);
  const [creatingCharacter, setCreatingCharacter] = useState(false);
  const newCharPhotoInputRef = useRef<HTMLInputElement>(null);

  const [uploadPhotoForCharId, setUploadPhotoForCharId] = useState<string | null>(null);
  const [uploadingCharPhoto, setUploadingCharPhoto] = useState(false);
  const existingCharPhotoInputRef = useRef<HTMLInputElement>(null);

  const [editingCharId, setEditingCharId] = useState<string | null>(null);
  const [editCharName, setEditCharName] = useState("");
  const [editCharDescription, setEditCharDescription] = useState("");
  const [savingCharEdit, setSavingCharEdit] = useState(false);

  const [assigningRefFor, setAssigningRefFor] = useState<string | null>(null);
  const [viewingImage, setViewingImage] = useState<GeneratedImage | null>(null);

  const [newProjectFormOpen, setNewProjectFormOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const [uploadingToProject, setUploadingToProject] = useState(false);
  const [projectUploadError, setProjectUploadError] = useState<string | null>(null);
  const [projectUploadNote, setProjectUploadNote] = useState<string | null>(null);
  const projectUploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects));
    fetch("/api/image-models")
      .then((r) => r.json())
      .then((d) => {
        setImageModels(d.models);
        setModelsConfigured(d.configured);
        if (d.models.length) setModelId((m) => m || d.models[0].id);
      });
  }, []);

  async function loadProjectData() {
    if (!projectId) return;
    const [sgRes, chRes, imgRes] = await Promise.all([
      fetch(`/api/style-guides?projectId=${projectId}`),
      fetch(`/api/characters?projectId=${projectId}`),
      fetch(`/api/images?projectId=${projectId}`),
    ]);
    setStyleGuides((await sgRes.json()).styleGuides);
    setCharacters((await chRes.json()).characters);
    setImages((await imgRes.json()).images);
  }

  useEffect(() => {
    loadProjectData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function selectProject(id: string) {
    setProjectId(id);
    router.push(`/image-lab?project=${id}`);
  }

  async function createProject() {
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProjectName }),
    });
    const data = await res.json();
    setCreatingProject(false);
    setNewProjectName("");
    setNewProjectFormOpen(false);
    setProjects((prev) => [...prev, data.project]);
    selectProject(data.project.id);
  }

  async function generate() {
    if (!projectId || !prompt.trim() || !modelId) return;
    setGenerating(true);
    setGenError(null);
    const res = await fetch("/api/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        prompt,
        modelId,
        styleGuideId: styleGuideId || undefined,
        characterIds: selectedCharacterIds,
        sourceImageId: sourceImage?.id,
      }),
    });
    const data = await res.json();
    setGenerating(false);
    if (!res.ok) {
      setGenError(data.message ?? data.error ?? "Generation failed.");
      return;
    }
    setPrompt("");
    setSourceImage(null);
    loadProjectData();
  }

  async function createStyleGuide() {
    if (!projectId || !styleName.trim()) return;
    await fetch("/api/style-guides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name: styleName, description: styleDescription }),
    });
    setStyleName("");
    setStyleDescription("");
    setStyleFormOpen(false);
    loadProjectData();
  }

  async function removeStyleGuide(id: string) {
    await fetch(`/api/style-guides/${id}`, { method: "DELETE" });
    loadProjectData();
  }

  // Shared by every image-upload path on this page (a character's reference
  // photo, or the general Project upload shortcut) — base64-encodes the file
  // and posts it to /api/images/upload, which stores it in the same table
  // and directory as an AI generation, just tagged source: "uploaded".
  async function uploadImageFile(file: File): Promise<{ id: string } | null> {
    if (!projectId) return null;
    const dataBase64 = arrayBufferToBase64(await file.arrayBuffer());
    const res = await fetch("/api/images/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, filename: file.name, mimeType: file.type, dataBase64 }),
    });
    if (!res.ok) return null;
    return (await res.json()).image;
  }

  async function createCharacter() {
    if (!projectId || !charName.trim()) return;
    setCreatingCharacter(true);
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name: charName, description: charDescription }),
    });
    const data = await res.json();
    if (charPhotoFile && data.character) {
      const image = await uploadImageFile(charPhotoFile);
      if (image) {
        await fetch(`/api/characters/${data.character.id}/reference-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageId: image.id }),
        });
      }
    }
    setCreatingCharacter(false);
    setCharName("");
    setCharDescription("");
    setCharPhotoFile(null);
    setCharFormOpen(false);
    loadProjectData();
  }

  async function handleExistingCharPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const characterId = uploadPhotoForCharId;
    setUploadPhotoForCharId(null);
    if (!file || !characterId) return;
    setUploadingCharPhoto(true);
    const image = await uploadImageFile(file);
    if (image) await assignReferenceImage(characterId, image.id);
    setUploadingCharPhoto(false);
  }

  async function handleProjectUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !projectId) return;
    setUploadingToProject(true);
    setProjectUploadError(null);
    setProjectUploadNote(null);
    try {
      const isImage = file.type.startsWith("image/");
      if (isImage) {
        const image = await uploadImageFile(file);
        if (!image) {
          setProjectUploadError("Upload failed.");
          return;
        }
        setProjectUploadNote(`Added "${file.name}" to the gallery.`);
        loadProjectData();
      } else {
        const dataBase64 = arrayBufferToBase64(await file.arrayBuffer());
        const res = await fetch("/api/documents/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, filename: file.name, mimeType: file.type, dataBase64 }),
        });
        const data = await res.json();
        if (!res.ok) {
          setProjectUploadError(data.error ?? "Upload failed.");
          return;
        }
        setProjectUploadNote(`Added "${file.name}" to Project documents.`);
      }
    } finally {
      setUploadingToProject(false);
    }
  }

  async function removeCharacter(id: string) {
    await fetch(`/api/characters/${id}`, { method: "DELETE" });
    loadProjectData();
  }

  function startEditCharacter(c: Character) {
    setEditingCharId(c.id);
    setEditCharName(c.name);
    setEditCharDescription(c.description);
  }

  async function saveCharacterEdit() {
    if (!editingCharId || !editCharName.trim()) return;
    setSavingCharEdit(true);
    await fetch(`/api/characters/${editingCharId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editCharName, description: editCharDescription }),
    });
    setSavingCharEdit(false);
    setEditingCharId(null);
    loadProjectData();
  }

  async function assignReferenceImage(characterId: string, imageId: string) {
    await fetch(`/api/characters/${characterId}/reference-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId }),
    });
    setAssigningRefFor(null);
    loadProjectData();
  }

  async function removeImage(id: string) {
    await fetch(`/api/images/${id}`, { method: "DELETE" });
    if (viewingImage?.id === id) setViewingImage(null);
    loadProjectData();
  }

  function toggleCharacter(id: string) {
    setSelectedCharacterIds((ids) => (ids.includes(id) ? ids.filter((c) => c !== id) : [...ids, id]));
  }

  if (!projectId) {
    return (
      <div className="mx-auto max-w-md px-8 py-16 text-center">
        <p className="mb-4 text-[13.5px] text-[var(--color-text-muted)]">
          Choose a Project to work in. Characters, Style Guides, and generated images all belong
          to one, same as everything else here.
        </p>
        {projects.length === 0 && !newProjectFormOpen && (
          <EmptyState
            title="No Projects yet"
            description="Create one first, then come back here."
            action={
              <Button variant="accent" onClick={() => setNewProjectFormOpen(true)}>
                <IconPlus /> New Project
              </Button>
            }
          />
        )}
        {projects.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProject(p.id)}
                className="focus-ring rounded-[4px] border border-[var(--color-border)] px-4 py-2.5 text-left text-[13.5px] text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        {newProjectFormOpen ? (
          <div className="mt-3 flex items-center gap-2">
            <Input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
              placeholder="New Project name"
            />
            <Button variant="accent" onClick={createProject} disabled={!newProjectName.trim() || creatingProject}>
              Create
            </Button>
            <Button variant="ghost" onClick={() => setNewProjectFormOpen(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          projects.length > 0 && (
            <Button variant="ghost" className="mt-3" onClick={() => setNewProjectFormOpen(true)}>
              <IconPlus /> New Project
            </Button>
          )
        )}
      </div>
    );
  }

  const selectedModel = imageModels.find((m) => m.id === modelId);
  const hasReferenceImages =
    !!sourceImage || selectedCharacterIds.some((id) => characters.find((c) => c.id === id)?.reference_image_id);
  const modelIgnoresReferences = !!selectedModel && !selectedModel.editsImages && hasReferenceImages;

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-8 py-7 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-6">
        {/* Generation panel */}
        <Panel className="px-5 py-5">
          <div className="mb-3 flex items-center gap-2">
            <select
              value={projectId}
              onChange={(e) => selectProject(e.target.value)}
              className="focus-ring rounded-[3px] border border-[var(--color-border)] bg-[var(--color-bg-raised)] px-2 py-1 text-[11.5px] text-[var(--color-text-muted)]"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {newProjectFormOpen ? (
              <>
                <Input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createProject()}
                  placeholder="New Project name"
                  className="h-7 max-w-[180px] py-0.5 text-[11.5px]"
                />
                <Button variant="accent" onClick={createProject} disabled={!newProjectName.trim() || creatingProject}>
                  Create
                </Button>
                <Button variant="ghost" onClick={() => setNewProjectFormOpen(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setNewProjectFormOpen(true)}>
                <IconPlus /> New Project
              </Button>
            )}
            <input
              ref={projectUploadInputRef}
              type="file"
              accept=".pdf,.docx,.pptx,.txt,.md,.csv,.json,image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleProjectUpload}
            />
            <Button variant="ghost" onClick={() => projectUploadInputRef.current?.click()} disabled={uploadingToProject}>
              <IconAttach /> {uploadingToProject ? "Uploading…" : "Upload to Project"}
            </Button>
          </div>
          {(projectUploadError || projectUploadNote) && (
            <div
              className={`mb-3 rounded-[4px] border px-3 py-2 text-[12px] ${
                projectUploadError
                  ? "border-[var(--color-danger)] text-[var(--color-danger)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)]"
              }`}
            >
              {projectUploadError ?? projectUploadNote}
            </div>
          )}

          {!modelsConfigured && (
            <div className="mb-3 rounded-[4px] border border-[var(--color-accent)] bg-[var(--color-bg)] px-4 py-3 text-[13px] text-[var(--color-text)]">
              No OpenRouter key configured — image generation runs through OpenRouter.{" "}
              <Link href="/settings" className="text-[var(--color-accent)] underline">
                Open Settings
              </Link>
            </div>
          )}
          {modelsConfigured && imageModels.length === 0 && (
            <div className="mb-3 text-[12.5px] text-[var(--color-text-faint)]">
              No image-capable models found yet — try Refresh models in Settings.
            </div>
          )}

          {sourceImage && (
            <div className="mb-3 flex items-center gap-2 rounded-[3px] border border-[var(--color-border)] px-2.5 py-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/images/${sourceImage.id}/file`} alt="" className="h-8 w-8 rounded-[2px] object-cover" />
              <span className="text-[11.5px] text-[var(--color-text-muted)]">Creating a variation of this image</span>
              <button onClick={() => setSourceImage(null)} className="ml-auto text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-danger)]">
                Clear
              </button>
            </div>
          )}

          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={sourceImage ? "Describe the variation…" : "Describe the image…"}
            className="mb-3"
          />

          <div className="mb-4 flex flex-wrap gap-2">
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
            >
              {imageModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.editsImages ? " (uses reference images)" : ""}
                </option>
              ))}
            </select>
            <select
              value={styleGuideId}
              onChange={(e) => setStyleGuideId(e.target.value)}
              className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text)]"
            >
              <option value="">No Style Guide</option>
              {styleGuides.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {characters.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {characters.map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleCharacter(c.id)}
                  className="focus-ring rounded-[3px] border px-2 py-1 text-[11.5px] transition-colors"
                  style={{
                    borderColor: selectedCharacterIds.includes(c.id) ? "var(--color-accent)" : "var(--color-border)",
                    color: selectedCharacterIds.includes(c.id) ? "var(--color-accent)" : "var(--color-text-muted)",
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {modelIgnoresReferences && (
            <div className="mb-3 rounded-[4px] border border-[var(--color-border-strong)] px-3 py-2 text-[12.5px] text-[var(--color-text-muted)]">
              {selectedModel?.label} doesn&apos;t accept reference images — it will generate from the text
              description alone and ignore the {sourceImage ? "source image" : "character photo"} attached here.
              Pick a model marked &quot;uses reference images&quot; to match a likeness.
            </div>
          )}
          <Button variant="accent" onClick={generate} disabled={!prompt.trim() || !modelId || generating}>
            {generating && <MagiSpinner className="mr-1" />} {generating ? "Generating…" : "Generate"}
          </Button>
          {genError && (
            <div className="mt-3 rounded-[4px] border border-[var(--color-danger)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
              {genError}
            </div>
          )}
        </Panel>

        {/* Gallery */}
        <section>
          <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
            Gallery
          </h2>
          {images.length === 0 && !generating ? (
            <EmptyState title="No images yet" description="Images you generate collect here, organized by Project." />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {generating && (
                <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed border-[var(--color-border-strong)] text-[var(--color-text-faint)]">
                  <MagiSpinner width={20} height={20} />
                  <span className="text-[11px]">Generating…</span>
                </div>
              )}
              {images.map((img) => (
                <button
                  key={img.id}
                  onClick={() => setViewingImage(img)}
                  className="focus-ring group relative aspect-square overflow-hidden rounded-[4px] border border-[var(--color-border)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/images/${img.id}/file`} alt={img.prompt} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-6">
        {/* Style Guides */}
        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              Style Guides
            </h2>
            <Button variant="ghost" onClick={() => setStyleFormOpen((v) => !v)}>
              <IconPlus /> Add
            </Button>
          </div>
          {styleFormOpen && (
            <Panel className="mb-3 px-4 py-4">
              <Label>Name</Label>
              <Input value={styleName} onChange={(e) => setStyleName(e.target.value)} className="mb-3" placeholder="e.g. Muted watercolor" />
              <Label>Description</Label>
              <Textarea
                value={styleDescription}
                onChange={(e) => setStyleDescription(e.target.value)}
                rows={4}
                className="mb-3"
                placeholder="Medium, palette, lighting, composition, mood, anything to avoid"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setStyleFormOpen(false)}>
                  Cancel
                </Button>
                <Button variant="accent" onClick={createStyleGuide}>
                  Save
                </Button>
              </div>
            </Panel>
          )}
          {styleGuides.length === 0 && !styleFormOpen ? (
            <p className="text-[12.5px] text-[var(--color-text-faint)]">
              No Style Guides yet — a saved visual language you can apply to any generation.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {styleGuides.map((s) => (
                <Panel key={s.id} className="px-3.5 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium text-[var(--color-text)]">{s.name}</span>
                    <button onClick={() => removeStyleGuide(s.id)} className="focus-ring shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-danger)]">
                      <IconTrash />
                    </button>
                  </div>
                  {s.description && <p className="mt-1 text-[11.5px] text-[var(--color-text-muted)] line-clamp-2">{s.description}</p>}
                </Panel>
              ))}
            </div>
          )}
        </section>

        {/* Characters */}
        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-faint)] font-technical">
              Characters
            </h2>
            <Button variant="ghost" onClick={() => setCharFormOpen((v) => !v)}>
              <IconPlus /> Add
            </Button>
          </div>
          {charFormOpen && (
            <Panel className="mb-3 px-4 py-4">
              <Label>Name</Label>
              <Input value={charName} onChange={(e) => setCharName(e.target.value)} className="mb-3" placeholder="e.g. Mira" />
              <Label>Description</Label>
              <Textarea
                value={charDescription}
                onChange={(e) => setCharDescription(e.target.value)}
                rows={4}
                className="mb-3"
                placeholder="Appearance, clothing, distinguishing features, personality"
              />
              <Label>Reference photo (optional)</Label>
              <div className="mb-3 flex items-center gap-2">
                <input
                  ref={newCharPhotoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => setCharPhotoFile(e.target.files?.[0] ?? null)}
                />
                <Button variant="default" onClick={() => newCharPhotoInputRef.current?.click()}>
                  <IconAttach /> {charPhotoFile ? charPhotoFile.name : "Choose photo"}
                </Button>
                {charPhotoFile && (
                  <button
                    onClick={() => setCharPhotoFile(null)}
                    className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setCharFormOpen(false)}>
                  Cancel
                </Button>
                <Button variant="accent" onClick={createCharacter} disabled={!charName.trim() || creatingCharacter}>
                  {creatingCharacter ? "Saving…" : "Save"}
                </Button>
              </div>
            </Panel>
          )}
          {characters.length === 0 && !charFormOpen ? (
            <p className="text-[12.5px] text-[var(--color-text-faint)]">
              No Characters yet — keep one consistent across every image you generate.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <input
                ref={existingCharPhotoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleExistingCharPhoto}
              />
              {characters.map((c) =>
                editingCharId === c.id ? (
                  <Panel key={c.id} className="px-3.5 py-3">
                    <Label>Name</Label>
                    <Input value={editCharName} onChange={(e) => setEditCharName(e.target.value)} className="mb-2" />
                    <Label>Description</Label>
                    <Textarea
                      value={editCharDescription}
                      onChange={(e) => setEditCharDescription(e.target.value)}
                      rows={3}
                      className="mb-2"
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setEditingCharId(null)}>
                        Cancel
                      </Button>
                      <Button variant="accent" onClick={saveCharacterEdit} disabled={!editCharName.trim() || savingCharEdit}>
                        {savingCharEdit ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </Panel>
                ) : (
                  <Panel key={c.id} className="px-3.5 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {c.reference_image_id && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/images/${c.reference_image_id}/file`} alt="" className="h-7 w-7 rounded-[2px] object-cover" />
                        )}
                        <span className="text-[13px] font-medium text-[var(--color-text)]">{c.name}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => startEditCharacter(c)}
                          title="Edit"
                          className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-accent)]"
                        >
                          <IconEdit />
                        </button>
                        <button
                          onClick={() => {
                            setUploadPhotoForCharId(c.id);
                            existingCharPhotoInputRef.current?.click();
                          }}
                          disabled={uploadingCharPhoto}
                          title={c.reference_image_id ? "Replace photo" : "Upload photo"}
                          className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-accent)] disabled:opacity-40"
                        >
                          <IconAttach />
                        </button>
                        <button onClick={() => removeCharacter(c.id)} className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-danger)]">
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                    {c.description && <p className="mt-1 text-[11.5px] text-[var(--color-text-muted)] line-clamp-2">{c.description}</p>}
                    {!c.reference_image_id && <Tag>no reference image</Tag>}
                  </Panel>
                )
              )}
            </div>
          )}
        </section>
      </div>

      {viewingImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setViewingImage(null)}>
          <div
            className="flex max-h-full max-w-3xl flex-col overflow-hidden rounded-[4px] border border-[var(--color-border-strong)] bg-[var(--color-bg-raised)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/images/${viewingImage.id}/file`} alt={viewingImage.prompt} className="max-h-[60vh] w-full object-contain" />
            <div className="flex flex-col gap-3 border-t border-[var(--color-border)] px-5 py-4">
              <p className="text-[13px] text-[var(--color-text)]">{viewingImage.prompt}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Tag>{viewingImage.model}</Tag>
                <Button
                  variant="default"
                  onClick={() => {
                    setSourceImage(viewingImage);
                    setViewingImage(null);
                  }}
                >
                  Create variation
                </Button>
                {assigningRefFor === viewingImage.id ? (
                  <select
                    autoFocus
                    onChange={(e) => e.target.value && assignReferenceImage(e.target.value, viewingImage.id)}
                    className="focus-ring rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-2 py-1.5 text-[12.5px] text-[var(--color-text)]"
                  >
                    <option value="">Set as reference for…</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Button variant="default" onClick={() => setAssigningRefFor(viewingImage.id)} disabled={characters.length === 0}>
                    Set as Character reference
                  </Button>
                )}
                <Button variant="danger" onClick={() => removeImage(viewingImage.id)} className="ml-auto">
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
