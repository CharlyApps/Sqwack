package com.sqwack

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/// Services, processes and system health — the full monitor screen.
@Composable
fun DevelopmentScreen(store: SqwackStore) {
    val compact = isCompact()
    val now by rememberNow()
    val scope = rememberCoroutineScope()
    var confirmKill by remember { mutableStateOf<DevProcess?>(null) }
    var killError by remember { mutableStateOf<String?>(null) }

    val machineId = store.selectedMachineId
    val visibleNodes = store.nodes.filter { it.machine != null && (machineId == null || it.machine?.id == machineId) }

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(if (compact) 16.dp else 24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Column {
            Text("Development", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Palette.primaryText)
            Text("Services, processes and system health", fontSize = 13.sp, color = Palette.secondaryText)
        }

        ServicesTable(store, machineId, now) { confirmKill = it }

        visibleNodes.forEach { node -> MachineSystemSection(node, compact) }

        RecentOutputPanel(store.activity(machineId))
    }

    confirmKill?.let { process ->
        AlertDialog(
            onDismissRequest = { confirmKill = null },
            title = { Text("Kill ${process.name}?") },
            text = { Text("The daemon verifies the process still exists before terminating it (SIGTERM).") },
            confirmButton = {
                TextButton({
                    confirmKill = null
                    scope.launch {
                        val node = store.nodes.firstOrNull { it.machine?.id == process.machineId } ?: store.nodes.firstOrNull()
                        if (node != null) {
                            runCatching { node.kill(process) }.onFailure { killError = it.message ?: "kill failed" }
                            node.refreshProcesses()
                        }
                    }
                }) {
                    Text("Kill PID ${process.pid}" + (process.port?.let { " on :$it" } ?: ""), color = Palette.red)
                }
            },
            dismissButton = { TextButton({ confirmKill = null }) { Text("Cancel") } },
        )
    }

    killError?.let { message ->
        AlertDialog(
            onDismissRequest = { killError = null },
            title = { Text("Kill failed") },
            text = { Text(message) },
            confirmButton = { TextButton({ killError = null }) { Text("OK") } },
        )
    }
}

// MARK: - Services table

private val COLUMNS = listOf(
    "PORT" to 90.dp,
    "NAME" to 150.dp,
    "MACHINE" to 130.dp,
    "TYPE" to 90.dp,
    "PID" to 70.dp,
    "PATH" to 240.dp,
    "STATUS" to 90.dp,
    "UPTIME" to 90.dp,
    "CPU" to 120.dp,
    "MEMORY" to 90.dp,
    "ACTIONS" to 70.dp,
)

@Composable
private fun ServicesTable(store: SqwackStore, machineId: String?, now: Instant, onKill: (DevProcess) -> Unit) {
    val processes = store.processes(machineId)
    Panel(title = "SERVICES", badge = "${processes.size} running") {
        Column(Modifier.horizontalScroll(rememberScrollState())) {
            Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                COLUMNS.forEach { (header, width) ->
                    Text(header, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Palette.tertiaryText, modifier = Modifier.width(width))
                }
            }
            Spacer(Modifier.height(8.dp))
            Divider()
            if (processes.isEmpty()) {
                Text("No development services detected", color = Palette.secondaryText, modifier = Modifier.padding(vertical = 12.dp))
            }
            processes.forEach { process ->
                Row(
                    Modifier.padding(vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Cell(0) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (process.containerRuntime == "docker") Text("🐳", fontSize = 12.sp) else Dot(Palette.green)
                            Mono(process.port?.let { ":$it" } ?: "—", 15.sp, Palette.primaryText, FontWeight.SemiBold)
                        }
                    }
                    Cell(1) { Text(process.name, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.primaryText, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    Cell(2) { Text("🖥 ${store.machineName(process.machineId)}", fontSize = 11.sp, color = Palette.secondaryText, maxLines = 1) }
                    Cell(3) {
                        Text(
                            process.category ?: "other",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                            color = Palette.secondaryText,
                            modifier = Modifier.clip(CircleShape).background(Palette.fill).padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                    }
                    Cell(4) { Mono(if (process.containerRuntime == null) "${process.pid}" else "—", 14.sp) }
                    Cell(5) {
                        Text(
                            (if (process.containerRuntime == null) process.cwd else process.command) ?: "—",
                            fontSize = 11.sp,
                            color = Palette.tertiaryText,
                            maxLines = 1,
                            overflow = TextOverflow.MiddleEllipsis,
                        )
                    }
                    Cell(6) {
                        Text(
                            "Running",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Palette.green,
                            modifier = Modifier.border(1.dp, Palette.green.copy(alpha = 0.6f), CircleShape).padding(horizontal = 9.dp, vertical = 3.dp),
                        )
                    }
                    Cell(7) {
                        Mono(process.startedAt?.let { Format.uptime((now.epochSecond - it.epochSecond).toInt()) } ?: "—", 14.sp)
                    }
                    Cell(8) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Mono(process.cpuPercent?.let { String.format(Locale.US, "%.1f%%", it) } ?: "—", 14.sp, Palette.primaryText)
                            Sparkline(process.cpuHistory.orEmpty(), Palette.blue, Modifier.width(56.dp).height(18.dp))
                        }
                    }
                    Cell(9) { Mono(process.memoryBytes?.let { Format.bytes(it) } ?: "—", 14.sp) }
                    Cell(10) {
                        if (process.containerRuntime == null) ProcessActions(process, onKill) else Text("—", color = Palette.tertiaryText)
                    }
                }
            }
        }
    }
}

