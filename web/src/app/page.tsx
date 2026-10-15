import { CafeWorkspace } from '../components/CafeWorkspace';
import { AuthPanel } from '../components/AuthPanel';

export const dynamic = 'force-dynamic';
export default function Page() {
  // Online entry verifies the session before the user explicitly opens online controls.
  return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? <AuthPanel /> : <CafeWorkspace />;
}
