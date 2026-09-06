package com.sqwack

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private const val SHOWS_REMAINING_KEY = "sqwack.usageShowsRemaining"

@Composable
fun OverviewScreen(store: SqwackStore) {
    val compact = isCompact()
    val now by rememberNow()
    val machineId = store.selectedMachineId
    val visibleNodes = store.nodes.filter { it.machine != null && (machineId == null || it.machine?.id == machineId) }

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = if (compact) 16.dp else 26.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // Top strip: status headline + agent cards.
        if (compact) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                StatusHeader(store, machineId)
                AgentCardsRow(store, machineId, now, compact = true)
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
                Box(Modifier.widthIn(min = 240.dp, max = 300.dp)) { StatusHeader(store, machineId) }
                Box(Modifier.weight(1f)) { AgentCardsRow(store, machineId, now, compact = false) }
            }
        }

        val panels: List<@Composable (Modifier) -> Unit> = listOf(
            { m -> ServicesPanel(store, machineId, m) },
            { m -> SystemPanel(visibleNodes, compact, m) },
            { m -> ActivityPanel(store.activity(machineId), now, m) },
        )
        if (compact) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) { panels.forEach { it(Modifier) } }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.Top) {
                panels.forEach { panel -> Box(Modifier.weight(1f)) { panel(Modifier) } }
            }
        }

        AccountUsageBand(store, machineId, store.usage(machineId), now, compact)
    }
}

@Composable
private fun StatusHeader(store: SqwackStore, machineId: String?) {
    val status = store.status(machineId)
    val working = store.sessions(machineId).count { it.state == AgentState.WORKING }
    val services = store.processes(machineId).size
    val subline = buildList {
        if (working > 0) add("$working agent${if (working == 1) "" else "s"} working")
        if (services > 0) add("$services service${if (services == 1) "" else "s"}")
    }.joinToString(" · ").ifEmpty { "Nothing running" }
    val needLine = when (status) {
        SqwackStatus.ATTENTION -> "Agents are waiting for you"
        SqwackStatus.FAILURE -> "Something failed"
        else -> "Nothing needs you right now."
    }

    Column(Modifier.height(132.dp), verticalArrangement = Arrangement.Center) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Dot(status.color, 18.dp, Modifier.attentionPulse(status == SqwackStatus.ATTENTION))
            Text(
                status.headline,
                fontSize = 34.sp,
                fontWeight = FontWeight.Black,
                color = if (status == SqwackStatus.QUIET) Palette.primaryText else status.color,
                maxLines = 1,
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(subline, fontSize = 15.sp, color = Palette.secondaryText)
        Text(
            needLine,
            fontSize = 15.sp,
            color = if (status == SqwackStatus.ATTENTION || status == SqwackStatus.FAILURE) status.color else Palette.secondaryText,
        )
        if (!store.anyConnected) {
            Text("Reconnecting…", fontSize = 12.sp, color = Palette.orange)
        }
    }
}

@Composable
private fun AgentCardsRow(store: SqwackStore, machineId: String?, now: Instant, compact: Boolean) {
    val sessions = store.boardSessions(machineId)
    if (sessions.isEmpty()) {
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 132.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Palette.panel)
                .border(1.dp, Palette.stroke, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text("No recent agent activity", color = Palette.tertiaryText)
        }
        return
    }
    val cards: @Composable () -> Unit = {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            sessions.take(4).forEach { AgentCard(it, now) }
        }
    }
    if (compact) Row(Modifier.horizontalScroll(rememberScrollState())) { cards() } else cards()
}

