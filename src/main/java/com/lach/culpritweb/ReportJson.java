package com.lach.culpritweb;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import dev.culprit.chunks.ChunkText;
import dev.culprit.net.ChunkData;
import dev.culprit.net.ReportData;
import dev.culprit.report.Breakdown;
import dev.culprit.report.Names;
import dev.culprit.scan.Kind;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.neoforged.fml.ModList;

/** Culprit's report, census and the server's chart as the viewer's JSON: columns of numbers beside string tables. */
public final class ReportJson {
    public static final int FORMAT = 1;

    private ReportJson() {}

    public static JsonObject report(ReportData d) {
        JsonObject o = new JsonObject();
        Strings labels = new Strings();
        o.addProperty("ticks", d.ticks);
        o.addProperty("totalNs", d.tickNsTotal);
        o.addProperty("worstNs", d.tickNsMax);
        o.addProperty("medianNs", d.medianTickNs);
        o.addProperty("spikeThresholdNs", d.spikeThresholdNs);
        o.addProperty("incomplete", d.incomplete);
        o.addProperty("thingCount", d.thingCount);
        o.add("kindNs", longs(d.kindNs, d.kindNs.length));
        JsonArray groups = new JsonArray();
        long[] g = Breakdown.groups(d);
        for (int i = 0; i < g.length; i++) {
            JsonObject j = new JsonObject();
            j.addProperty("name", Breakdown.groupName(d, i).getString());
            j.addProperty("colour", String.format("#%06x", Breakdown.colour(d, i)));
            j.addProperty("ns", g[i]);
            groups.add(j);
        }
        o.add("groups", groups);
        JsonArray parts = new JsonArray();
        Map<String, Integer> kindByName = new HashMap<>();
        for (int k = 0; k < Kind.COUNT; k++) {
            String n = net.minecraft.network.chat.Component.translatableWithFallback("culprit.kind." + Kind.key(k), Kind.english(k)).getString();
            kindByName.put(n.isEmpty() ? n : Character.toUpperCase(n.charAt(0)) + n.substring(1), k);
        }
        for (Breakdown.Part p : Breakdown.parts(d)) {
            JsonObject j = new JsonObject();
            String name = p.name().getString();
            j.addProperty("name", name);
            Integer kindOf = d.frames ? null : kindByName.get(name);
            j.addProperty("kind", kindOf == null ? -1 : kindOf);
            j.addProperty("about", p.about().getString());
            j.addProperty("group", p.group());
            j.addProperty("ns", p.totalNs());
            parts.add(j);
        }
        o.add("parts", parts);
        o.add("dims", strings(d.dims));
        o.add("types", strings(d.names));

        JsonObject t = new JsonObject();
        JsonArray kind = new JsonArray(), dim = new JsonArray(), x = new JsonArray(), y = new JsonArray(), z = new JsonArray(), type = new JsonArray(),
                label = new JsonArray(), total = new JsonArray(), max = new JsonArray(), calls = new JsonArray();
        for (int i = 0; i < d.things; i++) {
            kind.add(d.kind[i]);
            dim.add(d.dim[i]);
            BlockPos p = BlockPos.of(d.pos[i]);
            x.add(p.getX());
            y.add(p.getY());
            z.add(p.getZ());
            type.add(d.type[i]);
            label.add(labels.id(Names.of(d.names[d.type[i]], d.kind[i])));
            total.add(d.total[i]);
            max.add(d.max[i]);
            calls.add(d.calls[i]);
        }
        t.add("kind", kind);
        t.add("dim", dim);
        t.add("x", x);
        t.add("y", y);
        t.add("z", z);
        t.add("type", type);
        t.add("label", label);
        t.add("total", total);
        t.add("max", max);
        t.add("calls", calls);
        o.add("things", t);

        JsonObject ty = new JsonObject();
        JsonArray tName = new JsonArray(), tLabel = new JsonArray(), tKind = new JsonArray(), tTotal = new JsonArray(), tCount = new JsonArray(),
                tDim = new JsonArray(), tx = new JsonArray(), tyy = new JsonArray(), tz = new JsonArray();
        for (int i = 0; i < d.types; i++) {
            tName.add(d.typeName[i]);
            tLabel.add(labels.id(Names.of(d.names[d.typeName[i]], d.typeKind[i])));
            tKind.add(d.typeKind[i]);
            tTotal.add(d.typeTotal[i]);
            tCount.add(d.typeCount[i]);
            tDim.add(d.typeWorstDim[i]);
            BlockPos p = BlockPos.of(d.typeWorstPos[i]);
            tx.add(p.getX());
            tyy.add(p.getY());
            tz.add(p.getZ());
        }
        ty.add("type", tName);
        ty.add("label", tLabel);
        ty.add("kind", tKind);
        ty.add("total", tTotal);
        ty.add("count", tCount);
        ty.add("worstDim", tDim);
        ty.add("worstX", tx);
        ty.add("worstY", tyy);
        ty.add("worstZ", tz);
        o.add("typeList", ty);

        JsonObject mo = new JsonObject();
        JsonArray mId = new JsonArray(), mName = new JsonArray(), mTotal = new JsonArray(), mCount = new JsonArray();
        for (int i = 0; i < d.mods; i++) {
            mId.add(d.names[d.modName[i]]);
            mName.add(Names.mod(d.names[d.modName[i]]));
            mTotal.add(d.modTotal[i]);
            mCount.add(d.modCount[i]);
        }
        mo.add("id", mId);
        mo.add("name", mName);
        mo.add("total", mTotal);
        mo.add("count", mCount);
        o.add("mods", mo);

        JsonObject ch = new JsonObject();
        JsonArray cDim = new JsonArray(), cx = new JsonArray(), cz = new JsonArray(), cTotal = new JsonArray(), cCount = new JsonArray(),
                cTop = new JsonArray(), cTopNs = new JsonArray(), cTopKind = new JsonArray();
        for (int i = 0; i < d.chunks; i++) {
            cDim.add(d.chunkDim[i]);
            cx.add(d.chunkX[i]);
            cz.add(d.chunkZ[i]);
            cTotal.add(d.chunkTotal[i]);
            cCount.add(d.chunkCount[i]);
            cTop.add(d.chunkTop[i] >= 0 ? labels.id(Names.of(d.names[d.chunkTop[i]], d.chunkTopKind[i])) : -1);
            cTopNs.add(d.chunkTopNs[i]);
            cTopKind.add(d.chunkTopKind[i]);
        }
        ch.add("dim", cDim);
        ch.add("x", cx);
        ch.add("z", cz);
        ch.add("total", cTotal);
        ch.add("count", cCount);
        ch.add("top", cTop);
        ch.add("topNs", cTopNs);
        ch.add("topKind", cTopKind);
        o.add("chunks", ch);
        o.add("labels", strings(labels.list.toArray(String[]::new)));
        if (d.spikes != null && d.spikes.ticks > 0) {
            o.add("spikes", report(d.spikes));
        }
        return o;
    }

