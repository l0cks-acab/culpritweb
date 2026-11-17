package com.lach.culpritweb;

import net.neoforged.neoforge.common.ModConfigSpec;

public final class Config {
    private static final ModConfigSpec.Builder B = new ModConfigSpec.Builder();

    public static final ModConfigSpec.BooleanValue ENABLED;
    public static final ModConfigSpec.ConfigValue<String> BIND;
    public static final ModConfigSpec.IntValue PORT;
    public static final ModConfigSpec.ConfigValue<String> PUBLIC_URL;
    public static final ModConfigSpec.IntValue PERMISSION;
    public static final ModConfigSpec.IntValue DEFAULT_SECONDS;
    public static final ModConfigSpec.BooleanValue AUTO_LINK;
    public static final ModConfigSpec.BooleanValue WITH_CHUNKS;
    public static final ModConfigSpec.IntValue KEEP;
    public static final ModConfigSpec.IntValue LIVE_MINUTES;

    static {
        B.push("web");
        ENABLED = B.comment("Serve the viewer. Off: commands still save reports, but no links work.").define("enabled", true);
        BIND = B.comment("Address the viewer listens on. 0.0.0.0 for every interface, 127.0.0.1 for this machine only.")
                .define("bind", "0.0.0.0");
        PORT = B.comment("Port the viewer listens on. Open it in your host's firewall to share links.").defineInRange("port", 8765, 1, 65535);
        PUBLIC_URL = B.comment("How players reach the viewer, e.g. https://lag.example.com or http://203.0.113.5:8765.",
                "Empty: the server's own address (server-ip in server.properties, else localhost) and the port above.")
                .define("publicUrl", "");
        B.pop().push("profiler");
        PERMISSION = B.comment("Permission level for /culpritweb: 2 operators (default), 3 admins, 4 owner.").defineInRange("permissionLevel", 2, 0, 4);
        DEFAULT_SECONDS = B.comment("Seconds a /culpritweb profiler runs when no time is given (capped by Culprit's maxSeconds).")
                .defineInRange("defaultSeconds", 30, 1, 600);
        AUTO_LINK = B.comment("Also make a link when a scan started some other way finishes (F8, /culprit scan), and send it to operators.")
                .define("autoLink", true);
        WITH_CHUNKS = B.comment("Add the chunk inspector's census (every loaded chunk and why) to each report.").define("withChunks", true);
        KEEP = B.comment("Reports kept on disk; the oldest go first.").defineInRange("keepReports", 100, 1, 10000);
        LIVE_MINUTES = B.comment("Minutes a /culpritweb health link stays live.").defineInRange("liveMinutes", 60, 1, 1440);
        B.pop();
    }

    public static final ModConfigSpec SPEC = B.build();

    private Config() {}
}