@Composable
private fun Cell(index: Int, content: @Composable () -> Unit) {
    Box(Modifier.width(COLUMNS[index].second), contentAlignment = Alignment.CenterStart) { content() }
}

@Composable
private fun ProcessActions(process: DevProcess, onKill: (DevProcess) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Icon(
            Icons.Default.MoreVert,
            "Process actions",
            tint = Palette.secondaryText,
            modifier = Modifier.size(28.dp).clickable { open = true },
        )
        DropdownMenu(open, onDismissRequest = { open = false }) {
            if (process.killable) {
                DropdownMenuItem(text = { Text("Kill", color = Palette.red) }, onClick = { open = false; onKill(process) })
            } else {
                DropdownMenuItem(text = { Text("Protected", color = Palette.tertiaryText) }, onClick = { open = false })
            }
        }
    }
}

// MARK: - Panels

@Composable
private fun MachineSystemSection(node: NodeConnection, compact: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("🖥", fontSize = 16.sp)
            Text(node.machine?.name ?: "Mac", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Palette.primaryText)
            node.machine?.let { Mono("${it.platform}/${it.architecture}", 11.sp, Palette.tertiaryText) }
            Spacer(Modifier.weight(1f))
            Dot(if (node.connectionState == ConnectionState.CONNECTED) Palette.green else Palette.orange)
            Text(
                if (node.connectionState == ConnectionState.CONNECTED) "Connected" else "Reconnecting",
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = Palette.secondaryText,
            )
        }
        if (compact) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                ResourcePanel(node.system, Modifier)
                SystemHealthPanel(node.system, node.status, compact, Modifier)
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.Top) {
                Box(Modifier.weight(1f)) { ResourcePanel(node.system, Modifier) }
                Box(Modifier.weight(1f)) { SystemHealthPanel(node.system, node.status, compact, Modifier) }
            }
        }
        TopProcessesPanel(node.topProcesses, compact)
    }
}

@Composable
private fun ResourcePanel(system: SystemSnapshot?, modifier: Modifier) {
    Panel(modifier, title = "RESOURCE USAGE") {
        val stats = system?.stats
        if (stats == null) {
            Text("Waiting for system stats…", color = Palette.tertiaryText)
        } else {
            ResourceRow("⚙", "CPU", "${stats.cpuPercent.toInt()}%", "Total across the machine", stats.cpuPercent / 100, Palette.blue)
            ResourceRow(
                "▤", "RAM",
                "${Format.bytes(stats.ramUsedBytes)} / ${Format.bytes(stats.ramTotalBytes)}",
                "${(100.0 * stats.ramUsedBytes / stats.ramTotalBytes).toInt()}% used",
                stats.ramUsedBytes.toDouble() / stats.ramTotalBytes, Palette.purple,
            )
            ResourceRow(
                "▣", "DISK",
                "${(100.0 * stats.diskUsedBytes / stats.diskTotalBytes).toInt()}%",
                "${Format.bytes(stats.diskUsedBytes)} of ${Format.bytes(stats.diskTotalBytes)} used",
                stats.diskUsedBytes.toDouble() / stats.diskTotalBytes, Palette.orange,
            )
        }
    }
}

