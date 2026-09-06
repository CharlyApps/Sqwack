package com.sqwack

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun HermesScreen(store: SqwackStore) {
    val compact = isCompact()
    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = if (compact) 16.dp else 28.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            ProviderBadge("hermes", 46.dp)
            Column {
                Text("Hermes Gateways", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Palette.primaryText)
                Text("Local gateway health and scheduled jobs", fontSize = 14.sp, color = Palette.secondaryText)
            }
        }
        store.hermesNodes.forEach { node ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "🖥 ${node.machine?.name ?: node.endpoint}",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Palette.secondaryText,
                )
                node.hermes?.gateways.orEmpty().forEach { gateway -> HermesGatewayPanel(gateway, compact) }
            }
        }
    }
}

@Composable
private fun HermesGatewayPanel(gateway: HermesGateway, compact: Boolean) {
    Panel(
        title = gateway.profile,
        badge = if (gateway.running) "Running" else "Stopped",
        trailing = "${gateway.cronJobs.size} cron jobs",
    ) {
        val header: @Composable () -> Unit = {
            Text(
                "⚡ ${gateway.activeAgents} active",
                fontSize = 13.sp,
                color = if (gateway.activeAgents > 0) Palette.mint else Palette.secondaryText,
            )
            Text(
                gateway.state.replace("_", " ").capitalizedWords,
                fontSize = 13.sp,
                color = if (gateway.running) Palette.green else Palette.secondaryText,
            )
            gateway.platforms.forEach { platform ->
                Row(
                    Modifier.clip(CircleShape).background(Palette.panelRaised).padding(horizontal = 9.dp, vertical = 5.dp),
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Dot(if (platform.state == "connected" || platform.state == "running") Palette.green else Palette.secondaryText, 7.dp)
                    Text(
                        "${platform.name.capitalizedWords} · ${platform.state.capitalizedWords}",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                        color = Palette.primaryText,
                    )
                }
            }
        }
        if (compact) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { header() }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.CenterVertically) { header() }
        }

        if (gateway.cronJobs.isEmpty()) {
            Text("No cron jobs in this profile", fontSize = 13.sp, color = Palette.secondaryText, modifier = Modifier.padding(vertical = 8.dp))
        } else {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Palette.panelRaised)
                    .border(1.dp, Palette.stroke, RoundedCornerShape(12.dp)),
            ) {
                gateway.cronJobs.forEachIndexed { index, job ->
                    HermesCronRow(job, compact)
                    if (index < gateway.cronJobs.size - 1) Divider()
                }
            }
        }
    }
}

@Composable
private fun HermesCronRow(job: HermesCronJob, compact: Boolean) {
    val status = when {
        !job.enabled -> "Paused"
        job.state == "completed" -> "Completed"
        job.lastStatus == "error" || job.errorKind != null -> "Error"
        job.lastStatus == "ok" -> "Healthy"
        else -> "Scheduled"
    }
    val statusColor = when (status) {
        "Error" -> Palette.red
        "Healthy", "Completed" -> Palette.green
        "Paused" -> Palette.secondaryText
        else -> Palette.blue
    }
    val formatter = DateTimeFormatter.ofPattern("MMM d, HH:mm")
    val zone = ZoneId.systemDefault()

    val title: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(job.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.primaryText)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("\uD83D\uDDD3 ${job.schedule}", fontSize = 11.sp, color = Palette.secondaryText)
                job.delivery?.let { Text("\u2708 ${it.capitalizedWords}", fontSize = 11.sp, color = Palette.secondaryText) }
                job.errorKind?.let {
                    Text("\u26A0 ${it.replace("_", " ").capitalizedWords}", fontSize = 11.sp, color = Palette.orange)
                }
            }
        }
    }
    val trailing: @Composable () -> Unit = {
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(status, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = statusColor)
            val next = job.nextRunAt
            val last = job.lastRunAt
            when {
                next != null -> Text("Next ${formatter.format(next.atZone(zone))}", fontSize = 11.sp, color = Palette.secondaryText)
                last != null -> Text("Last ${formatter.format(last.atZone(zone))}", fontSize = 11.sp, color = Palette.secondaryText)
            }
        }
    }

    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp)) {
        if (compact) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Dot(statusColor, 9.dp)
                    title()
                }
                trailing()
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Dot(statusColor, 9.dp)
                Box(Modifier.weight(1f)) { title() }
                trailing()
            }
        }
    }
}
