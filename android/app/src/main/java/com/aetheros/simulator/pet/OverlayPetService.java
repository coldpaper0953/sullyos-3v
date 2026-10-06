package com.aetheros.simulator.pet;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.TextView;

import com.aetheros.simulator.MainActivity;

/**
 * 悬浮桌宠前台服务（3.2.0）：把桌宠浮到其他 App 上面，对齐原版 PetService 的三窗口架构。
 * 物理/交互与 React 版 FloatingPet.tsx 逐参数对齐（30ms 物理帧、100ms 帧动画）。
 * v1 范围：巡航/拖拽/快甩抛物线/惯性滑行/点跳/拍扁/摸头/双击打开 App/右缘拉手/气泡（固定台词）。
 */
public class OverlayPetService extends Service {

    public static OverlayPetService instance;

    // 30ms 物理帧常量（= React 版 FALL_GRAVITY / FALL_DRAG / FALL_V_SCALE）
    private static final float FALL_GRAVITY = 1.2f;
    private static final float FALL_DRAG = 0.99f;
    private static final float FALL_V_SCALE = 30f / 16f;
    private static final int TOP_EDGE = 40;

    private WindowManager wm;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private ImageView pet;
    private WindowManager.LayoutParams petLP;
    private TextView bubble;
    private WindowManager.LayoutParams bubbleLP;
    private TextView tabHandle;
    private WindowManager.LayoutParams tabHandleLP;

    // 帧图（res/drawable：<动作>_<1..5>.png + dead）
    private final Drawable[][] frames = new Drawable[5][5]; // mosquito/happy/sad/work/jump
    private Drawable deadFrame;

    // 运行状态
    private int size = 96;              // px
    private float speedMul = 1f;
    private float jumpPct = 14f;
    private int glideLevel = 2;         // 0关/1轻/2中/3强
    private int px = 0, py = 0;
    private float vx = 2f, vy = 1.2f;
    private int action = 0;             // 0..4 对应 frames 下标，5=dead
    private int frame = 0;
    private float[] fallV = null;       // {vx, vy, bounces}
    private float[] glideV = null;      // {vx, vy}
    private long hopStart = 0;          // 点击跳跃起始时间
    private float hopBaseY = 0;
    private long deadUntil = 0;
    private long physAt = 0, frameAt = 0;

    // 触摸状态
    private boolean dragging = false;
    private float dragOffX, dragOffY;
    private float downX, downY;
    private long downAt;
    private boolean moved;
    private float dragVx, dragVy;       // px/ms
    private float lastX, lastY;
    private long lastMoveAt;
    private int tapCount = 0;
    private Runnable pendingTap;
    private float pinchStartDist = 0, pinchStartSize = 0;

    // 气泡（三级优先级：高优先级显示中不被低优先级打断）
    private String bubbleText = null;
    private long bubbleUntil = 0;
    private int bubblePrio = 0;

