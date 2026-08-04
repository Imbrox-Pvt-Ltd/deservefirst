/**
 * Web · app/store/[handle]/companies/new/page.tsx
 * New company, with its first location.
 * Layer: web.
 */

import { CreateForm } from '../../../../../components/CreateForm';

export default async function NewCompanyPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <CreateForm kind="company" handle={handle} />;
}
