import { ConversationView } from "./ConversationView";

export default async function ConversationPage({ params }: PageProps<"/projects/[id]/c/[conversationId]">) {
  const { id, conversationId } = await params;
  return <ConversationView projectId={id} conversationId={conversationId} />;
}
