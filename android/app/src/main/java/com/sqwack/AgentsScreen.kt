package com.sqwack

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/// Detailed session list — the information-dense counterpart to Overview.
@Composable
fun AgentsScreen(store: SqwackStore) {
    val compact = isCompact()
    val now by rememberNow()
    var stateFilter by remember { mutableStateOf<AgentState?>(null) }
    var filterMenuOpen by remember { mutableStateOf(false) }
    var transcriptSession by remember { mutableStateOf<AgentSession?>(null) }

    val all = store.sessions(store.selectedMachineId)
    val filtered = all.filter { stateFilter == null || it.state == stateFilter }

    LazyColumn(
        Modifier.fillMaxSize().padding(if (compact) 16.dp else 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("Agents", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Palette.primaryText)
                    Text("All agent sessions and activity", fontSize = 13.sp, color = Palette.secondaryText)
                }
                Spacer(Modifier.weight(1f))
                Box {
                    Pill(onClick = { filterMenuOpen = true }) {
                        Text(stateFilter?.shortLabel ?: "All Agents", color = Palette.primaryText, fontSize = 14.sp)
                        Icon(Icons.Default.KeyboardArrowDown, null, tint = Palette.secondaryText, modifier = Modifier.size(16.dp))
                    }
                    DropdownMenu(filterMenuOpen, onDismissRequest = { filterMenuOpen = false }) {
                        DropdownMenuItem(text = { Text("All Agents") }, onClick = { stateFilter = null; filterMenuOpen = false })
                        AgentState.entries.filter { it != AgentState.UNKNOWN }.forEach { state ->
                            DropdownMenuItem(text = { Text(state.shortLabel) }, onClick = { stateFilter = state; filterMenuOpen = false })
                        }
                    }
                }
            }
        }
        items(filtered, key = { it.id }) { session ->
            SessionRow(store, session, now, compact, onOpen = { transcriptSession = session })
        }
        if (filtered.isEmpty()) {
            item {
                Box(Modifier.fillMaxWidth().heightIn(min = 120.dp), contentAlignment = Alignment.Center) {
                    Text("No sessions" + (stateFilter?.let { " in state ${it.wire}" } ?: ""), color = Palette.secondaryText)
                }
            }
        }
        item {
            Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
                Text("Showing ${filtered.size} of ${all.size} agents", fontSize = 13.sp, color = Palette.tertiaryText)
            }
        }
    }

    transcriptSession?.let { session ->
        TranscriptDialog(store, session, onDismiss = { transcriptSession = null })
    }
}

@Composable
private fun SessionRow(
    store: SqwackStore,
    session: AgentSession,
    now: Instant,
    compact: Boolean,
    onOpen: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val machineName = store.machineName(session.machineId)
    val timeDetail = when (session.state) {
        AgentState.WORKING -> "Running " + (session.startedAt ?: session.updatedAt).elapsedLabel(now)
        AgentState.NEEDS_INPUT -> "Waiting " + (session.waitingSince ?: session.updatedAt).elapsedLabel(now)
        else -> session.updatedAt.agoLabel(now).sentenceCased
    }
    val acknowledgeable = session.state == AgentState.NEEDS_INPUT || session.state == AgentState.FAILED
    val acknowledge: @Composable () -> Unit = {
        if (acknowledgeable) {
            Icon(
                Icons.Default.CheckCircle,
                "Acknowledge",
                tint = Palette.secondaryText,
                modifier = Modifier.size(28.dp).clickable {
                    scope.launch {
                        store.nodes.filter { it.machine?.id == session.machineId }.forEach { it.acknowledge(session.id) }
                    }
                },
            )
        }
    }

    val container = Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(16.dp))
        .background(Palette.panel)
        .border(1.dp, Palette.stroke, RoundedCornerShape(16.dp))
        .clickable(onClick = onOpen)
        .padding(18.dp)

    if (compact) {
        Column(container, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ProviderBadge(session.provider, 44.dp)
                Column(Modifier.weight(1f)) {
                    Text(session.provider.replaceFirstChar { it.uppercase() }, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.primaryText)
                    Text(session.projectName ?: session.cwd ?: session.source, fontSize = 13.sp, color = Palette.secondaryText, maxLines = 1)
                }
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.tertiaryText)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Dot(session.state.color)
                Text(session.state.label, fontSize = 13.sp, fontWeight = FontWeight.Black, color = session.state.color)
                Spacer(Modifier.weight(1f))
                Text(timeDetail, fontSize = 11.sp, color = Palette.secondaryText)
            }
            session.summary?.let { Text(it, fontSize = 15.sp, color = Palette.primaryText, maxLines = 2) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("🖥", machineName)
                Chip("❯_", session.source)
                Spacer(Modifier.weight(1f))
                acknowledge()
            }
        }
    } else {
        Row(container, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            ProviderBadge(session.provider, 52.dp)
            Column(Modifier.width(170.dp)) {
                Text(session.provider.replaceFirstChar { it.uppercase() }, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.primaryText)
                Text(session.projectName ?: session.cwd ?: session.source, fontSize = 13.sp, color = Palette.secondaryText, maxLines = 1)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Dot(session.state.color)
                    Text(session.state.label, fontSize = 13.sp, fontWeight = FontWeight.Black, color = session.state.color)
                    Text(timeDetail, fontSize = 13.sp, color = Palette.secondaryText)
                }
                session.summary?.let { Text(it, fontSize = 15.sp, color = Palette.primaryText, maxLines = 1) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("🖥", machineName)
                    Chip("❯_", session.source)
                }
            }
            Sparkline(
                (session.activity ?: emptyList()).map { it.toDouble() },
                session.state.color,
                Modifier.width(180.dp).height(34.dp),
            )
            acknowledge()
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.tertiaryText)
        }
    }
}

