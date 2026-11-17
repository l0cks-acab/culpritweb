package com.lach.culpritweb;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPInputStream;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * The viewer's own small web server (the JDK's): the page and its script, each report by its id, and the live health
 * chart for a live link's id. Nothing is listed: a link's id is the key to it, as with a spark link.
 */
public final class WebServer {
    private static final Map<String, String> FILES = Map.of(
            "/app.js", "application/javascript; charset=utf-8",
            "/app.css", "text/css; charset=utf-8",
            "/icon.svg", "image/svg+xml");
    private static final Map<String, Long> LIVE = new ConcurrentHashMap<>();

    private final ReportStore store;
    private final HttpServer http;
    private final ExecutorService pool;
    private final Map<String, byte[]> cache = new ConcurrentHashMap<>();

    public WebServer(ReportStore store, String bind, int port) throws IOException {
        this.store = store;
        this.http = HttpServer.create(new InetSocketAddress(bind, port), 32);
        AtomicInteger n = new AtomicInteger();
        this.pool = Executors.newFixedThreadPool(4, r -> {
            Thread t = new Thread(r, "Culprit Web HTTP " + n.incrementAndGet());
            t.setDaemon(true);
            return t;
        });
        http.setExecutor(pool);
        http.createContext("/", this::handle);
    }

    public void start() {
        http.start();
    }

    public void stop() {
        http.stop(0);
        pool.shutdownNow();
    }

    /** A new live link's id, good for {@code minutes}. */
    public static String newLive(int minutes) {
        long now = System.currentTimeMillis();
        LIVE.values().removeIf(t -> t < now);
        String id = ReportStore.newId();
        LIVE.put(id, now + minutes * 60_000L);
        return id;
    }

    private void handle(HttpExchange x) throws IOException {
        try (x) {
            String method = x.getRequestMethod();
            if (!method.equals("GET") && !method.equals("HEAD")) {
                send(x, 405, "text/plain", "GET only".getBytes(StandardCharsets.UTF_8), false);
                return;
            }
            String path = x.getRequestURI().getPath();
            if (path.equals("/") || path.startsWith("/r/") || path.startsWith("/live/")) {
                send(x, 200, "text/html; charset=utf-8", resource("/app.html"), false);
            } else if (FILES.containsKey(path)) {
                send(x, 200, FILES.get(path), resource(path), false);
            } else if (path.startsWith("/api/report/")) {
                byte[] gz = store.gzipped(path.substring("/api/report/".length()));
                if (gz == null) {
                    send(x, 404, "application/json", "{\"error\":\"no such report\"}".getBytes(StandardCharsets.UTF_8), false);
                } else {
                    x.getResponseHeaders().set("Cache-Control", "private, max-age=31536000, immutable");
                    String accept = x.getRequestHeaders().getFirst("Accept-Encoding");
                    if (accept != null && accept.contains("gzip")) {
                        send(x, 200, "application/json", gz, true);
                    } else {
                        try (InputStream in = new GZIPInputStream(new java.io.ByteArrayInputStream(gz))) {
                            send(x, 200, "application/json", in.readAllBytes(), false);
                        }
                    }
                }
            } else if (path.startsWith("/api/live/")) {
                Long until = LIVE.get(path.substring("/api/live/".length()));
                if (until == null || until < System.currentTimeMillis()) {
                    send(x, 410, "application/json", "{\"error\":\"this live link has ended\"}".getBytes(StandardCharsets.UTF_8), false);
                } else {
                    x.getResponseHeaders().set("Cache-Control", "no-store");
                    String body = "{\"until\":" + until + ",\"server\":" + serverJson() + ",\"health\":" + Health.json() + "}";
                    send(x, 200, "application/json", body.getBytes(StandardCharsets.UTF_8), false);
                }
            } else {
                send(x, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8), false);
            }
        } catch (Exception e) {
            CulpritWeb.LOG.debug("Culprit Web request failed", e);
        }
    }

    private volatile String serverJson;

    private String serverJson() {
        if (serverJson == null && CulpritWeb.server() != null) {
            serverJson = ReportJson.server(CulpritWeb.server()).toString();
        }
        return serverJson == null ? "{}" : serverJson;
    }

    private byte[] resource(String name) throws IOException {
        byte[] b = cache.get(name);
        if (b == null) {
            try (InputStream in = WebServer.class.getResourceAsStream("/assets/culpritweb/web" + name)) {
                if (in == null) {
                    throw new IOException("missing " + name);
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                in.transferTo(out);
                b = out.toByteArray();
            }
            cache.put(name, b);
        }
        return b;
    }

    private static void send(HttpExchange x, int status, String type, byte[] body, boolean gzip) throws IOException {
        var h = x.getResponseHeaders();
        h.set("Content-Type", type);
        h.set("X-Content-Type-Options", "nosniff");
        h.set("Referrer-Policy", "no-referrer");
        h.set("X-Frame-Options", "DENY");
        h.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
        if (gzip) {
            h.set("Content-Encoding", "gzip");
        }
        boolean head = x.getRequestMethod().equals("HEAD");
        x.sendResponseHeaders(status, head ? -1 : body.length);
        if (!head) {
            try (OutputStream out = x.getResponseBody()) {
                out.write(body);
            }
        }
    }
}
