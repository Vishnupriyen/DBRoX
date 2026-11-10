package com.hanubix.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrintPlugin.class);
        super.onCreate(savedInstanceState);
        // the phone's "font size" setting would otherwise blow up every screen's layout; the app's own text is sized
        // for reading on small phones
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
