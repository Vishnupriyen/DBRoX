#!/usr/bin/env bash
# Runs inside the Android emulator job: install the debug APK, give it location and camera (as a user would on the
# first prompt), then sweep every screen for every role at normal and at large phone text size.
set -x
adb install -r app-debug.apk || exit 1
adb shell pm grant com.hanubix.app android.permission.ACCESS_FINE_LOCATION
adb shell pm grant com.hanubix.app android.permission.ACCESS_COARSE_LOCATION
adb shell pm grant com.hanubix.app android.permission.CAMERA
adb emu geo fix 79.2577 11.4066
cd app
node e2e/android-sweep.cjs normal || echo "SWEEP FAILED (normal)"
adb shell settings put system font_scale 1.3
node e2e/android-sweep.cjs large-text || echo "SWEEP FAILED (large text)"
adb shell settings put system font_scale 1.0
adb logcat -d | grep -iE 'Capacitor/Console|chromium.*(error|Uncaught)|AndroidRuntime' | tail -200
exit 0
