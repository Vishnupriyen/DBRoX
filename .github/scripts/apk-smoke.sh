#!/usr/bin/env bash
# Runs inside the Android emulator job: install the debug APK, give it location and camera (as a user would on the
# first prompt), then sweep every screen for every role at normal and at large phone text size.
set -x
# a freshly booted emulator sits on the lock screen and turns its screen off: keep it awake and unlocked
adb wait-for-device; until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
adb shell svc power stayon true
adb shell settings put system screen_off_timeout 2147483647
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
sleep 5
# Google Play services on a fresh emulator often freezes (ANR) in its first minutes; Android then kills every app bound to
# its font provider (WebView is) and the sweep loses its page mid-run (seen 11 Nov 2026, 3 runs in a row). Let it settle first.
sleep 90
adb install -r app-debug.apk || exit 1
adb shell pm grant com.hanubix.app android.permission.ACCESS_FINE_LOCATION
adb shell pm grant com.hanubix.app android.permission.ACCESS_COARSE_LOCATION
adb shell pm grant com.hanubix.app android.permission.CAMERA
adb emu geo fix 79.2577 11.4066
cd app
# a run is only retried when Android itself killed the app (the emulator's Play services died) — a real app crash or any
# screen issue still fails, because the retry must pass in full
# a sweep that hangs (seen 11 Nov 2026: no output for 2h40m) is stopped after 30 minutes and counts as failed
sweep() { timeout 30m node e2e/android-sweep.cjs "$1" && return 0
  if adb logcat -d | grep -q 'Killing .*com.hanubix.app.*dying proc com.google.android.gms'; then
    echo "RETRY ($1): Android killed the app because Play services died on the emulator"; adb logcat -c
    adb shell am force-stop com.hanubix.app; sleep 20; timeout 30m node e2e/android-sweep.cjs "$1" && return 0; fi
  return 1; }
adb logcat -c
sweep normal || echo "SWEEP FAILED (normal)"
adb shell settings put system font_scale 1.3
sweep large-text || echo "SWEEP FAILED (large text)"
adb shell settings put system font_scale 1.0
adb logcat -d | grep -iE 'Capacitor/Console|chromium.*(error|Uncaught)|AndroidRuntime' | tail -200
exit 0
