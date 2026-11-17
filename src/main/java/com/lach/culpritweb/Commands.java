package com.lach.culpritweb;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;

import dev.culprit.config.CulpritServerConfig;
import dev.culprit.scan.TickScan;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.network.chat.Component;

/** {@code /culpritweb} (and {@code /cweb}): profiler, last, chunks, health, list. */
public final class Commands {
    private Commands() {}

    static void register(CommandDispatcher<CommandSourceStack> d) {
        for (String root : new String[] {"culpritweb", "cweb"}) {
            d.register(tree(root));
        }
    }

    private static LiteralArgumentBuilder<CommandSourceStack> tree(String root) {
        return net.minecraft.commands.Commands.literal(root)
                .requires(s -> s.hasPermission(Config.PERMISSION.get()))
                .then(net.minecraft.commands.Commands.literal("profiler")
                        .executes(c -> profile(c, Config.DEFAULT_SECONDS.get()))
                        .then(net.minecraft.commands.Commands.argument("seconds", IntegerArgumentType.integer(1, 600))
                                .executes(c -> profile(c, IntegerArgumentType.getInteger(c, "seconds"))))
                        .then(net.minecraft.commands.Commands.literal("start")
                                .executes(c -> profile(c, Config.DEFAULT_SECONDS.get()))
                                .then(net.minecraft.commands.Commands.argument("seconds", IntegerArgumentType.integer(1, 600))
                                        .executes(c -> profile(c, IntegerArgumentType.getInteger(c, "seconds")))))
                        .then(net.minecraft.commands.Commands.literal("stop").executes(Commands::stop)))
                .then(net.minecraft.commands.Commands.literal("last").executes(Commands::last))
                .then(net.minecraft.commands.Commands.literal("chunks").executes(Commands::chunks))
                .then(net.minecraft.commands.Commands.literal("health").executes(Commands::health))
                .then(net.minecraft.commands.Commands.literal("list").executes(Commands::list));
    }

    private static boolean ready(CommandSourceStack s) {
        if (CulpritWeb.store() == null) {
            s.sendFailure(Component.literal("Culprit Web is not running."));
            return false;
        }
        if (!CulpritWeb.webUp()) {
            s.sendSystemMessage(Component.literal("The viewer is off or its port is taken (see the log); reports are still saved.")
                    .withStyle(ChatFormatting.YELLOW));
        }
        return true;
    }

    private static String by(CommandSourceStack s) {
        return s.getTextName();
    }

    private static int profile(CommandContext<CommandSourceStack> c, int seconds) {
        CommandSourceStack s = c.getSource();
        if (!ready(s)) {
            return 0;
        }
        int max = CulpritServerConfig.maxSeconds();
        int secs = Math.min(seconds, max);
        int left = TickScan.ticksLeft();
        if (left >= 0) {
            s.sendFailure(Component.literal("A scan is already running (" + (left + 19) / 20 + " s left). /culpritweb profiler stop ends it."));
            return 0;
        }
        String by = by(s);
        boolean started = Profiler.start(secs * 20, by, id -> {
            CulpritWeb.LOG.info("Culprit Web profile by {}: {}", by, Profiler.url("/r/" + id));
            s.sendSuccess(() -> Component.literal("Profile done: ").withStyle(ChatFormatting.GRAY).append(Profiler.link("/r/" + id)), false);
        });
        if (!started) {
            s.sendFailure(Component.literal("Culprit would not start a scan just now."));
            return 0;
        }
        s.sendSuccess(() -> Component.literal("Profiling the server for " + secs + " s" + (secs < seconds ? " (Culprit's maxSeconds)" : "")
                + ". /culpritweb profiler stop ends it early.").withStyle(ChatFormatting.GOLD), true);
        return secs;
    }

    private static int stop(CommandContext<CommandSourceStack> c) {
        if (!TickScan.stopNow(true)) {
            c.getSource().sendFailure(Component.literal("No scan is running."));
            return 0;
        }
        c.getSource().sendSuccess(() -> Component.literal("Stopping; the link follows.").withStyle(ChatFormatting.GRAY), false);
        return 1;
    }

    private static int last(CommandContext<CommandSourceStack> c) {
        CommandSourceStack s = c.getSource();
        if (!ready(s)) {
            return 0;
        }
        String id = Profiler.saveLast(by(s));
        if (id == null) {
            s.sendFailure(Component.literal("No scan has finished yet. /culpritweb profiler runs one."));
            return 0;
        }
        s.sendSuccess(() -> Component.literal("Last scan: ").withStyle(ChatFormatting.GRAY).append(Profiler.link("/r/" + id)), false);
        return 1;
    }

    private static int chunks(CommandContext<CommandSourceStack> c) {
        CommandSourceStack s = c.getSource();
        if (!ready(s)) {
            return 0;
        }
        String id = Profiler.saveChunks(by(s));
        s.sendSuccess(() -> Component.literal("Loaded chunks: ").withStyle(ChatFormatting.GRAY).append(Profiler.link("/r/" + id)), false);
        return 1;
    }

    private static int health(CommandContext<CommandSourceStack> c) {
        CommandSourceStack s = c.getSource();
        if (!ready(s)) {
            return 0;
        }
        int minutes = Config.LIVE_MINUTES.get();
        String id = WebServer.newLive(minutes);
        s.sendSuccess(() -> Component.literal("Live health (" + minutes + " min): ").withStyle(ChatFormatting.GRAY)
                .append(Profiler.link("/live/" + id)), false);
        return 1;
    }

    private static int list(CommandContext<CommandSourceStack> c) {
        CommandSourceStack s = c.getSource();
        if (!ready(s)) {
            return 0;
        }
        List<String> ids = CulpritWeb.store().list();
        if (ids.isEmpty()) {
            s.sendSuccess(() -> Component.literal("No reports yet.").withStyle(ChatFormatting.GRAY), false);
            return 0;
        }
        SimpleDateFormat f = new SimpleDateFormat("MMM d HH:mm");
        s.sendSuccess(() -> Component.literal("Recent reports:").withStyle(ChatFormatting.GOLD), false);
        for (String id : ids.subList(0, Math.min(10, ids.size()))) {
            String when = f.format(new Date(CulpritWeb.store().created(id)));
            s.sendSuccess(() -> Component.literal(" " + when + "  ").withStyle(ChatFormatting.GRAY).append(Profiler.link("/r/" + id)), false);
        }
        return ids.size();
    }
}
