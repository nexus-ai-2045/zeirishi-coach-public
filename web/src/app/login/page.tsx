import { AuthPanel } from '../../components/AuthPanel';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ auth?: string | string[] }> }) {
  const value = (await searchParams).auth;
  const notice = typeof value === 'string' && ['link-invalid', 'invitation-required', 'unavailable'].includes(value) ? value : undefined;
  return <AuthPanel initialNotice={notice} />;
}
