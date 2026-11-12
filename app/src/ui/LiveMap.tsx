// The Live vans map (12 Nov 2026, owner: "Add the map").
// On the Android app with a Google Maps key: Google's own map (the native Maps SDK — free in India, no limit).
// In a browser, or before the key is set: the free OpenStreetMap map. Same vans, routes and stops on both.
import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Trip } from '../core/types';

export interface MapVan { id: string; label: string; color: string; track: Trip['track']; stops: { lat: number; lng: number; done: boolean; name: string }[] }
export const VAN_COLORS = ['#157451', '#b48d37', '#2563eb', '#b5263a', '#7c3aed', '#0e7490'];

const KEY = import.meta.env.VITE_MAPS_KEY as string | undefined;
const useGoogle = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && !!KEY;

function bounds(vans: MapVan[], godown?: [number, number]) {
  const pts: [number, number][] = [...vans.flatMap(v => [...v.track.map(p => [p.lat, p.lng] as [number, number]), ...v.stops.map(s => [s.lat, s.lng] as [number, number])]), ...(godown ? [godown] : [])];
  return pts.length ? pts : null;
}

export function LiveMap({ vans, godown }: { vans: MapVan[]; godown?: [number, number] }) {
  const box = useRef<HTMLDivElement>(null);
  const google = useGoogle();
  const sig = JSON.stringify([vans, godown]); // redraw only when a van moved or a stop changed, not on every 10-second refresh
  // ---- Google (Android app) ----
  useEffect(() => {
    if (!google || !box.current) return;
    let map: import('@capacitor/google-maps').GoogleMap | null = null, gone = false;
    document.documentElement.classList.add('native-map'); // the map is drawn under the app: the way down to it must be see-through
    (async () => {
      const { GoogleMap } = await import('@capacitor/google-maps');
      const pts = bounds(vans, godown);
      const c = pts ? { lat: pts.reduce((a, p) => a + p[0], 0) / pts.length, lng: pts.reduce((a, p) => a + p[1], 0) / pts.length } : { lat: godown?.[0] ?? 11.4066, lng: godown?.[1] ?? 79.2577 };
      map = await GoogleMap.create({ id: 'live-vans', element: box.current!, apiKey: KEY!, config: { center: c, zoom: 11 } });
      if (gone) { await map.destroy(); return; }
      if (godown) await map.addMarker({ coordinate: { lat: godown[0], lng: godown[1] }, title: 'Godown', tintColor: { r: 6, g: 61, b: 44, a: 1 } });
      for (const v of vans) {
        const [r, g, b] = [1, 3, 5].map(i => parseInt(v.color.slice(i, i + 2), 16));
        if (v.track.length > 1) await map.addPolylines([{ path: v.track.map(p => ({ lat: p.lat, lng: p.lng })), strokeColor: v.color, strokeWeight: 6 } as never]); // `path` comes from Google's own types, not installed here
        for (const s of v.stops) await map.addMarker({ coordinate: { lat: s.lat, lng: s.lng }, title: s.name, snippet: s.done ? 'delivered' : 'to deliver', opacity: s.done ? 1 : .55, tintColor: { r, g, b, a: 1 } });
        const last = v.track[v.track.length - 1];
        if (last) await map.addMarker({ coordinate: { lat: last.lat, lng: last.lng }, title: v.label, snippet: 'van — last location', tintColor: { r, g, b, a: 1 } });
      }
      if (pts && pts.length > 1) {
        const la = pts.map(p => p[0]), lo = pts.map(p => p[1]);
        await map.fitBounds({ southwest: { lat: Math.min(...la), lng: Math.min(...lo) }, northeast: { lat: Math.max(...la), lng: Math.max(...lo) }, center: c } as never, 40);
      }
    })().catch(() => { /* no network or key problem: the list below still shows every van */ });
    return () => { gone = true; document.documentElement.classList.remove('native-map'); void map?.destroy(); };
  }, [google, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- OpenStreetMap (browser, or no key yet) ----
  useEffect(() => {
    if (google || !box.current) return;
    let map: import('leaflet').Map | null = null, gone = false;
    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (gone || !box.current) return;
      map = L.map(box.current, { zoomControl: false, attributionControl: true, zoomSnap: .25 });
      map.attributionControl.setPrefix(false);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
      const dot = (fill: string, ring: string, size: number, text = '') => L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: `<div class="lm-dot" style="width:${size}px;height:${size}px;background:${fill};border-color:${ring}">${text}</div>` });
      if (godown) L.marker(godown, { icon: dot('#063d2c', '#fff', 28, 'G'), title: 'Godown' }).addTo(map);
      for (const v of vans) {
        if (v.track.length > 1) L.polyline(v.track.map(p => [p.lat, p.lng] as [number, number]), { color: v.color, weight: 4, opacity: .85 }).addTo(map);
        for (const s of v.stops) L.marker([s.lat, s.lng], { icon: dot(s.done ? v.color : '#fff', v.color, 14), title: s.name }).addTo(map);
        const last = v.track[v.track.length - 1];
        if (last) L.marker([last.lat, last.lng], { icon: dot(v.color, '#fff', 30, v.label.slice(0, 1).toUpperCase()), title: v.label }).addTo(map).bindTooltip(v.label, { direction: 'top', offset: [0, -14] });
      }
      const pts = bounds(vans, godown);
      if (pts && pts.length > 1) map.fitBounds(pts, { padding: [24, 24], maxZoom: 15 }); else map.setView(pts?.[0] ?? godown ?? [11.4066, 79.2577], 13);
    })().catch(() => { /* offline: the list below still shows every van */ });
    return () => { gone = true; map?.remove(); };
  }, [google, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className={`live-map${google ? ' google' : ''}`} role="img" aria-label="Map of the vans, their routes and stops" />;
}
