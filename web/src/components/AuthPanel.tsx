'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import styles from './AuthPanel.module.css';
import { CafeWorkspace } from './CafeWorkspace';
import { notifySessionChange, subscribeSessionChange } from './auth-session-events';

type State = 'loading' | 'signed-out' | 'authenticated' | 'forbidden' | 'preparing' | 'unavailable';
const configurationErrors = new Set(['AUTH_DISABLED', 'AUTH_MODE_CONFLICT', 'AUTH_CONFIGURATION_REQUIRED']);
const linkNotices: Record<string, string> = {
  'link-invalid': 'ログインリンクを確認できませんでした。同じブラウザーで最新のリンクを開いてください。',
  'invitation-required': '招待の有効性を確認できませんでした。管理者に招待状況を確認してください。',
  unavailable: 'ログイン処理を完了できませんでした。現在の状態を確認しています。',
};

export function AuthPanel({ initialNotice }: { initialNotice?: string }) {
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [learnerId, setLearnerId] = useState<string | null>(null);
  const [state, setState] = useState<State>('loading');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [emailDisabled, setEmailDisabled] = useState(false);
  const [notice, setNotice] = useState(initialNotice ? linkNotices[initialNotice] ?? '' : '');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const operationRef = useRef(operation);
  operationRef.current = operation;

  function revalidate() {
    generation.current += 1;
    activeRequest.current?.abort(); lock.current = false;
    void operationRef.current('session');
  }

  function clearLearner() {
    generation.current += 1;
    activeRequest.current?.abort(); activeRequest.current = null;
    lock.current = false;
    setShowWorkspace(false); setLearnerId(null); setEmail('');
    setState('loading'); setPending(false); setError(''); setNotice('');
  }

  async function operation(action: 'session' | 'request' | 'logout') {
    if (lock.current) return;
    if (action === 'logout') notifySessionChange('invalidate');
    const epoch = ++generation.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    lock.current = true; setPending(true); setError('');
    if (action !== 'session') setNotice('');
    if (action === 'session') setState('loading');
    try {
      const response = await fetch(`/api/auth/${action}`, { method: action === 'session' ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]), ...(action === 'session' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'request' ? { email: email.trim() } : {}) }) });
      const data = await response.json();
      if (epoch !== generation.current) return;
      if (!response.ok) {
        if (action === 'session') { setShowWorkspace(false); setLearnerId(null); if (learnerId) setEmail(''); }
        if (configurationErrors.has(data.error)) { setState('preparing'); setError('ログインの設定は準備中です。現在、メール送信や認証は利用できません。'); return; }
        if (['AUTH_EMAIL_DISABLED', 'EMAIL_DISABLED'].includes(data.error)) { setEmailDisabled(true); setError('ログインメールの送信は準備中です。メールは送信していません。'); return; }
        if (action === 'session' && response.status === 401) { setState('signed-out'); return; }
        if (action === 'session' && response.status === 403) { setState('forbidden'); return; }
        if (action === 'session' || action === 'logout') setState('unavailable');
        setError(action === 'request' ? '送信要求の結果を確認できませんでした。メールの入力は残しています。再送する場合は、もう一度送信ボタンを押してください。'
          : action === 'logout' ? 'ログアウトの完了を確認できませんでした。もう一度ログアウトを試してください。'
          : '認証サービスに接続できません。時間をおいて状態を再確認してください。');
        return;
      }
      if (action === 'session') {
        if (data.authenticated !== true || typeof data.userId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.userId)) throw new Error('UNCONFIRMED_SESSION');
        if (learnerId && learnerId !== data.userId) { setShowWorkspace(false); setEmail(''); }
        setLearnerId(data.userId);
        // Authentication permits profile access, not a claim that learning materials are ready.
        setState('authenticated'); setNotice('');
      } else if (action === 'request') {
        if (response.status !== 202 || data.accepted !== true) throw new Error('UNCONFIRMED_REQUEST');
        setNotice('ログインリンクの送信要求を受け付けました。メールの配達や招待の有効性は、この画面では確認できません。届いた場合は同じブラウザーで最新のリンクを開いてください。');
      } else {
        if (data.signedOut !== true) throw new Error('UNCONFIRMED_LOGOUT');
        setState('signed-out'); setEmail(''); setNotice('このブラウザーからログアウトしました。');
      }
    } catch {
      if (epoch !== generation.current) return;
      if (action === 'session') { setShowWorkspace(false); setLearnerId(null); if (learnerId) setEmail(''); setState('unavailable'); }
      if (action === 'logout') setState('unavailable');
      setError(action === 'request' ? '通信が完了せず、メール送信要求の結果は不明です。入力は残っています。自動で再送はしません。'
        : action === 'logout' ? '通信が完了せず、ログアウトできたか確認できません。再試行してください。'
        : '認証状態を確認できませんでした。状態の再確認を試してください。');
    } finally {
      if (epoch === generation.current) { lock.current = false; setPending(false); activeRequest.current = null; }
      // Other tabs must also recheck when the logout response is lost or rejected.
      if (action === 'logout') notifySessionChange('revalidate', true);
    }
  }
  useEffect(() => {
    const unsubscribe = subscribeSessionChange(change => {
      if (change === 'invalidate') clearLearner();
      else revalidate();
    });
    const foreground = () => revalidate();
    const visibility = () => { if (document.visibilityState === 'visible') foreground(); };
    window.addEventListener('focus', foreground);
    window.addEventListener('pageshow', foreground);
    document.addEventListener('visibilitychange', visibility);
    // A successful callback lands on /login; notify open workspaces before reading its new session.
    if (window.location.pathname === '/login') notifySessionChange('revalidate', true);
    void operationRef.current('session');
    return () => {
      unsubscribe(); generation.current += 1; activeRequest.current?.abort(); lock.current = false;
      window.removeEventListener('focus', foreground); window.removeEventListener('pageshow', foreground);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!pending && !emailDisabled && ['signed-out', 'forbidden'].includes(state)) void operation('request'); }
  const sendDisabled = pending || emailDisabled || !['signed-out', 'forbidden'].includes(state);
  if (showWorkspace && learnerId && ['authenticated', 'loading'].includes(state)) return <>
    {state === 'loading' && <p role="status">ログイン状態を確認しています…</p>}
    <div hidden={state !== 'authenticated'} inert={state !== 'authenticated'}>
      <CafeWorkspace key={learnerId} mode="online" expectedLearnerId={learnerId} />
    </div>
  </>;
  return <main className={styles.page}>
    <div className={styles.brand}>税理士コーチ</div>
    <section className={styles.panel} aria-busy={pending}>
      <p className={styles.eyebrow}>招待された方のログイン</p><h1>学びの続きを、ここから。</h1>
      {state === 'loading' && <p role="status">ログイン状態を確認しています…</p>}
      {state === 'signed-out' && <p>まだログインしていません。招待されたメールアドレスを入力してください。</p>}
      {state === 'forbidden' && <p role="status">この利用者の有効な招待を確認できません。管理者に確認するか、ログアウトして別の招待済みアドレスを使ってください。</p>}
      {state === 'preparing' && <h2>ログインは準備中です</h2>}
      {state === 'unavailable' && <h2>認証サービスを確認できません</h2>}
      {state === 'authenticated' && <div className={styles.ready}><h2>ログインを確認しました</h2><p>学習教材の提供準備は、認証とは別に確認します。受験予定の登録や教材の準備状況を確認できます。開発用データには接続しません。</p><button disabled={pending} onClick={() => setShowWorkspace(true)}>プロフィールと教材の準備状況を見る</button></div>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {state !== 'authenticated' && <form onSubmit={submit}>
        <label htmlFor="login-email">招待されたメールアドレス</label>
        <input id="login-email" name="email" type="email" autoComplete="email" maxLength={254} required value={email} disabled={pending || state === 'preparing'} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />
        <button className={styles.primary} type="submit" disabled={sendDisabled}>ログインリンクを送信する</button>
        <p className={styles.small}>メールはこのボタンを押したときだけ要求します。届いたリンクは、要求した同じブラウザーで、最新のものを使ってください。</p>
      </form>}
      <div className={styles.actions}><button disabled={pending} onClick={() => void operation('session')}>ログイン状態を再確認</button><button disabled={pending || state === 'preparing'} onClick={() => void operation('logout')}>このブラウザーからログアウト</button></div>
      <p className={styles.small}>ログアウトは学習データの削除ではありません。他の端末のログイン状態は変更しません。</p>
    </section>
  </main>;
}
