package com.lach.culpritweb;

import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.OperatingSystemMXBean;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;

/**
 * The server's health, like a doctor's chart: ticks a second, time a tick, CPU, memory, garbage collection, players
 * and each world's chunks and entities. Taken on the server thread once a second; the web server reads the last one.
 */
public final class Health {
    static final int SECONDS = 600;
    private static final float[] S_MSPT = new float[SECONDS], S_MAX = new float[SECONDS], S_TPS = new float[SECONDS],
            S_CPU = new float[SECONDS], S_MEM = new float[SECONDS];
    private static final long[] S_AT = new long[SECONDS];
    private static int seconds;
    private static long lastSecond;
    private static long lastTickCount;
    private static volatile String json = "{}";
    private static double lastCpu;

    private Health() {}

    static void reset() {
        seconds = 0;
        lastSecond = 0;
        lastTickCount = 0;
        json = "{}";
    }

    static String json() {
        return json;
    }

    static void tick(MinecraftServer server) {
        long now = System.currentTimeMillis();
        long sec = now / 1000;
        if (sec == lastSecond) {
            return;
        }
        boolean first = lastSecond == 0;
        lastSecond = sec;
        long ticks = TickMonitor.count();
        int n = (int) Math.min(ticks - lastTickCount, 200);
        lastTickCount = ticks;
        if (first) {
            return;
        }
        double[] m = TickMonitor.mspt(Math.max(1, n));
        int i = seconds % SECONDS;
        S_AT[i] = now;
        S_MSPT[i] = (float) m[4];
        S_MAX[i] = (float) m[3];
        S_TPS[i] = (float) TickMonitor.tps(1);
        lastCpu = processCpu();
        S_CPU[i] = (float) lastCpu;
        Runtime rt = Runtime.getRuntime();
        S_MEM[i] = (rt.totalMemory() - rt.freeMemory()) / 1048576f;
        seconds++;
        json = snapshot(server, true).toString();
    }

    static double processCpu() {
        OperatingSystemMXBean os = ManagementFactory.getOperatingSystemMXBean();
        if (os instanceof com.sun.management.OperatingSystemMXBean sun) {
            return Math.max(0, sun.getProcessCpuLoad());
        }
        return 0;
    }

    static double systemCpu() {
        OperatingSystemMXBean os = ManagementFactory.getOperatingSystemMXBean();
        if (os instanceof com.sun.management.OperatingSystemMXBean sun) {
            return Math.max(0, sun.getCpuLoad());
        }
        return Math.max(0, os.getSystemLoadAverage());
    }

    /** The chart now; with {@code series}, the last ten minutes second by second too. Server thread only. */
    static JsonObject snapshot(MinecraftServer server, boolean series) {
        JsonObject o = new JsonObject();
        o.addProperty("at", System.currentTimeMillis());
        JsonObject tps = new JsonObject();
        tps.addProperty("s5", TickMonitor.tps(5));
        tps.addProperty("s10", TickMonitor.tps(10));
        tps.addProperty("m1", TickMonitor.tps(60));
        tps.addProperty("m5", TickMonitor.tps(300));
        tps.addProperty("m15", TickMonitor.tps(900));
        o.add("tps", tps);
        JsonObject mspt = new JsonObject();
        mspt.add("s10", stats(TickMonitor.mspt(200)));
        mspt.add("m1", stats(TickMonitor.mspt(1200)));
        mspt.add("m5", stats(TickMonitor.mspt(6000)));
        o.add("mspt", mspt);
        JsonObject cpu = new JsonObject();
        cpu.addProperty("process", lastCpu > 0 ? lastCpu : processCpu());
        cpu.addProperty("system", systemCpu());
        cpu.addProperty("cores", Runtime.getRuntime().availableProcessors());
        o.add("cpu", cpu);
        Runtime rt = Runtime.getRuntime();
        JsonObject mem = new JsonObject();
        mem.addProperty("used", rt.totalMemory() - rt.freeMemory());
        mem.addProperty("committed", rt.totalMemory());
        mem.addProperty("max", rt.maxMemory());
        o.add("memory", mem);
        JsonArray gcs = new JsonArray();
        for (GarbageCollectorMXBean gc : ManagementFactory.getGarbageCollectorMXBeans()) {
            JsonObject g = new JsonObject();
            g.addProperty("name", gc.getName());
            g.addProperty("count", gc.getCollectionCount());
            g.addProperty("timeMs", gc.getCollectionTime());
            gcs.add(g);
        }
        o.add("gc", gcs);
        o.addProperty("threads", ManagementFactory.getThreadMXBean().getThreadCount());
        o.addProperty("uptimeMs", ManagementFactory.getRuntimeMXBean().getUptime());
        JsonObject players = new JsonObject();
        players.addProperty("online", server.getPlayerCount());
        players.addProperty("max", server.getMaxPlayers());
        o.add("players", players);
        JsonArray worlds = new JsonArray();
        for (ServerLevel level : server.getAllLevels()) {
            JsonObject w = new JsonObject();
            w.addProperty("dim", level.dimension().location().toString());
            w.addProperty("chunks", level.getChunkSource().getLoadedChunksCount());
            int entities = 0;
            for (Entity ignored : level.getAllEntities()) {
                entities++;
            }
            w.addProperty("entities", entities);
            w.addProperty("players", level.players().size());
            worlds.add(w);
        }
        o.add("worlds", worlds);
        if (series) {
            int n = Math.min(seconds, SECONDS);
            JsonArray at = new JsonArray(), ms = new JsonArray(), mx = new JsonArray(), tp = new JsonArray(), cp = new JsonArray(), me = new JsonArray();
            for (int k = n; k >= 1; k--) {
                int i = (seconds - k) % SECONDS;
                at.add(S_AT[i]);
                ms.add(round(S_MSPT[i]));
                mx.add(round(S_MAX[i]));
                tp.add(round(S_TPS[i]));
                cp.add(round(S_CPU[i] * 100));
                me.add(Math.round(S_MEM[i]));
            }
            JsonObject s = new JsonObject();
            s.add("at", at);
            s.add("mspt", ms);
            s.add("msptMax", mx);
            s.add("tps", tp);
            s.add("cpu", cp);
            s.add("memMb", me);
            o.add("series", s);
        }
        return o;
    }

    private static JsonObject stats(double[] v) {
        JsonObject o = new JsonObject();
        o.addProperty("min", round(v[0]));
        o.addProperty("median", round(v[1]));
        o.addProperty("p95", round(v[2]));
        o.addProperty("max", round(v[3]));
        o.addProperty("mean", round(v[4]));
        return o;
    }

    static double round(double v) {
        return Math.round(v * 100) / 100.0;
    }
}
