import { redirect } from "next/navigation";

export default async function RepoRedirectPage(props: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await props.params;
  redirect(`/projects/${runId}/decompose`);
}
