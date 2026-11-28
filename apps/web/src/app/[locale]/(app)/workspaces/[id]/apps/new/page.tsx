import { AppCreatePage } from '@/features/apps/app-create-page';

export default async function ProjectNewAppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppCreatePage projectId={id} />;
}