    private static final String[] QUOTE_TAP = {"嗯？", "嗡嗡～", "干嘛啦～"};
    private static final String[] QUOTE_THROW = {"哇啊啊——！", "放我下来！", "撞晕了…嗡…"};
    private static final String[] QUOTE_GLIDE = {"滑翔中～", "看我的漂移！"};
    private static final String QUOTE_SMACK = "你把我拍扁了！！！";
    private static final String QUOTE_REVIVE = "我复活啦！嗡嗡～";
    private static final String QUOTE_PET = "（舒服地蹭了蹭你）";

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);

        loadFrames();
        SharedPreferences sp = getSharedPreferences("petdesk_overlay", MODE_PRIVATE);
        size = sp.getInt("size", size);
        speedMul = sp.getFloat("speedMul", speedMul);
        jumpPct = sp.getFloat("jumpPct", jumpPct);
        glideLevel = sp.getInt("glideLevel", glideLevel);
        px = sp.getInt("px", -1);
        py = sp.getInt("py", -1);

        int sw = screenW(), sh = screenH();
        if (px < 0 || py < 0) { px = sw - size - 16; py = sh * 2 / 5; }
        randomizeVelocity();

        startForegroundNow();
        createPet();
        createBubble();
        createTabHandle();

        tickMove.run();
        tickFrame.run();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            int sz = intent.getIntExtra("size", size);
            float sp = intent.getFloatExtra("speed", speedMul);
            float jp = intent.getFloatExtra("jumpPct", jumpPct);
            int gl = intent.getIntExtra("glideLevel", glideLevel);
            if (sz != size || sp != speedMul || jp != jumpPct || gl != glideLevel) {
                size = Math.max(48, Math.min(320, sz));
                speedMul = sp;
                jumpPct = jp;
                glideLevel = gl;
                applyPetSize();
            }
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        savePos();
        try { if (pet != null) wm.removeView(pet); } catch (Exception ignored) { }
        try { if (bubble != null) wm.removeView(bubble); } catch (Exception ignored) { }
        try { if (tabHandle != null) wm.removeView(tabHandle); } catch (Exception ignored) { }
        instance = null;
        super.onDestroy();
    }

    // ---------- 前台通知 ----------
    private void startForegroundNow() {
        String chId = "pet_overlay";
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            NotificationChannel ch = new NotificationChannel(chId, "悬浮桌宠", NotificationManager.IMPORTANCE_MIN);
            nm.createNotificationChannel(ch);
            b = new Notification.Builder(this, chId);
        } else {
            b = new Notification.Builder(this);
        }
        Intent li = new Intent(this, MainActivity.class);
        li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 0, li, PendingIntent.FLAG_IMMUTABLE);
        b.setSmallIcon(android.R.drawable.ic_menu_compass)
                .setContentTitle("悬浮桌宠运行中")
                .setContentText("点按打开 SullyOS")
                .setOngoing(true)
                .setContentIntent(pi);
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(1, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(1, n);
        }
    }

    // ---------- 三窗口 ----------
    private int overlayType() {
        return Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void createPet() {
        pet = new ImageView(this);
        pet.setScaleType(ImageView.ScaleType.FIT_CENTER);
        setAction(action, true);
        petLP = new WindowManager.LayoutParams(size, size, overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        petLP.gravity = Gravity.TOP | Gravity.START;
        petLP.x = px;
        petLP.y = py;
        pet.setOnTouchListener(new PetTouch());
        wm.addView(pet, petLP);
    }

    private void createBubble() {
        bubble = new TextView(this);
        bubble.setTextColor(Color.rgb(51, 51, 51));
        bubble.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        bubble.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(12));
        bubble.setBackground(bg);
        bubble.setPadding(dp(10), dp(6), dp(10), dp(6));
        bubble.setVisibility(View.GONE);
        bubbleLP = new WindowManager.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        bubbleLP.gravity = Gravity.TOP | Gravity.START;
        wm.addView(bubble, bubbleLP);
    }

    private void createTabHandle() {
        tabHandle = new TextView(this);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadii(new float[]{dp(4), dp(4), 0, 0, 0, 0, dp(4), dp(4)});
        tabHandle.setBackground(bg);
        tabHandleLP = new WindowManager.LayoutParams(dp(10), dp(44), overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        tabHandleLP.gravity = Gravity.TOP | Gravity.END;
        tabHandleLP.y = screenH() / 2 - dp(22);
        tabHandle.setOnClickListener(v -> openApp());
        wm.addView(tabHandle, tabHandleLP);
    }

    private void applyPetSize() {
        if (pet == null) return;
        petLP.width = size;
        petLP.height = size;
        try { wm.updateViewLayout(pet, petLP); } catch (Exception ignored) { }
    }

    private void openApp() {
        Intent li = new Intent(this, MainActivity.class);
        li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(li);
    }

    // ---------- 帧图与动作 ----------
    private void loadFrames() {
        String[] acts = {"mosquito", "happy", "sad", "work", "jump"};
        for (int a = 0; a < acts.length; a++) {
            for (int i = 0; i < 5; i++) {
                int id = getResources().getIdentifier(acts[a] + "_" + (i + 1), "drawable", getPackageName());
                if (id != 0) frames[a][i] = getResources().getDrawable(id);
            }
        }
        int deadId = getResources().getIdentifier("dead", "drawable", getPackageName());
        if (deadId != 0) deadFrame = getResources().getDrawable(deadId);
    }

    private void setAction(int a, int frameIdx) {
        action = a;
        Drawable d = a == 5 ? deadFrame : frames[a][frameIdx % 5];
        if (d != null && pet != null) pet.setImageDrawable(d);
    }

    private void setAction(int a, boolean resetFrame) {
        setAction(a, 0);
    }

    // ---------- 30ms 物理帧 ----------
    private final Runnable tickMove = new Runnable() {
        @Override
        public void run() {
            long now = System.currentTimeMillis();
            if (now - physAt >= 30) {
                physAt = now;
                stepPhysics(now);
            }
            placeBubble(now);
            handler.postDelayed(this, 30);
        }
    };

    private void stepPhysics(long now) {
        int sw = screenW(), sh = screenH();
        int W = sw - size, H = sh - size;

        if (now < deadUntil) {
            setAction(5, 0);
        } else if (deadUntil != 0) {
            deadUntil = 0;
            setAction(0, 0);
            showBubble(QUOTE_REVIVE, 2500, 2);
        } else if (hopStart > 0) {
            float t = (now - hopStart) / 1000f;
            float total = 0.6f;
            if (t >= total) {
                hopStart = 0;
                py = (int) hopBaseY;
                setAction(0, 0);
            } else {
                float k = (float) Math.sin((t / total) * Math.PI);
                py = (int) (hopBaseY - k * (jumpPct / 100f) * sh);
            }
        } else if (fallV != null) {
            // 快甩抛物线：重力 + 撞边衰减反弹 + 地板摔停晕 700ms
            fallV[1] += FALL_GRAVITY;
            px += Math.round(fallV[0]);
            py += Math.round(fallV[1]);
            fallV[0] *= FALL_DRAG;
            if (px < 0) { px = 0; fallV[0] = Math.abs(fallV[0]) * 0.55f; }
            else if (px > W) { px = W; fallV[0] = -Math.abs(fallV[0]) * 0.55f; }
            if (py < TOP_EDGE) { py = TOP_EDGE; fallV[1] = Math.abs(fallV[1]) * 0.5f; }
            int floor = sh - size - 60;
            if (py >= floor) {
                py = floor;
                if (fallV[1] > 10 && fallV[2] < 2) {
                    fallV[1] = -fallV[1] * 0.42f;
                    fallV[0] *= 0.7f;
                    fallV[2]++;
                } else {
                    fallV = null;
                    deadUntil = now + 700;
                    setAction(5, 0);
                    showBubble(pick(QUOTE_THROW), 2000, 2);
                }
            }
        } else if (glideV != null) {
            // 惯性滑行：按档位摩擦衰减，撞边折返，慢到停恢复巡航
            float fr = glideLevel <= 0 ? 0f : glideLevel == 1 ? 0.90f : glideLevel == 3 ? 0.965f : 0.94f;
            glideV[0] *= fr;
            glideV[1] *= fr;
            px += Math.round(glideV[0]);
            py += Math.round(glideV[1]);
            if (px < 0) { px = 0; glideV[0] = Math.abs(glideV[0]); }
            if (px > W) { px = W; glideV[0] = -Math.abs(glideV[0]); }
            if (py < TOP_EDGE) { py = TOP_EDGE; glideV[1] = Math.abs(glideV[1]); }
            if (py > H) { py = H; glideV[1] = -Math.abs(glideV[1]); }
            if (Math.hypot(glideV[0], glideV[1]) < 0.15) {
                glideV = null;
                setAction(0, 0);
            }
        } else {
            // 巡航：匀速 + 2% 概率随机改向，撞边界折返
            px += Math.round(vx * speedMul);
            py += Math.round(vy * speedMul);
            if (px < 0) { px = 0; vx = Math.abs(vx); }
            if (px > W) { px = W; vx = -Math.abs(vx); }
            if (py < TOP_EDGE) { py = TOP_EDGE; vy = Math.abs(vy); }
            if (py > H) { py = H; vy = -Math.abs(vy); }
            if (Math.random() < 0.02) randomizeVelocity();
        }

        if (px < 0) px = 0;
        if (py < TOP_EDGE) py = TOP_EDGE;
        if (px > W) px = W;
        if (py > H) py = H;
        petLP.x = px;
        petLP.y = py;
        try { wm.updateViewLayout(pet, petLP); } catch (Exception ignored) { }
    }

    private void randomizeVelocity() {
        float sp = 1.5f + (float) Math.random() * 2.5f;
        double a = Math.random() * Math.PI * 2;
        vx = (float) (Math.cos(a) * sp);
        vy = (float) (Math.sin(a) * sp);
    }

    // ---------- 100ms 帧动画 ----------
    private final Runnable tickFrame = new Runnable() {
        @Override
        public void run() {
            long now = System.currentTimeMillis();
            if (now - frameAt >= 100) {
                frameAt = now;
                if (action != 5) {
                    frame = (frame + 1) % 5;
                    setAction(action, frame);
                }
            }
            handler.postDelayed(this, 100);
        }
    };

    // ---------- 气泡 ----------
    private void showBubble(String text, long ms, int prio) {
        if (text == null) return;
        long now = System.currentTimeMillis();
        if (bubbleText != null && bubbleUntil > now && bubblePrio > prio) return;
        bubbleText = text;
        bubbleUntil = now + ms;
        bubblePrio = prio;
        bubble.setText(text);
        bubble.setVisibility(View.VISIBLE);
        placeBubble(now);
        bubble.post(() -> placeBubble(System.currentTimeMillis()));
    }

    private void placeBubble(long now) {
        if (bubble == null || bubble.getVisibility() != View.VISIBLE) return;
        if (now > bubbleUntil) {
            bubble.setVisibility(View.GONE);
            bubbleText = null;
            return;
        }
        int bw = Math.max(bubble.getWidth(), dp(80));
        int bh = Math.max(bubble.getHeight(), dp(28));
        int bx = Math.max(0, Math.min(px + size / 2 - bw / 2, screenW() - bw));
        int by = Math.max(TOP_EDGE - 10, py - bh - dp(6));
        bubbleLP.x = bx;
        bubbleLP.y = by;
        try { wm.updateViewLayout(bubble, bubbleLP); } catch (Exception ignored) { }
    }

    // ---------- 触摸 ----------
    private class PetTouch implements View.OnTouchListener {
        @Override
        public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: {
                    downX = e.getRawX();
                    downY = e.getRawY();
                    downAt = System.currentTimeMillis();
                    lastX = e.getRawX();
                    lastY = e.getRawY();
                    lastMoveAt = downAt;
                    dragVx = dragVy = 0;
                    moved = false;
                    dragging = true;
                    dragOffX = e.getRawX() - px;
                    dragOffY = e.getRawY() - py;
                    fallV = null;
                    glideV = null;
                    hopStart = 0;
                    handler.postDelayed(petRun, 800);
                    handler.postDelayed(settingsRun, 1500);
                    return true;
                }
                case MotionEvent.ACTION_POINTER_DOWN: {
                    if (e.getPointerCount() >= 2) {
                        pinchStartDist = fingerDist(e);
                        pinchStartSize = size;
                        handler.removeCallbacks(petRun);
                        handler.removeCallbacks(settingsRun);
                    }
                    return true;
                }
                case MotionEvent.ACTION_MOVE: {
                    if (e.getPointerCount() >= 2 && pinchStartDist > 0) {
                        float ns = Math.max(48, Math.min(320, pinchStartSize * fingerDist(e) / pinchStartDist));
                        if ((int) ns != size) {
                            size = (int) ns;
                            applyPetSize();
                        }
                        return true;
                    }
                    long now = System.currentTimeMillis();
                    float dt = now - lastMoveAt;
                    if (dt > 0) {
                        dragVx = (e.getRawX() - lastX) / dt;
                        dragVy = (e.getRawY() - lastY) / dt;
                    }
                    lastX = e.getRawX();
                    lastY = e.getRawY();
                    lastMoveAt = now;
                    if (Math.abs(e.getRawX() - downX) > 4 || Math.abs(e.getRawY() - downY) > 4) moved = true;
                    if (moved) {
                        handler.removeCallbacks(petRun);
                        handler.removeCallbacks(settingsRun);
                        px = clamp((int) (e.getRawX() - dragOffX), 0, screenW() - size);
                        py = clamp((int) (e.getRawY() - dragOffY), TOP_EDGE, screenH() - size);
                        petLP.x = px;
                        petLP.y = py;
                        try { wm.updateViewLayout(pet, petLP); } catch (Exception ignored) { }
                    }
                    return true;
                }
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL: {
                    dragging = false;
                    handler.removeCallbacks(petRun);
                    handler.removeCallbacks(settingsRun);
                    if (e.getActionMasked() == MotionEvent.ACTION_CANCEL) return true;
                    savePos();

                    if (e.getPointerCount() >= 2 || pinchStartDist > 0) {
                        pinchStartDist = 0;
                        return true;
                    }

                    if (moved) {
                        boolean fresh = System.currentTimeMillis() - lastMoveAt <= 200;
                        float svx = fresh ? dragVx : 0;   // px/ms
                        float svy = fresh ? dragVy : 0;
                        float speed = (float) Math.hypot(svx, svy) * 1000;   // px/s
                        float dist = (float) Math.hypot(e.getRawX() - downX, e.getRawY() - downY);
                        if (dist > 60 && speed > 600) {
                            fallV = new float[]{svx * 30 * FALL_V_SCALE, svy * 30 * FALL_V_SCALE, 0};
                            showBubble(pick(QUOTE_THROW), 1500, 2);
                        } else if (speed > 40) {
                            glideV = new float[]{svx * 30, svy * 30};
                            if (speed > 267) showBubble(pick(QUOTE_GLIDE), 1500, 1);
                        } else {
                            setAction(0, 0);
                        }
                        return true;
                    }

                    // 点击：280ms 计数窗（1=跳，2=打开 App，3=拍扁）
                    tapCount++;
                    if (pendingTap != null) handler.removeCallbacks(pendingTap);
                    final int n = tapCount;
                    pendingTap = () -> {
                        tapCount = 0;
                        if (n == 1) hop();
                        else if (n == 2) openApp();
                        else smack();
                    };
                    handler.postDelayed(pendingTap, 280);
                    return true;
                }
            }
            return true;
        }

        private float fingerDist(MotionEvent e) {
            float dx = e.getX(0) - e.getX(1);
            float dy = e.getY(0) - e.getY(1);
            return (float) Math.hypot(dx, dy);
        }
    }

    private final Runnable petRun = new Runnable() {
        @Override
        public void run() {
            // 长按 0.8s = 摸头
            dragging = false;
            showBubble(QUOTE_PET, 2500, 2);
            setAction(1, true);
            handler.postDelayed(() -> { if (deadUntil == 0 && fallV == null && glideV == null && hopStart == 0) setAction(0, 0); }, 1200);
        }
    };

    private final Runnable settingsRun = new Runnable() {
        @Override
        public void run() {
            // 长按 1.5s = 打开 SullyOS
            dragging = false;
            openApp();
        }
    };

    // ---------- 交互动作 ----------
    private void hop() {
        if (deadUntil > System.currentTimeMillis()) return;
        hopBaseY = py;
        hopStart = System.currentTimeMillis();
        showBubble(pick(QUOTE_TAP), 1500, 1);
    }

    private void smack() {
        deadUntil = System.currentTimeMillis() + 2000;
        setAction(5, 0);
        showBubble(QUOTE_SMACK, 1500, 2);
        handler.postDelayed(() -> {
            if (deadUntil > 0 && System.currentTimeMillis() >= deadUntil - 100) {
                deadUntil = 0;
                setAction(0, 0);
                showBubble(QUOTE_REVIVE, 2500, 2);
            }
        }, 2000);
    }

    // ---------- 小工具 ----------
    private void savePos() {
        SharedPreferences sp = getSharedPreferences("petdesk_overlay", MODE_PRIVATE);
        sp.edit().putInt("px", px).putInt("py", py)
                .putInt("size", size).putFloat("speedMul", speedMul)
                .putFloat("jumpPct", jumpPct).putInt("glideLevel", glideLevel)
                .apply();
    }

    private int screenW() {
        android.util.DisplayMetrics dm = new android.util.DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(dm);
        return dm.widthPixels;
    }

    private int screenH() {
        android.util.DisplayMetrics dm = new android.util.DisplayMetrics();
        wm.getDefaultDisplay().getRealMetrics(dm);
        return dm.heightPixels;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private static int clamp(int v, int lo, int hi) { return Math.max(lo, Math.min(hi, v)); }

    private static String pick(String[] arr) { return arr[(int) (Math.random() * arr.length)]; }
}
