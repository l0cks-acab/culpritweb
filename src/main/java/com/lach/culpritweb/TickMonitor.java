package com.lach.culpritweb;

import java.util.Arrays;

/** Every server tick's length and end time, the last 15 minutes of them, kept on the server thread. */
public final class TickMonitor {
    static final int CAP = 20 * 60 * 15;
    private static final long[] DUR = new long[CAP];
    private static final long[] END = new long[CAP];
    private static long count;
    private static long startNs;
    private static long startedMs;

    private TickMonitor() {}

    static void reset() {
        count = 0;
        startedMs = System.currentTimeMillis();
    }

    static void pre() {
        startNs = System.nanoTime();
    }

    static void post() {
        if (startNs == 0) {
            return;
        }
        int i = (int) (count % CAP);
        DUR[i] = System.nanoTime() - startNs;
        END[i] = System.currentTimeMillis();
        count++;
    }

    static long count() {
        return count;
    }

    /** Ticks a second over the last {@code seconds} (or since the start, if shorter), at most 20. */
    static double tps(int seconds) {
        long now = System.currentTimeMillis();
        long from = now - seconds * 1000L;
        long n = 0;
        long avail = Math.min(count, CAP);
        for (long k = 1; k <= avail; k++) {
            if (END[(int) ((count - k) % CAP)] < from) {
                break;
            }
            n++;
        }
        double window = Math.max(1.0, Math.min(seconds, (now - startedMs) / 1000.0));
        return Math.min(20.0, n / window);
    }

    /** min, median, 95th percentile, max and mean of the last {@code ticks} ticks, in milliseconds. */
    static double[] mspt(int ticks) {
        int n = (int) Math.min(Math.min(count, CAP), ticks);
        if (n == 0) {
            return new double[5];
        }
        long[] v = new long[n];
        long sum = 0;
        for (int k = 0; k < n; k++) {
            v[k] = DUR[(int) ((count - 1 - k) % CAP)];
            sum += v[k];
        }
        Arrays.sort(v);
        return new double[] {v[0] / 1e6, v[n / 2] / 1e6, v[Math.min(n - 1, (int) Math.ceil(n * 0.95) - 1)] / 1e6, v[n - 1] / 1e6, sum / 1e6 / n};
    }

    /** Lengths in ms and end times of the kept ticks that ended at or after {@code fromMs}, oldest first. */
    static float[][] since(long fromMs) {
        long avail = Math.min(count, CAP);
        int n = 0;
        while (n < avail && END[(int) ((count - 1 - n) % CAP)] >= fromMs) {
            n++;
        }
        float[] ms = new float[n];
        float[] at = new float[n];
        for (int k = 0; k < n; k++) {
            int i = (int) ((count - n + k) % CAP);
            ms[k] = DUR[i] / 1e6f;
            at[k] = (END[i] - fromMs) / 1000f;
        }
        return new float[][] {ms, at};
    }
}
