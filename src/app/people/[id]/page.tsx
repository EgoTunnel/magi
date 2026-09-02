import { PersonView } from "./PersonView";

export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const { id } = await params;
  return <PersonView personId={id} />;
}
