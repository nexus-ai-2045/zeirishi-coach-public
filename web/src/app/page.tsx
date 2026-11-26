import { CafeWorkspace } from '../components/CafeWorkspace';
import { AuthPanel } from '../components/AuthPanel';

export const dynamic = 'force-dynamic';
export default function Page() {
  return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? <AuthPanel /> : <CafeWorkspace />;
}
