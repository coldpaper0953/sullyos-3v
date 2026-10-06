package com.aetheros.simulator.pet;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 悬浮桌宠桥：JS 侧经 PetOverlay（utils/petOverlay.ts）调用。 */
@CapacitorPlugin(name = "PetOverlay")
public class PetOverlayPlugin extends Plugin {

    @PluginMethod
    public void canOverlay(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", Settings.canDrawOverlays(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!Settings.canDrawOverlays(getContext())) {
            call.reject("overlay permission not granted");
            return;
        }
        double sizeDp = call.getDouble("size", 72.0);
        double speed = call.getDouble("speed", 1.0);
        double jumpPct = call.getDouble("jumpPct", 14.0);
        double glideLevel = call.getDouble("glideLevel", 2.0);
        float density = getContext().getResources().getDisplayMetrics().density;
        int sizePx = (int) Math.max(48, Math.min(320, sizeDp * density));
        Intent i = new Intent(getContext(), OverlayPetService.class);
        i.putExtra("size", sizePx);
        i.putExtra("speed", (float) speed);
        i.putExtra("jumpPct", (float) jumpPct);
        i.putExtra("glideLevel", (int) glideLevel);
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            getContext().startForegroundService(i);
        } else {
            getContext().startService(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent i = new Intent(getContext(), OverlayPetService.class);
        getContext().stopService(i);
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", OverlayPetService.instance != null);
        call.resolve(ret);
    }
}
