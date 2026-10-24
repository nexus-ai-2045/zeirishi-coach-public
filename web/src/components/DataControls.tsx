'use client';

import { useRef, useState } from 'react';
import styles from './DataControls.module.css';

export function DataControls({ disabled, onBusyChange, mode = 'local', onDeleted, expectedLearnerId }: { disabled: boolean; onBusyChange: (busy: boolean) => void; mode?: 'local' | 'online'; onDeleted?: () => void; expectedLearnerId?: string }) {
  const online = mode === 'online';
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [authNeeded, setAuthNeeded] = useState(false);
  const lock = useRef(false);

  async function perform(action: 'export' | 'delete') {
    if (disabled || lock.current || (action === 'delete' && !confirmed)) return;
    lock.current = true; setPending(true); onBusyChange(true); setError(''); setMessage('');
    try {
      if (online && !expectedLearnerId) { setAuthNeeded(true); throw new Error('AUTH_REQUIRED'); }
      const response = await fetch('/api/data', { method: action === 'delete' ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.timeout(30000), headers: { ...(online && expectedLearnerId ? { 'X-Zeirishi-Learner': expectedLearnerId } : {}), ...(action === 'delete' ? { 'Content-Type': 'application/json' } : {}) }, ...(action === 'delete' ? {
          body: JSON.stringify({ action: 'delete', confirmation: 'DELETE_MY_LEARNING_DATA' }),
        } : {}) });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        if (online && ([401, 403].includes(response.status) || failure.error === 'AUTH_IDENTITY_CHANGED')) setAuthNeeded(true);
        throw new Error('REQUEST_FAILED');
      }
      if (action === 'delete') {
        const result = await response.json();
        if (result.deleted !== true) throw new Error('UNCONFIRMED_DELETE');
        if (online) {
          if (result.developmentOnly !== false || result.accountDeleted !== false || result.backupsDeleted !== false) throw new Error('UNCONFIRMED_SCOPE');
          setMessage('本人の学習データを削除しました。アカウント・バックアップは削除していません。');
          onDeleted?.();
          return;
        }
        // Only remove the resume pointer after the server confirms deletion.
        try { localStorage.removeItem('zc-cafe-case-v2'); } catch { /* Reload still clears in-memory learner data. */ }
        window.location.reload();
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'zeirishi-learning-data.json';
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setMessage('データファイルのダウンロードを開始しました。保存先はブラウザーで確認してください。');
    } catch {
      setError(action === 'delete'
        ? '削除の完了を確認できませんでした。成功とは扱っていません。接続を確認して、同じ削除操作を再試行できます。'
        : 'データを書き出せませんでした。接続を確認して、もう一度お試しください。');
    } finally { lock.current = false; setPending(false); onBusyChange(false); }
  }

  return <details className={styles.controls}>
    <summary>{online ? '本人のオンライン学習データを管理' : 'このブラウザーの学習データを管理'}</summary>
    <p>{online ? '現在ログインしている本人のオンライン学習データが対象です。アカウント削除やログアウトは行いません。' : 'このブラウザーの利用者に紐づくローカル開発用データが対象です。本番アカウントの管理・削除ではありません。'}</p>
    <div className={styles.actions}>
      <button disabled={disabled || pending} onClick={() => void perform('export')}>学習データを書き出す</button>
      <button disabled={disabled || pending} onClick={() => { setConfirming(true); setConfirmed(false); setError(''); }}>学習データの削除を確認する</button>
    </div>
    <p>書き出したプロフィール・答案・履歴・週計画は、この端末にJSONファイルとして保存されます。共有端末での保存先に注意してください。書き出し済みのファイルは、下の削除操作では消えません。</p>
    <p>削除後の古いタブからの再保存を防ぐため、利用者識別子のハッシュと失効日時だけは保持します。{online ? 'バックアップや書き出したファイルは削除されません。アカウント自体は残ります。' : 'クラウドやバックアップの削除機能はまだ接続していません。'}</p>
    {confirming && <section className={styles.confirmation} aria-label="学習データ削除の最終確認">
      <h3>この利用者の学習データを削除しますか？</h3>
      <p>対象は、{online ? '現在ログインしている本人のオンラインの' : 'このブラウザーの利用者に紐づく'}プロフィール、旧版・新版の答案、説明下書き、履歴、週計画と変更理由です。削除すると元に戻せません。必要なら、先に書き出してください。</p>
      <label className={styles.checkbox}><input type="checkbox" checked={confirmed} disabled={disabled || pending} onChange={event => setConfirmed(event.target.checked)} />対象と、元に戻せないことを確認しました</label>
      <div className={styles.actions}><button className={styles.danger} disabled={disabled || pending || !confirmed} onClick={() => void perform('delete')}>確認した学習データを削除する</button>
        <button disabled={disabled || pending} onClick={() => { setConfirming(false); setConfirmed(false); setError(''); }}>削除をやめる</button></div>
    </section>}
    {pending && <p role="status">処理結果を確認しています…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {authNeeded && <a href="/login" target="_blank" rel="noopener noreferrer">入力を残して別タブでログイン</a>}
  </details>;
}
