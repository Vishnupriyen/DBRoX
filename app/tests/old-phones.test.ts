// Older phones (owner, 12 Nov 2026: "do we have any android version issues"). Field staff carry cheap phones whose Android
// System WebView is often never updated. The build used Vite's default (WebView 111, 2023) and CSS :has() (105), so on those
// phones the app could open to a blank white screen, the TESRAX button stayed over an open bill and its glow was lost.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const app = join(__dirname, '..');
const read = (f: string) => readFileSync(join(app, f), 'utf8');
const walk = (dir: string): string[] => readdirSync(join(app, dir), { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);

describe('works on phones with WebView 87 (late 2020) and newer', () => {
  it('the app is built for WebView 87, code and styles', () => {
    const cfg = read('vite.config.ts');
    expect(cfg).toMatch(/target: \['chrome87'/);
    expect(cfg).toMatch(/cssTarget: \['chrome87'/);
  });

  it('no style needs a newer WebView than 87 (:has needs 105, container queries 105, dvh 108, color-mix 111)', () => {
    const bad = walk('src').filter(f => f.endsWith('.css')).flatMap(f => [/:has\(/, /@container/, /\b\d+(dvh|svh|lvh)\b/, /color-mix\(/, /:is\(|:where\(/]
      .filter(re => re.test(read(f))).map(re => `${f}: ${re.source}`));
    expect(bad).toEqual([]);
  });

  it('no code uses a browser feature newer than WebView 87 that the build cannot convert', () => {
    const NEW = [/structuredClone\(/, /\.at\(-?\d/, /\.findLast(Index)?\(/, /\.toSorted\(|\.toReversed\(|\.toSpliced\(/, /Object\.groupBy|Map\.groupBy/, /Object\.hasOwn\(/, /Array\.fromAsync/, /Promise\.withResolvers/];
    const bad = walk('src').filter(f => /\.(ts|tsx)$/.test(f)).flatMap(f => NEW.filter(re => re.test(read(f))).map(re => `${f}: ${re.source}`));
    expect(bad).toEqual([]);
  });

  it('a phone below 87 gets the "update needed" page, never a blank screen — in the APK and in the browser', () => {
    const cap = JSON.parse(read('capacitor.config.json'));
    expect(cap.android.minWebViewVersion).toBe(87);
    expect(cap.server.errorPath).toBe('old-phone.html');
    expect(existsSync(join(app, 'public', 'old-phone.html'))).toBe(true);
    expect(read('public/old-phone.html')).toMatch(/Update Android System WebView/);
    const guard = /<script>([\s\S]*?)<\/script>/.exec(read('index.html'))![1];
    const run = (ua: string) => {
      const went: string[] = []; const win: Record<string, unknown> = { addEventListener: () => {} };
      new Function('window', 'navigator', 'location', guard)(win, { userAgent: ua }, { replace: (u: string) => went.push(u) });
      return { went, old: !!win.__hanubixOld };
    };
    expect(run('Mozilla/5.0 (Linux; Android 8.1.0; wv) AppleWebKit/537.36 Chrome/69.0.3497.100 Mobile Safari/537.36')).toEqual({ went: ['old-phone.html'], old: true });
    expect(run('Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 Chrome/87.0.4280.66 Mobile Safari/537.36')).toEqual({ went: [], old: false });
    expect(run('Mozilla/5.0 (Linux; Android 16; wv) AppleWebKit/537.36 Chrome/142.0.0.0 Mobile Safari/537.36')).toEqual({ went: [], old: false });
  });

  it('the old-phone page itself uses only old, plain script (var, no arrows or template strings)', () => {
    const js = /<script>([\s\S]*?)<\/script>/.exec(read('public/old-phone.html'))![1] + /<script>([\s\S]*?)<\/script>/.exec(read('index.html'))![1];
    expect(js).not.toMatch(/=>|`|\blet\b|\bconst\b|\?\.|\?\?/);
  });
});
