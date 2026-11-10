package com.hanubix.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Prints what is on screen (a bill, a delivery report) through Android's print screen: a printer, or "Save as PDF". */
@CapacitorPlugin(name = "HanubixPrint")
public class PrintPlugin extends Plugin {
    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "Hanubix");
        getActivity().runOnUiThread(() -> {
            WebView wv = getBridge().getWebView();
            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            pm.print(name, wv.createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
            call.resolve();
        });
    }
}
