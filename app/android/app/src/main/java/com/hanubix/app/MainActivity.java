package com.hanubix.app;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrintPlugin.class);
        registerPlugin(SecurePlugin.class);
        super.onCreate(savedInstanceState);
        // bills and money on screen never show in screenshots, screen recordings or the recent-apps preview
        // (security standard, 13 Nov 2026)
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        // the phone's "font size" setting would otherwise blow up every screen's layout; the app's own text is sized
        // for reading on small phones
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