@Composable
fun AgentCard(session: AgentSession, now: Instant) {
    val timeLabel = when (session.state) {
        AgentState.NEEDS_INPUT -> "Waiting " + (session.waitingSince ?: session.updatedAt).elapsedLabel(now)
        AgentState.WORKING -> "Running " + (session.startedAt ?: session.updatedAt).elapsedLabel(now)
        else -> session.updatedAt.agoLabel(now).sentenceCased
    }
    val borderColor = session.state.color.copy(alpha = if (session.state == AgentState.WORKING) 0.8f else 0.25f)
    Column(
        Modifier
            .width(210.dp)
            .height(132.dp)
            .attentionPulse(session.state == AgentState.NEEDS_INPUT)
            .clip(RoundedCornerShape(16.dp))
            .background(Palette.panel)
            .border(if (session.state == AgentState.WORKING) 1.2.dp else 1.dp, borderColor, RoundedCornerShape(16.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ProviderBadge(session.provider, 30.dp)
            Column {
                Text(session.provider.providerLabel, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Palette.primaryText)
                Text(
                    session.projectName ?: session.title ?: session.source,
                    fontSize = 11.sp,
                    color = Palette.secondaryText,
                    maxLines = 1,
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Dot(session.state.color, 9.dp)
            Text(session.state.label, fontSize = 13.sp, fontWeight = FontWeight.Black, color = session.state.color)
        }
        Text(timeLabel, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = Palette.secondaryText)
        Sparkline(
            (session.activity ?: emptyList()).map { it.toDouble() },
            session.state.color,
            Modifier.fillMaxWidth().height(16.dp),
        )
    }
}

// MARK: - Account usage

@Composable
private fun AccountUsageBand(
    store: SqwackStore,
    machineId: String?,
    usages: List<ProviderUsage>,
    now: Instant,
    compact: Boolean,
) {
    val prefs = LocalContext.current.applicationContext.getSharedPreferences("sqwack", Context.MODE_PRIVATE)
    var showsRemaining by remember { mutableStateOf(prefs.getBoolean(SHOWS_REMAINING_KEY, false)) }
    var menuOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Palette.panel)
            .border(1.dp, Palette.stroke, RoundedCornerShape(16.dp))
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("ACCOUNT USAGE", fontSize = 17.sp, fontWeight = FontWeight.Black, color = Palette.primaryText)
            Text(if (showsRemaining) "Remaining" else "Consumed", fontSize = 13.sp, color = Palette.secondaryText)
            Spacer(Modifier.weight(1f))
            Box {
                Icon(
                    Icons.Default.Refresh,
                    "Refresh account usage",
                    tint = Palette.primaryText,
                    modifier = Modifier.size(30.dp).clickable { menuOpen = true },
                )
                DropdownMenu(menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(showsRemaining, null); Text("Show Remaining") } },
                        onClick = {
                            showsRemaining = !showsRemaining
                            prefs.edit().putBoolean(SHOWS_REMAINING_KEY, showsRemaining).apply()
                        },
                    )
                    listOf("codex" to "Refresh Codex Usage", "claude" to "Refresh Claude Usage", "deepseek" to "Refresh DeepSeek Balance")
                        .forEach { (provider, label) ->
                            DropdownMenuItem(
                                text = { Text(label) },
                                onClick = { scope.launch { store.refreshUsage(provider, machineId) }; menuOpen = false },
                            )
                        }
                }
            }
        }
        if (usages.isEmpty()) {
            Box(Modifier.fillMaxWidth().heightIn(min = 86.dp)) {
                Text("Refresh usage when you need it.", color = Palette.tertiaryText)
            }
        } else if (compact) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                usages.forEachIndexed { index, usage ->
                    UsageColumn(usage, showsRemaining, now)
                    if (index < usages.size - 1) Box(Modifier.fillMaxWidth().height(1.dp).background(Palette.stroke))
                }
            }
        } else {
            Row(verticalAlignment = Alignment.Top) {
                usages.forEachIndexed { index, usage ->
                    Box(Modifier.weight(1f)) { UsageColumn(usage, showsRemaining, now) }
                    if (index < usages.size - 1) {
                        Box(Modifier.padding(horizontal = 24.dp).width(1.dp).height(96.dp).background(Palette.stroke))
                    }
                }
            }
        }
    }
}

