import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '税理士コーチ | 開発用ケース', robots: { index: false, follow: false } };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
