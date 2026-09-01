import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { generateOpenRouterImage, type ReferenceImageInput } from "@/lib/models/openrouter";
import { getOpenRouterApiKey } from "@/lib/settings";
import { getImage, saveGeneratedImage } from "@/lib/repo/images";
import { getStyleGuide } from "@/lib/repo/styleGuides";
import { getCharacter } from "@/lib/repo/characters";

function fileToDataUrl(filePath: string, mimeType: string): string {
  const bytes = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const projectId = body.projectId as string | undefined;
  const prompt = (body.prompt as string)?.trim();
  const modelId = body.modelId as string | undefined;
  const styleGuideId = (body.styleGuideId as string | undefined) || null;
  const characterIds = (body.characterIds as string[] | undefined) ?? [];
  const sourceImageId = (body.sourceImageId as string | undefined) || null;

  if (!projectId || !prompt || !modelId) {
    return NextResponse.json({ error: "projectId, prompt, and modelId are required" }, { status: 400 });
  }
  if (!getOpenRouterApiKey()) {
    return NextResponse.json(
      { error: "NO_API_KEY", message: "No OpenRouter API key configured. Add one in Settings." },
      { status: 412 }
    );
  }

  // Fold Style Guide and Character context directly into the prompt text —
  // more reliable than a system message for models whose main training is
  // around following the user turn closely.
  const promptParts = [prompt];
  const characters = characterIds.map(getCharacter).filter((c): c is NonNullable<typeof c> => !!c);
  if (styleGuideId) {
    const styleGuide = getStyleGuide(styleGuideId);
    if (styleGuide) promptParts.push(`Visual style: ${styleGuide.name} — ${styleGuide.description}`);
  }
  for (const character of characters) {
    promptParts.push(`Character "${character.name}": ${character.description}`);
  }
  const composedPrompt = promptParts.join("\n\n");

  const referenceImages: ReferenceImageInput[] = [];
  if (sourceImageId) {
    const source = getImage(sourceImageId);
    if (source) {
      referenceImages.push({
        label: "Base image to create a variation of:",
        dataUrl: fileToDataUrl(source.file_path, source.mime_type),
      });
    }
  }
  for (const character of characters) {
    if (referenceImages.length >= 4) break;
    if (character.reference_image_id) {
      const ref = getImage(character.reference_image_id);
      if (ref) {
        referenceImages.push({
          label: `Reference photo showing the actual appearance of the character "${character.name}":`,
          dataUrl: fileToDataUrl(ref.file_path, ref.mime_type),
        });
      }
    }
  }

  try {
    const parts = await generateOpenRouterImage({
      model: modelId,
      prompt: composedPrompt,
      referenceImages,
    });
    const images = parts.map((part) =>
      saveGeneratedImage({
        projectId,
        prompt,
        model: modelId,
        dataUrl: part.dataUrl,
        styleGuideId,
        characterIds,
        sourceImageId,
      })
    );
    return NextResponse.json({ images }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Image generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