@Composable
private fun UsageColumn(usage: ProviderUsage, showsRemaining: Boolean, now: Instant) {
    // The window that should dominate the card: the shortest (most urgent).
    val primary = usage.windows.minByOrNull { it.label }
    fun percent(window: UsageWindow) = if (showsRemaining) (100 - window.usedPercent).coerceAtLeast(0.0) else window.usedPercent
    val barColor = when {
        primary == null -> Palette.green
        primary.usedPercent >= 90 -> Palette.red
        primary.usedPercent >= 70 -> Palette.amber
        else -> Palette.blue
    }
    val displayName = when (usage.provider.lowercase(Locale.US)) {
        "codex" -> "Codex"
        "claude" -> "Claude"
        "deepseek" -> "DeepSeek"
        else -> usage.provider.replaceFirstChar { it.uppercase() }
    }
    val planLabel = when (usage.provider.lowercase(Locale.US)) {
        "codex" -> usage.planType?.takeIf { it.lowercase(Locale.US) != "chatgpt" }?.uppercase(Locale.US)
        "claude" -> null
        "deepseek" -> "API"
        else -> usage.planType?.uppercase(Locale.US)
    }
    val isBalanceStyle = usage.provider.lowercase(Locale.US) == "deepseek" || primary?.detail?.contains("$") == true
    val metricText = when {
        primary == null -> "--"
        isBalanceStyle && primary.detail != null -> primary.detail.substringBefore("(").trim()
        else -> "${percent(primary).toInt()}%"
    }
    val detailText =
        if (isBalanceStyle) primary?.detail ?: usage.source
        else usage.windows.joinToString(" / ") { "${it.label} ${percent(it).toInt()}%" }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ProviderBadge(usage.provider, 28.dp)
            Text(displayName, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.primaryText)
            if (planLabel != null) {
                Text(
                    planLabel,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = Palette.purple,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(Palette.purple.copy(alpha = 0.18f))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
            Spacer(Modifier.weight(1f))
            val stale = now.epochSecond - usage.collectedAt.epochSecond > 15 * 60
            Text(
                "Cached · ${usage.collectedAt.agoLabel(now)}",
                fontSize = 11.sp,
                color = if (stale) Palette.orange else Palette.secondaryText,
            )
        }
        if (primary != null) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(metricText, fontSize = 26.sp, fontWeight = FontWeight.Black, color = Palette.primaryText)
                Spacer(Modifier.weight(1f))
                Mono(detailText, 13.sp)
            }
            if (!isBalanceStyle) {
                MeterBar(percent(primary) / 100, barColor, 5.dp)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    val resets = primary.resetsAt
                    val resetText = if (resets == null) primary.label else {
                        val when_ = DateTimeFormatter.ofPattern("d MMM, HH:mm").format(resets.atZone(ZoneId.systemDefault()))
                        "Resets $when_ · ${now.preciseRemainingLabel(resets)}"
                    }
                    Text("🕐 $resetText", fontSize = 11.sp, color = Palette.tertiaryText)
                    Spacer(Modifier.weight(1f))
                    Text(primary.label, fontSize = 11.sp, color = Palette.tertiaryText)
                }
            }
        } else {
            Box(Modifier.heightIn(min = 74.dp)) { Text("No usage windows", fontSize = 13.sp, color = Palette.tertiaryText) }
        }
    }
}

// MARK: - Bottom band

