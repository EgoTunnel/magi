import { notFound } from "next/navigation";
import { ConversationView, type ConversationInitialData } from "./ConversationView";
import { loadConversationView } from "@/lib/conversationView";
import { listSkills } from "@/lib/repo/skills";
import { listArtifactsByConversation } from "@/lib/repo/artifacts";
import { listPeople } from "@/lib/repo/people";
import { getProject } from "@/lib/repo/projects";
import { MODEL_ROLES } from "@/lib/models/types";

// Everything the conversation needs for its first paint is read here, on the
// server, and arrives with the page. It used to be fetched by the browser
// after an empty page had rendered — six requests, the last of them only
// starting once the first five had finished — so opening a conversation
// showed a blank pane before it showed the conversation.
export default async function ConversationPage({ params }: PageProps<"/projects/[id]/c/[conversationId]">) {
  const { id, conversationId } = await params;
  const view = loadConversationView(conversationId);
  if (!view) notFound();

  const initial: ConversationInitialData = {
    title: view.conversation.title ?? "",
    messages: view.messages,
    projectName: getProject(id)?.name ?? "",
    // Only the fields the page uses: a Skill carries its whole method, and an
    // artifact its whole body, neither of which the page needs to paint.
    skills: listSkills({ projectId: id }).map((s) => ({ id: s.id, name: s.name })),
    roles: MODEL_ROLES.map((r) => ({ id: r.id, label: r.label })),
    artifacts: listArtifactsByConversation(conversationId).map((a) => ({
      id: a.id,
      title: a.title,
      version: a.version,
      mime_type: a.mime_type,
      message_id: a.message_id,
    })),
    people: listPeople({ status: "established" }).map((p) => ({ id: p.id, name: p.name, relationship: p.relationship })),
  };

  // Keyed so moving between conversations mounts a fresh view with that
  // conversation's data, instead of one view's state bleeding into the next.
  return <ConversationView key={conversationId} projectId={id} conversationId={conversationId} initial={initial} />;
}
