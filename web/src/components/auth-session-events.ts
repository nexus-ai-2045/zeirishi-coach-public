// This channel carries only invalidation signals, never identities or learner data.
const channelName = 'zc-auth-session-v1';
const localEvent = 'zc-auth-session-change';
export type SessionChange = 'invalidate' | 'revalidate';
let senderId: string | undefined;
const localSender = () => senderId ??= crypto.randomUUID();

export function notifySessionChange(change: SessionChange, otherTabsOnly = false) {
  if (!otherTabsOnly) window.dispatchEvent(new CustomEvent(localEvent, { detail: change }));
  const message = { sender: localSender(), change };
  try {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage(message);
    channel.close();
    return; // Use one ordered transport; mixing storage and channel delivery can reorder signals.
  } catch { /* Storage events and foreground revalidation remain available. */ }
  try { localStorage.setItem(channelName, JSON.stringify({ ...message, nonce: crypto.randomUUID() })); }
  catch { /* No learner data is persisted; storage is an optional notification transport. */ }
}

export function subscribeSessionChange(listener: (change: SessionChange) => void) {
  const deliver = (value: unknown) => { if (value === 'invalidate' || value === 'revalidate') listener(value); };
  const remote = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const message = value as { sender?: unknown; change?: unknown };
    if (typeof message.sender === 'string' && message.sender !== localSender()) deliver(message.change);
  };
  const local = (event: Event) => deliver((event as CustomEvent).detail);
  const storage = (event: StorageEvent) => {
    if (event.key !== channelName || !event.newValue) return;
    try { remote(JSON.parse(event.newValue)); } catch { /* Ignore malformed optional signals. */ }
  };
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(channelName); channel.onmessage = event => remote(event.data); }
  catch { /* Foreground and storage events still cover unsupported browsers. */ }
  window.addEventListener(localEvent, local);
  window.addEventListener('storage', storage);
  return () => { channel?.close(); window.removeEventListener(localEvent, local); window.removeEventListener('storage', storage); };
}