@Composable
private fun ServicesPanel(store: SqwackStore, machineId: String?, modifier: Modifier) {
    val processes = store.processes(machineId)
    Panel(modifier, title = "SERVICES", badge = "${processes.size}") {
        if (processes.isEmpty()) Text("None running", color = Palette.tertiaryText)
        processes.take(4).forEachIndexed { index, process ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (process.containerRuntime == "docker") Text("🐳", fontSize = 12.sp) else Dot(Palette.green, 9.dp)
                Mono(process.port?.let { ":$it" } ?: "—", 15.sp, modifier = Modifier.width(62.dp))
                Text(process.name, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.primaryText, maxLines = 1)
                Spacer(Modifier.weight(1f))
                if (machineId == null && store.nodes.size > 1) {
                    Text(store.machineName(process.machineId), fontSize = 11.sp, color = Palette.secondaryText, maxLines = 1)
                }
                Text(process.category.orEmpty(), fontSize = 11.sp, color = Palette.tertiaryText)
            }
            if (index < processes.take(4).lastIndex) Divider()
        }
    }
}

@Composable
private fun SystemPanel(nodes: List<NodeConnection>, compact: Boolean, modifier: Modifier) {
    Panel(modifier, title = "SYSTEM") {
        nodes.forEach { node ->
            val system = node.system
            if (system != null) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("🖥", fontSize = 12.sp)
                        Text(node.machine?.name ?: "Mac", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.secondaryText)
                        Spacer(Modifier.weight(1f))
                        node.machine?.let { Mono("${it.platform}/${it.architecture}", 11.sp) }
                    }
                    val tiles: List<@Composable (Modifier) -> Unit> = listOf(
                        { m ->
                            StatTile("CPU", "${system.stats.cpuPercent.toInt()}", "%", null, system.stats.cpuPercent / 100, Palette.blue, system.history.cpu, m)
                        },
                        { m ->
                            StatTile(
                                "RAM",
                                Format.bytes(system.stats.ramUsedBytes).replace(" GB", ""),
                                " GB",
                                "of ${Format.bytes(system.stats.ramTotalBytes)}",
                                system.stats.ramUsedBytes.toDouble() / system.stats.ramTotalBytes,
                                Palette.purple,
                                system.history.ram,
                                m,
                            )
                        },
                        { m -> StatTile("UPTIME", Format.uptime(system.stats.uptimeSeconds), "", null, null, Palette.purple, system.history.network, m) },
                    )
                    if (compact) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { tiles.forEach { it(Modifier) } }
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            tiles.forEach { tile -> Box(Modifier.weight(1f)) { tile(Modifier) } }
                        }
                    }
                }
            }
        }
        if (nodes.all { it.system == null }) Text("Waiting for system stats…", color = Palette.tertiaryText)
    }
}

@Composable
private fun StatTile(
    label: String,
    value: String,
    suffix: String,
    detail: String?,
    fraction: Double?,
    color: Color,
    history: List<Double>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Palette.panelRaised)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Palette.secondaryText)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(value, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Palette.primaryText, maxLines = 1)
            if (suffix.isNotEmpty()) Text(suffix, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Palette.secondaryText)
        }
        if (detail != null) Text(detail, fontSize = 10.sp, color = Palette.tertiaryText)
        if (fraction != null) MeterBar(fraction, color, 5.dp)
        Sparkline(history, color, Modifier.fillMaxWidth().height(18.dp))
    }
}

@Composable
fun severityColor(severity: String): Color = when (severity) {
    "success" -> Palette.green
    "warning" -> Palette.amber
    "error" -> Palette.red
    else -> Palette.blue
}

@Composable
private fun ActivityPanel(items: List<ActivityItem>, now: Instant, modifier: Modifier) {
    Panel(modifier, title = "ACTIVITY") {
        if (items.isEmpty()) Text("No recent activity", color = Palette.tertiaryText)
        items.take(4).forEachIndexed { index, item ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Dot(severityColor(item.severity))
                Text(item.message, fontSize = 13.sp, color = Palette.primaryText, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                Spacer(Modifier.weight(1f))
                Text(item.timestamp.agoLabel(now), fontSize = 11.sp, color = Palette.tertiaryText)
            }
            if (index < items.take(4).lastIndex) Divider()
        }
    }
}
