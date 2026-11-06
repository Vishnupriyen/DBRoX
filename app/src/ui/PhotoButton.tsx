import { useRef, useState } from 'react';
import { Camera, Check, Upload } from 'lucide-react';
import { fileToDataUrl } from '../core/scan';
import { getLang, t } from '../core/i18n';

// Every photo in the app offers two ways: open the camera, or upload from the gallery (locked spec 15.1 Collection).
export function PhotoButton({ onPhoto, facing = 'environment', label }: { onPhoto: (dataUrl: string) => void; facing?: 'user' | 'environment'; label?: string }) {
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const [taken, setTaken] = useState(false);
  const [note, setNote] = useState('');
  const embedded = window.self !== window.top;
  const got = async (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; onPhoto(await fileToDataUrl(f, 800, 0.6)); setTaken(true); setNote(''); };
  const open = (r: React.RefObject<HTMLInputElement | null>) => { if (embedded) setNote(getLang() === 'ta' ? 'இந்த முன்னோட்டத்தில் கேமரா தடுக்கப்படலாம்; நிறுவிய ஆப்பில் வேலை செய்யும்.' : 'In this preview the browser may block the camera. It works in the installed app.'); r.current?.click(); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      {label && <div className="muted" style={{ fontSize: 12 }}>{label}</div>}
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <button type="button" className={`btn grow ${taken ? 'ok-soft' : ''}`} onClick={() => open(cam)}>{taken ? <Check /> : <Camera />} {taken ? (getLang() === 'ta' ? 'எடுத்தது ✓' : 'Taken ✓') : t('takePhoto')}</button>
        <button type="button" className="btn" onClick={() => open(gal)} aria-label="Upload photo"><Upload /></button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture={facing} style={{ display: 'none' }} onChange={got} />
      <input ref={gal} type="file" accept="image/*" style={{ display: 'none' }} onChange={got} />
      {note && <div className="muted" style={{ fontSize: 12 }}>{note}</div>}
    </div>
  );
}
