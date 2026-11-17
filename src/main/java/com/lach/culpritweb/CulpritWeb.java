package com.lach.culpritweb;

import org.slf4j.Logger;

import com.mojang.logging.LogUtils;

import net.minecraft.server.MinecraftServer;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/** Culprit Web: Culprit's scans as links to a web viewer the server serves itself. */
@Mod(CulpritWeb.MODID)
public final class CulpritWeb {
    public static final String MODID = "culpritweb";
    public static final Logger LOG = LogUtils.getLogger();

    private static MinecraftServer server;
    private static WebServer web;
    private static ReportStore store;

    public CulpritWeb(IEventBus modBus, ModContainer container) {
        container.registerConfig(ModConfig.Type.COMMON, Config.SPEC);
        NeoForge.EVENT_BUS.addListener((RegisterCommandsEvent e) -> Commands.register(e.getDispatcher()));
        NeoForge.EVENT_BUS.addListener(CulpritWeb::onStarted);
        NeoForge.EVENT_BUS.addListener(CulpritWeb::onStopping);
        NeoForge.EVENT_BUS.addListener((ServerTickEvent.Pre e) -> TickMonitor.pre());
        NeoForge.EVENT_BUS.addListener((ServerTickEvent.Post e) -> {
            TickMonitor.post();
            Health.tick(e.getServer());
            Profiler.tick(e.getServer());
        });
    }

    private static void onStarted(ServerStartedEvent e) {
        server = e.getServer();
        TickMonitor.reset();
        Health.reset();
        Profiler.reset();
        store = new ReportStore(server.getServerDirectory().resolve(MODID).resolve("reports"));
        if (Config.ENABLED.get()) {
            try {
                web = new WebServer(store, Config.BIND.get(), Config.PORT.get());
                web.start();
                LOG.info("Culprit Web viewer at {}", baseUrl());
            } catch (Exception ex) {
                LOG.error("Culprit Web could not open port {}: {}", Config.PORT.get(), ex.toString());
                web = null;
            }
        }
    }

    private static void onStopping(ServerStoppingEvent e) {
        if (web != null) {
            web.stop();
            web = null;
        }
        if (store != null) {
            store.close();
        }
        server = null;
    }

    public static MinecraftServer server() {
        return server;
    }

    public static ReportStore store() {
        return store;
    }

    public static boolean webUp() {
        return web != null;
    }

    /** Where players reach the viewer: the configured public URL, else this machine's address and port. */
    public static String baseUrl() {
        String url = Config.PUBLIC_URL.get().trim();
        if (!url.isEmpty()) {
            return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
        }
        String host = server != null && server.isDedicatedServer() && !server.getLocalIp().isBlank() ? server.getLocalIp() : "localhost";
        return "http://" + host + ":" + Config.PORT.get();
    }
}
