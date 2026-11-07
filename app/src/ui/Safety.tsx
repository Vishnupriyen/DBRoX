// Crash safety. Nothing a bug does should leave a blank screen or fail silently.
// 1) ErrorBoundary: a screen that crashes shows a calm message with Retry / Home; the rest of the app keeps working.
// 2) Global handlers: any button whose action fails (including a broken guard rule) shows the reason to the person.
// 3) Every error is kept in a small log on the phone (More → Settings can export it; support reads it).
import { Component, type ReactNode } from 'react';
import { notify } from './dialog';

const KEY = 'hanubix.errors';
export function logError(kind: string, message: string, stack?: string) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[];
    list.unshift({ at: new Date().toISOString(), kind, message: message.slice(0, 500), stack: stack?.slice(0, 2000), url: location.hash });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
  } catch { /* storage full or blocked: never crash while logging a crash */ }
}
export function errorLog(): unknown[] { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } }

let installed = false;
export function installGlobalHandlers() {
  if (installed || typeof window === 'undefined') return; installed = true;
  window.addEventListener('error', e => logError('error', e.message, (e.error as Error | undefined)?.stack));
  window.addEventListener('unhandledrejection', e => {
    const err = e.reason as Error | undefined;
    const msg = err?.message ?? String(e.reason);
    logError(err?.name === 'GuardError' ? 'guard' : 'rejection', msg, err?.stack);
    // a rule the app refused, or an action that failed: say so plainly instead of doing nothing
    void notify(err?.name === 'GuardError' ? 'Not saved' : 'That did not work', err?.name === 'GuardError' ? msg : `${msg}\n\nNothing was changed. Try again; if it repeats, tell support.`);
  });
}

export class ErrorBoundary extends Component<{ children: ReactNode; onHome?: () => void; resetKey?: unknown }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { logError('render', err.message, err.stack); }
  componentDidUpdate(prev: { resetKey?: unknown }) { if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="card stack" role="alert" style={{ marginTop: 24, textAlign: 'center' }}>
        <h3>This screen hit a problem</h3>
        <div className="muted">Your data is safe — nothing was lost. The problem has been noted.</div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => this.setState({ err: null })}>Try again</button>
          {this.props.onHome && <button className="btn" onClick={() => { this.setState({ err: null }); this.props.onHome!(); }}>Go home</button>}
        </div>
      </div>
    );
  }
}
