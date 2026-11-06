import { useRef, useState } from 'react';
import { Camera, Check } from 'lucide-react';
import { fileToDataUrl } from '../core/scan';
import { t } from '../core/i18n';

// One button that opens the phone camera (or the file picker on a laptop) and hands back a small data URL.
// A plain <button> + input.click() is used instead of a <label>, which some embedded browsers ignore.
export function PhotoButton({ onPhoto, facing = 'environment', label }: { onPhoto: (dataUrl: string) => void; facing?: 'user' | 'environment'; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [taken, setTaken] = useState(false);
  const [note, setNote] = useState('');
  const embedded = window.self !== window.top;
  return (
    <>
      <button type="button" className={`btn ${taken ? 'ok-soft' : ''}`} onClick={() => {
        if (embedded) setNote('In this preview the browser blocks the camera. It opens normally in the installed app.');
        ref.current?.click();
      }}>
        {taken ? <Check /> : <Camera />} {taken ? 'Photo taken ✓' : (label ?? t('takePhoto'))}
      </button>
      <input ref={ref} type="file" accept="image/*" capture={facing} style={{ display: 'none' }} onChange={async e => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f) return;
        onPhoto(await fileToDataUrl(f, 800, 0.6)); setTaken(true); setNote('');
      }} />
      {note && <div className="muted" style={{ fontSize: 12 }}>{note}</div>}
    </>
  );
}