    public static JsonObject kinds() {
        JsonObject o = new JsonObject();
        JsonArray key = new JsonArray(), name = new JsonArray(), about = new JsonArray(), chunkWide = new JsonArray();
        for (int k = 0; k < Kind.COUNT; k++) {
            key.add(Kind.key(k));
            name.add(Kind.englishOne(k));
            about.add(Kind.about(k));
            chunkWide.add(Kind.isChunkWide(k));
        }
        o.add("key", key);
        o.add("name", name);
        o.add("about", about);
        o.add("chunkWide", chunkWide);
        return o;
    }

    public static JsonObject chunks(ChunkData data) {
        JsonObject o = new JsonObject();
        o.addProperty("takenAt", data.takenAtMillis);
        JsonArray reasons = new JsonArray();
        for (int r = 0; r < ChunkData.REASONS; r++) {
            reasons.add(ChunkText.reasonName(r).getString());
        }
        o.add("reasons", reasons);
        JsonArray dims = new JsonArray();
        for (ChunkData.Dim d : data.dims) {
            JsonObject j = new JsonObject();
            j.addProperty("dim", d.dim);
            j.addProperty("edges", d.edges);
            j.addProperty("total", d.total);
            j.add("x", ints(d.x, d.chunks));
            j.add("z", ints(d.z, d.chunks));
            j.add("status", bytes(d.status, d.chunks));
            j.add("reason", bytes(d.reason, d.chunks));
            j.add("reasons", bytes(d.reasons, d.chunks));
            j.add("source", ints(d.source, d.chunks));
            j.add("blockEntities", ints(d.blockEntities, d.chunks));
            j.add("entities", ints(d.entities, d.chunks));
            JsonObject s = new JsonObject();
            s.add("x", ints(d.sx, d.sources));
            s.add("z", ints(d.sz, d.sources));
            s.add("level", ints(d.slevel, d.sources));
            s.add("reason", bytes(d.sreason, d.sources));
            JsonArray owner = new JsonArray();
            for (int i = 0; i < d.sources; i++) {
                owner.add(d.sowner[i]);
            }
            s.add("owner", owner);
            j.add("sources", s);
            dims.add(j);
        }
        o.add("dims", dims);
        return o;
    }