@Composable
private fun ResourceRow(glyph: String, label: String, value: String, detail: String, fraction: Double, color: Color) {
    Row(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Box(
            Modifier.size(34.dp).clip(RoundedCornerShape(8.dp)).background(color.copy(alpha = 0.15f)),
            contentAlignment = Alignment.Center,
        ) { Text(glyph, color = color, fontSize = 15.sp) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row {
                Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.primaryText)
                Spacer(Modifier.weight(1f))
                Text(value, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Palette.primaryText)
            }
            MeterBar(fraction, color)
            Text(detail, fontSize = 11.sp, color = Palette.tertiaryText)
        }
    }
}

@Composable
private fun SystemHealthPanel(system: SystemSnapshot?, status: SqwackStatus, compact: Boolean, modifier: Modifier) {
    Panel(modifier, title = "SYSTEM HEALTH") {
        if (system == null) {
            Text("Waiting for system stats…", color = Palette.tertiaryText)
        } else {
            HealthRow("CPU Load", "${system.stats.cpuPercent.toInt()}%", system.history.cpu, Palette.green, compact)
            HealthRow(
                "Memory",
                "${Format.bytes(system.stats.ramUsedBytes)} / ${Format.bytes(system.stats.ramTotalBytes)}",
                system.history.ram, Palette.purple, compact,
            )
            HealthRow("Disk", "${(100.0 * system.stats.diskUsedBytes / system.stats.diskTotalBytes).toInt()}%", emptyList(), Palette.orange, compact)
            HealthRow("Network", String.format(Locale.US, "%.0f Mbps", system.stats.networkMbps), system.history.network, Palette.blue, compact)
            HealthRow("Processes", "${system.stats.processCount}", emptyList(), Palette.gray, compact)
            val healthy = status == SqwackStatus.QUIET || status == SqwackStatus.WORKING
            Text(
                if (healthy) "✓ All systems normal" else "⚠ Attention needed",
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = if (healthy) Palette.green else Palette.amber,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
}

@Composable
private fun HealthRow(label: String, value: String, history: List<Double>, color: Color, compact: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(label, fontSize = 15.sp, color = Palette.primaryText)
        Spacer(Modifier.weight(1f))
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.primaryText)
        if (!compact) Sparkline(history, color, Modifier.width(90.dp).height(16.dp))
    }
}

@Composable
private fun RecentOutputPanel(items: List<ActivityItem>) {
    Panel(title = "RECENT OUTPUT") {
        if (items.isEmpty()) Text("No recent events", color = Palette.tertiaryText)
        items.take(6).forEach { item ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Mono("[" + DateTimeFormatter.ofPattern("HH:mm:ss").format(item.timestamp.atZone(ZoneId.systemDefault())) + "]", 11.sp, Palette.tertiaryText)
                Dot(severityColor(item.severity), 7.dp)
                Text(item.message, fontSize = 14.sp, color = severityColor(item.severity), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun TopProcessesPanel(metrics: List<ProcessMetric>, compact: Boolean) {
    Panel(title = "TOP PROCESSES", badge = "By CPU") {
        val cards: List<@Composable (Modifier) -> Unit> = metrics.take(5).mapIndexed { index, metric ->
            { m: Modifier ->
                Row(
                    m.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Palette.panelRaised).padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(22.dp).clip(CircleShape).background(Palette.fill), contentAlignment = Alignment.Center) {
                        Text("${index + 1}", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Palette.secondaryText)
                    }
                    Column(Modifier.weight(1f)) {
                        Text(metric.name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Palette.primaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("PID ${metric.pid}", fontSize = 10.sp, color = Palette.tertiaryText)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(String.format(Locale.US, "%.1f%%", metric.cpuPercent), fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Palette.primaryText)
                        Text(Format.bytes(metric.memoryBytes), fontSize = 10.sp, color = Palette.tertiaryText)
                    }
                }
            }
        }
        if (metrics.isEmpty()) {
            Text("Waiting for process metrics…", color = Palette.tertiaryText)
        } else if (compact) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { cards.forEach { it(Modifier) } }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                cards.forEach { card -> Box(Modifier.weight(1f)) { card(Modifier) } }
            }
        }
    }
}