/// Read-only conversation viewer. The daemon streams the provider's own
/// transcript files on demand — nothing is stored in Sqwack.
@Composable
private fun TranscriptDialog(store: SqwackStore, session: AgentSession, onDismiss: () -> Unit) {
    var transcript by remember { mutableStateOf<Transcript?>(null) }
    var loading by remember { mutableStateOf(true) }
    var loadFailed by remember { mutableStateOf(false) }
    var reloadKey by remember { mutableStateOf(0) }
    val node = store.nodes.firstOrNull { it.machine?.id == session.machineId } ?: store.nodes.firstOrNull()
    val listState = rememberLazyListState()

    LaunchedEffect(session.id, reloadKey) {
        loading = true
        transcript = node?.transcript(session.id)
        loadFailed = transcript == null
        loading = false
    }
    LaunchedEffect(transcript) {
        val count = transcript?.messages?.size ?: 0
        if (count > 0) listState.scrollToItem(count - 1)
    }

    Dialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Palette.background)) {
            Row(
                Modifier.fillMaxWidth().background(Palette.panel).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "${session.provider.replaceFirstChar { it.uppercase() }} · ${session.projectName ?: session.source}",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Palette.primaryText,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
                Icon(Icons.Default.Close, "Done", tint = Palette.primaryText, modifier = Modifier.clickable(onClick = onDismiss))
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                when {
                    loading -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator()
                        Spacer(Modifier.height(12.dp))
                        Text("Loading conversation…", color = Palette.secondaryText)
                    }
                    transcript?.available == true -> LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize().padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        items(transcript?.messages.orEmpty()) { MessageBubble(it) }
                    }
                    else -> Column(
                        Modifier.padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text("No transcript available", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Palette.primaryText)
                        Text(
                            if (loadFailed) "The daemon request failed. Check the connection and try again."
                            else "This provider's session file could not be found on the Mac (short-lived or non-interactive sessions may not keep one).",
                            fontSize = 13.sp,
                            color = Palette.secondaryText,
                        )
                        TextButton({ reloadKey += 1 }) { Text("Retry") }
                    }
                }
            }
            transcript?.source?.let {
                Text(it, fontSize = 10.sp, color = Palette.tertiaryText, modifier = Modifier.padding(12.dp))
            }
        }
    }
}

@Composable
private fun MessageBubble(message: TranscriptMessage) {
    val isUser = message.role == "user"
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start) {
        if (isUser) Spacer(Modifier.width(60.dp))
        Column(
            Modifier
                .weight(1f, fill = false)
                .clip(RoundedCornerShape(14.dp))
                .background(if (isUser) Palette.blue.copy(alpha = 0.18f) else Palette.panelRaised)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                if (isUser) "You" else "Agent",
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                color = if (isUser) Palette.blue else Palette.secondaryText,
            )
            Text(message.text, fontSize = 14.sp, color = Palette.primaryText)
            message.timestamp?.let {
                Text(
                    DateTimeFormatter.ofPattern("HH:mm").withLocale(Locale.US).format(it.atZone(ZoneId.systemDefault())),
                    fontSize = 10.sp,
                    color = Palette.tertiaryText,
                )
            }
        }
        if (!isUser) Spacer(Modifier.width(60.dp))
    }
}
