import type { Metadata } from 'next';
import { BIZ_UDPGothic } from 'next/font/google';
import './globals.css';
export const metadata: Metadata = { title: '税理士コーチ | 開発用ケース', robots: { index: false, follow: false } };
const bodyFont = BIZ_UDPGothic({ weight: ['400', '700'], preload: false, display: 'swap', variable: '--font-body' });
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja" className={bodyFont.variable}><body>{children}</body></html>;
}
