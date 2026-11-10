#!/usr/bin/env bash
# Smoke test of the Android app on an emulator: install, open, log in with a demo login, open a screen, press back.
# Screenshots and the app's console log are uploaded for review.
set -x
OUT=apk-shots; mkdir -p $OUT
adb install -r app-debug.apk || exit 1
adb logcat -c
adb shell monkey -p com.hanubix.app -c android.intent.category.LAUNCHER 1
sleep 25
shot() { adb exec-out screencap -p > "$OUT/$1.png"; adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/$1.xml" >/dev/null 2>&1; }
tap_text() { # tap the first element whose text contains $1 (or, with $2=below, the first button below it)
  python3 - "$OUT/$CUR.xml" "$1" "${2:-}" <<'PY' > /tmp/xy
import sys, re, xml.etree.ElementTree as ET
nodes = list(ET.parse(sys.argv[1]).iter('node')); want = sys.argv[2]; below = sys.argv[3] == 'below'
def box(n): a = list(map(int, re.findall(r'\d+', n.get('bounds')))); return a
hit = next((n for n in nodes if want in (n.get('text') or '') + (n.get('content-desc') or '')), None)
if not hit: print(''); sys.exit()
if below:
  y = box(hit)[3]
  btn = next((n for n in nodes if n.get('class') == 'android.widget.Button' and box(n)[1] >= y), None)
  hit = btn or hit
a = box(hit); print((a[0] + a[2]) // 2, (a[1] + a[3]) // 2)
PY
  read X Y < /tmp/xy; [ -n "$X" ] && adb shell input tap $X $Y
}
CUR=1-open; shot $CUR
tap_text 'Demo logins' below; sleep 8
CUR=2-home; shot $CUR
tap_text 'More'; sleep 4
CUR=3-more; shot $CUR
adb shell input keyevent KEYCODE_BACK; sleep 3
CUR=4-after-back; shot $CUR
adb shell dumpsys window | grep -E 'mCurrentFocus' > $OUT/focus-after-back.txt
adb logcat -d | grep -iE 'Capacitor|chromium|Console' | tail -300 > $OUT/console.txt
exit 0
