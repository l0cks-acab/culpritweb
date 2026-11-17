package com.lach.culpritweb;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.GZIPOutputStream;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

/** Reports as gzipped JSON files under the server's culpritweb/reports, named by their link's id. */
public final class ReportStore {
    public static final Pattern ID = Pattern.compile("[A-Za-z0-9]{10}");
    private static final String ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Gson GSON = new Gson();

    private final Path dir;
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Culprit Web IO");
        t.setDaemon(true);
        return t;
    });
    /** The last report made, kept in memory until it is on disk. */
    private volatile String pendingId;
    private volatile byte[] pendingBytes;

    public ReportStore(Path dir) {
        this.dir = dir;
    }

    public static String newId() {
        StringBuilder s = new StringBuilder(10);
        for (int i = 0; i < 10; i++) {
            s.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        }
        return s.toString();
    }

    /** Stores the report and returns its id; the JSON is made here, the file written off the server thread. */
    public String save(JsonObject report) {
        String id = newId();
        report.addProperty("id", id);
        String json = GSON.toJson(report);
        io.execute(() -> {
            try {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream(json.length() / 4);
                try (GZIPOutputStream gz = new GZIPOutputStream(bytes)) {
                    gz.write(json.getBytes(StandardCharsets.UTF_8));
                }
                byte[] b = bytes.toByteArray();
                pendingId = id;
                pendingBytes = b;
                Files.createDirectories(dir);
                Path tmp = dir.resolve(id + ".json.gz.tmp");
                Files.write(tmp, b);
                Files.move(tmp, dir.resolve(id + ".json.gz"), java.nio.file.StandardCopyOption.ATOMIC_MOVE);
                prune();
            } catch (IOException e) {
                CulpritWeb.LOG.error("Culprit Web could not save report {}", id, e);
            }
        });
        return id;
    }

    /** The report's gzipped JSON, or null when there is none by that id. */
    public byte[] gzipped(String id) throws IOException {
        if (!ID.matcher(id).matches()) {
            return null;
        }
        if (id.equals(pendingId) && pendingBytes != null) {
            return pendingBytes;
        }
        Path file = dir.resolve(id + ".json.gz");
        if (!Files.isRegularFile(file)) {
            try {
                io.submit(() -> {}).get(5, TimeUnit.SECONDS);       // still being written
            } catch (Exception ignored) {
            }
            if (!Files.isRegularFile(file)) {
                return null;
            }
        }
        return Files.readAllBytes(file);
    }

    /** Ids of the stored reports, newest first. */
    public List<String> list() {
        List<Path> files = new ArrayList<>();
        if (Files.isDirectory(dir)) {
            try (Stream<Path> s = Files.list(dir)) {
                s.filter(p -> p.getFileName().toString().endsWith(".json.gz")).forEach(files::add);
            } catch (IOException ignored) {
            }
        }
        files.sort(Comparator.comparingLong(ReportStore::modified).reversed());
        List<String> ids = new ArrayList<>();
        for (Path p : files) {
            String n = p.getFileName().toString();
            ids.add(n.substring(0, n.length() - ".json.gz".length()));
        }
        return ids;
    }

    public long created(String id) {
        return modified(dir.resolve(id + ".json.gz"));
    }

    private void prune() {
        List<String> ids = list();
        for (int i = Config.KEEP.get(); i < ids.size(); i++) {
            try {
                Files.deleteIfExists(dir.resolve(ids.get(i) + ".json.gz"));
            } catch (IOException ignored) {
            }
        }
    }

    private static long modified(Path p) {
        try {
            return Files.getLastModifiedTime(p).toMillis();
        } catch (IOException e) {
            return 0;
        }
    }

    public void close() {
        io.shutdown();
        try {
            io.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
        }
    }
}
