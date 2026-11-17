package com.lach.culpritweb;

import java.util.function.Consumer;

import javax.annotation.Nullable;

import com.google.gson.JsonObject;

import dev.culprit.chunks.ChunkCensus;
import dev.culprit.net.ReportData;
import dev.culprit.scan.ScanReport;
import dev.culprit.scan.TickScan;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/** Starts Culprit's tick scans, turns finished ones (ours and anyone's) into stored reports, and hands out links. */
public final class Profiler {
    @Nullable private static ScanReport seen;
    @Nullable private static ScanReport ours;

    private Profiler() {}

    static void reset() {
        seen = TickScan.last();
        ours = null;
    }

    /** Starts a scan; {@code done} gets the link's id (on the server thread), or null when it could not be stored. */
    static boolean start(int ticks, String by, Consumer<String> done) {
        return TickScan.start(ticks, report -> {
            ours = report;
            seen = report;
            done.accept(save(report, "profiler", by));
        });
    }

    /** The last finished scan as a report (null when there was none). */
    @Nullable static String saveLast(String by) {
        ScanReport r = TickScan.last();
        return r == null ? null : save(r, "last", by);
    }

    static String saveChunks(String by) {
        MinecraftServer server = CulpritWeb.server();
        JsonObject o = header("chunks", "chunks", by, server);
        o.add("chunks", ReportJson.chunks(ChunkCensus.take(server)));
        return CulpritWeb.store().save(o);
    }

    static String save(ScanReport r, String source, String by) {
        MinecraftServer server = CulpritWeb.server();
        JsonObject o = header("ticks", source, by, server);
        o.addProperty("startedAt", r.startedAtMillis);
        o.add("report", ReportJson.report(ReportData.of(r)));
        float[][] tl = TickMonitor.since(r.startedAtMillis);
        JsonObject timeline = new JsonObject();
        timeline.add("ms", ReportJson.floats(tl[0]));
        timeline.add("at", ReportJson.floats(tl[1]));
        o.add("timeline", timeline);
        if (Config.WITH_CHUNKS.get()) {
            o.add("chunks", ReportJson.chunks(ChunkCensus.take(server)));
        }
        return CulpritWeb.store().save(o);
    }

    private static JsonObject header(String kind, String source, String by, MinecraftServer server) {
        JsonObject o = new JsonObject();
        o.addProperty("format", "culpritweb");
        o.addProperty("version", ReportJson.FORMAT);
        o.addProperty("kind", kind);
        o.addProperty("source", source);
        o.addProperty("by", by);
        o.addProperty("created", System.currentTimeMillis());
        o.add("server", ReportJson.server(server));
        o.add("health", Health.snapshot(server, false));
        o.add("kinds", ReportJson.kinds());
        return o;
    }

    /** Catches scans started elsewhere (F8, /culprit scan) and sends their links to whoever may see them. */
    static void tick(MinecraftServer server) {
        ScanReport last = TickScan.last();
        if (last == seen) {
            return;
        }
        seen = last;
        if (last == null || last == ours || !Config.AUTO_LINK.get() || CulpritWeb.store() == null) {
            return;
        }
        String id = save(last, "auto", "");
        CulpritWeb.LOG.info("Culprit scan report: {}", url("/r/" + id));
        Component msg = Component.literal("Culprit scan finished: ").withStyle(ChatFormatting.GRAY).append(link("/r/" + id));
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            if (p.hasPermissions(Config.PERMISSION.get())) {
                p.sendSystemMessage(msg);
            }
        }
    }

    static String url(String path) {
        return CulpritWeb.baseUrl() + path;
    }

    static MutableComponent link(String path) {
        String url = url(path);
        return Component.literal(url).withStyle(s -> s.withColor(0xF06CC8).withUnderlined(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.OPEN_URL, url))
                .withHoverEvent(new HoverEvent(HoverEvent.Action.SHOW_TEXT, Component.literal("Open in your browser"))));
    }
}