    public static JsonObject server(MinecraftServer server) {
        JsonObject o = new JsonObject();
        o.addProperty("minecraft", version("minecraft"));
        o.addProperty("neoforge", version("neoforge"));
        o.addProperty("culprit", version("culprit"));
        o.addProperty("culpritweb", version(CulpritWeb.MODID));
        o.addProperty("dedicated", server.isDedicatedServer());
        o.addProperty("motd", server.getMotd());
        o.addProperty("viewDistance", server.getPlayerList().getViewDistance());
        o.addProperty("simulationDistance", server.getPlayerList().getSimulationDistance());
        o.addProperty("java", System.getProperty("java.vendor") + " " + System.getProperty("java.version"));
        o.addProperty("vm", System.getProperty("java.vm.name"));
        o.addProperty("os", System.getProperty("os.name") + " " + System.getProperty("os.version") + " (" + System.getProperty("os.arch") + ")");
        o.addProperty("cores", Runtime.getRuntime().availableProcessors());
        o.addProperty("maxMemory", Runtime.getRuntime().maxMemory());
        JsonArray flags = new JsonArray();
        for (String a : java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments()) {
            if (a.startsWith("-X") || a.startsWith("-XX")) {
                flags.add(a);
            }
        }
        o.add("jvmFlags", flags);
        JsonArray mods = new JsonArray();
        ModList.get().getMods().stream().sorted((a, b) -> a.getDisplayName().compareToIgnoreCase(b.getDisplayName())).forEach(m -> {
            JsonObject j = new JsonObject();
            j.addProperty("id", m.getModId());
            j.addProperty("name", m.getDisplayName());
            j.addProperty("version", m.getVersion().toString());
            mods.add(j);
        });
        o.add("mods", mods);
        return o;
    }

    private static String version(String mod) {
        return ModList.get().getModContainerById(mod).map(c -> c.getModInfo().getVersion().toString()).orElse("?");
    }

    static JsonArray strings(String[] a) {
        JsonArray j = new JsonArray();
        for (String s : a) {
            j.add(s);
        }
        return j;
    }

    private static JsonArray longs(long[] a, int n) {
        JsonArray j = new JsonArray();
        for (int i = 0; i < n; i++) {
            j.add(a[i]);
        }
        return j;
    }

    private static JsonArray ints(int[] a, int n) {
        JsonArray j = new JsonArray();
        for (int i = 0; i < n; i++) {
            j.add(a[i]);
        }
        return j;
    }

    private static JsonArray bytes(byte[] a, int n) {
        JsonArray j = new JsonArray();
        for (int i = 0; i < n; i++) {
            j.add(a[i]);
        }
        return j;
    }

    static JsonArray floats(float[] a) {
        JsonArray j = new JsonArray();
        for (float f : a) {
            j.add(Math.round(f * 100) / 100.0);
        }
        return j;
    }

    private static final class Strings {
        final List<String> list = new java.util.ArrayList<>();
        final Map<String, Integer> ids = new HashMap<>();

        int id(String s) {
            return ids.computeIfAbsent(s, k -> {
                list.add(k);
                return list.size() - 1;
            });
        }
    }
}
