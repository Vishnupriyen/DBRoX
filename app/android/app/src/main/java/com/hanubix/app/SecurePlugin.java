package com.hanubix.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Keeps the login token in the Android Keystore (security standard, 13 Nov 2026): the value is encrypted with an AES key
 * that never leaves the phone's secure hardware, so a copy of the app's files (a lost or rooted phone) does not give the
 * token away. Only small strings are kept here (the token); the business data stays in the app's own database.
 */
@CapacitorPlugin(name = "HanubixSecure")
public class SecurePlugin extends Plugin {
    private static final String ALIAS = "hanubix-secure-v1";
    private static final String PREFS = "hanubix-secure";

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return g.generateKey();
    }

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    @PluginMethod
    public void set(PluginCall call) {
        String k = call.getString("key"), v = call.getString("value");
        if (k == null || v == null) { call.reject("key and value needed"); return; }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] out = c.doFinal(v.getBytes(StandardCharsets.UTF_8));
            String packed = Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(out, Base64.NO_WRAP);
            prefs().edit().putString(k, packed).apply();
            call.resolve();
        } catch (Exception e) { call.reject("secure store failed", e); }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String k = call.getString("key");
        JSObject r = new JSObject();
        String packed = k == null ? null : prefs().getString(k, null);
        if (packed == null) { r.put("value", null); call.resolve(r); return; }
        try {
            String[] parts = packed.split(":", 2);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            r.put("value", new String(c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
            call.resolve(r);
        } catch (Exception e) {
            prefs().edit().remove(k).apply(); // a value the key can no longer open (key reset): treated as logged out
            r.put("value", null); call.resolve(r);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String k = call.getString("key");
        if (k != null) prefs().edit().remove(k).apply();
        call.resolve();
    }
}
