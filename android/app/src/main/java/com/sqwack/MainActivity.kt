package com.sqwack

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Image
import androidx.lifecycle.compose.LifecycleResumeEffect
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/// Deep link target, set by `sqwack://tab/<name>` (mirrors the iOS onOpenURL).
private var pendingTab by mutableStateOf<String?>(null)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // ponytail: the tablet is a wall monitor, so never let it sleep while open.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        handleDeepLink(intent)
        val store = SqwackStore(this)
        setContent {
            SqwackTheme {
                // edge-to-edge draws under the status/navigation bars; keep the
                // content inside them so the gesture bar never covers the footer.
                Box(Modifier.fillMaxSize().background(Palette.background).safeDrawingPadding()) {
                    RootView(store)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.host == "tab") pendingTab = uri.pathSegments.firstOrNull()
    }
}

@Composable
fun isCompact(): Boolean = LocalConfiguration.current.screenWidthDp < 700

@Composable
fun RootView(store: SqwackStore) {
    if (!store.isPaired) {
        PairingScreen(store, onDismiss = null)
        return
    }
    var selectedTab by remember { mutableStateOf("overview") }
    val compact = isCompact()

    LifecycleResumeEffect(Unit) {
        store.connectAll()
        onPauseOrDispose { }
    }
    LaunchedEffect(pendingTab, store.hasHermes) {
        pendingTab?.let { tab ->
            if (tab != "hermes" || store.hasHermes) selectedTab = tab
            pendingTab = null
        }
        if (!store.hasHermes && selectedTab == "hermes") selectedTab = "overview"
    }

    Column(Modifier.fillMaxSize().background(Palette.background)) {
        AppChrome(store, selectedTab, onSelectTab = { selectedTab = it }, compact = compact)
        store.lastError?.let { error ->
            DiagnosticBanner(error, onDismiss = { store.clearError() }, modifier = Modifier.padding(horizontal = if (compact) 16.dp else 28.dp, vertical = 4.dp))
        }
        Box(Modifier.weight(1f)) {
            when (selectedTab) {
                "agents" -> AgentsScreen(store)
                "development" -> DevelopmentScreen(store)
                "hermes" -> if (store.hasHermes) HermesScreen(store) else OverviewScreen(store)
                "settings" -> SettingsScreen(store)
                else -> OverviewScreen(store)
            }
        }
        if (compact) MobileTabBar(store, selectedTab) { selectedTab = it } else AppFooter(store)
    }
}

private fun tabs(hasHermes: Boolean): List<Triple<String, String, String>> =
    listOf(
        Triple("overview", "Overview", "▦"),
        Triple("agents", "Agents", "◉"),
        Triple("development", "Develop", "❯_"),
    ) + (if (hasHermes) listOf(Triple("hermes", "Hermes", "⚡")) else emptyList()) +
        listOf(Triple("settings", "Settings", "⚙"))

/// Compact connection indicator pinned beside the tab selector.
@Composable
fun ConnectionChip(store: SqwackStore) {
    val names = store.connectedMachineNames
    Row(
        Modifier
            .clip(CircleShape)
            .background(Palette.panelRaised)
            .border(1.dp, Palette.stroke, CircleShape)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Dot(if (store.anyConnected) Palette.green else Palette.red)
        Text(
            when {
                names.isEmpty() -> "No daemon"
                names.size == 1 -> names[0]
                else -> "${names.size} Macs"
            },
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = Palette.secondaryText,
        )
    }
}

@Composable
private fun AppChrome(store: SqwackStore, selectedTab: String, onSelectTab: (String) -> Unit, compact: Boolean) {
    if (compact) {
        Row(
            Modifier.fillMaxWidth().background(Palette.background).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Image(painterResource(R.drawable.dashboard_logo), null, Modifier.size(36.dp), contentScale = ContentScale.Fit)
            Text("SQWACK", fontSize = 20.sp, fontWeight = FontWeight.Black, color = Palette.primaryText)
            Spacer(Modifier.weight(1f))
            ConnectionChip(store)
            RefreshMenu(store)
        }
    } else {
        Row(
            Modifier.fillMaxWidth().background(Palette.background).padding(horizontal = 28.dp).padding(top = 16.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(Modifier.width(190.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Image(painterResource(R.drawable.dashboard_logo), null, Modifier.size(42.dp), contentScale = ContentScale.Fit)
                Text("SQWACK", fontSize = 22.sp, fontWeight = FontWeight.Black, color = Palette.primaryText)
            }
            Spacer(Modifier.weight(1f))
            Row(
                Modifier
                    .clip(CircleShape)
                    .background(Palette.panel)
                    .border(1.dp, Color.White.copy(alpha = 0.12f), CircleShape)
                    .padding(6.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                tabs(store.hasHermes).forEach { (id, title, _) ->
                    Box(
                        Modifier
                            .clip(CircleShape)
                            .background(if (selectedTab == id) Palette.blue.copy(alpha = 0.14f) else Color.Transparent)
                            .clickable { onSelectTab(id) }
                            .widthIn(min = 116.dp)
                            .padding(vertical = 10.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = if (selectedTab == id) Palette.blue else Palette.primaryText)
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            Row(Modifier.width(300.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                if (store.nodes.mapNotNull { it.machine }.size > 1) {
                    MachineMenu(store)
                    Spacer(Modifier.width(12.dp))
                }
                val now by rememberNow(60_000)
                Column(horizontalAlignment = Alignment.End) {
                    val zone = ZoneId.systemDefault()
                    Text(
                        DateTimeFormatter.ofPattern("HH:mm").format(now.atZone(zone)),
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        fontFamily = FontFamily.Monospace,
                        color = Palette.secondaryText,
                    )
                    Text(
                        DateTimeFormatter.ofPattern("EEE d MMM").format(now.atZone(zone)),
                        fontSize = 12.sp,
                        color = Palette.tertiaryText,
                    )
                }
                Spacer(Modifier.width(12.dp))
                RefreshMenu(store)
            }
        }
    }
}

@Composable
private fun MachineMenu(store: SqwackStore) {
    var open by remember { mutableStateOf(false) }
    val label = store.selectedMachineId?.let { id -> store.nodes.firstOrNull { it.machine?.id == id }?.machine?.name } ?: "All Macs"
    Box {
        Pill(onClick = { open = true }, selected = false) {
            Text("🖥 $label", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.primaryText, maxLines = 1)
        }
        DropdownMenu(open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("All Macs") }, onClick = { store.selectedMachineId = null; open = false })
            store.nodes.forEach { node ->
                node.machine?.let { machine ->
                    DropdownMenuItem(text = { Text(machine.name) }, onClick = { store.selectedMachineId = machine.id; open = false })
                }
            }
        }
    }
}

@Composable
private fun RefreshMenu(store: SqwackStore) {
    var open by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Box {
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(Palette.panelRaised)
                .border(1.dp, Palette.strokeBright, CircleShape)
                .clickable { open = true },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Refresh, "Refresh", tint = Palette.primaryText)
        }
        DropdownMenu(open, onDismissRequest = { open = false }) {
            val id = store.selectedMachineId
            DropdownMenuItem(text = { Text("Refresh Dashboard") }, onClick = { scope.launch { store.refreshAll(id) }; open = false })
            DropdownMenuItem(text = { Text("Refresh Agents") }, onClick = { scope.launch { store.refreshAgents(id) }; open = false })
            DropdownMenuItem(text = { Text("Refresh Services") }, onClick = { scope.launch { store.refreshProcessesOnly(id) }; open = false })
            DropdownMenuItem(text = { Text("Refresh Account Usage") }, onClick = { scope.launch { store.refreshUsage(machineId = id) }; open = false })
            DropdownMenuItem(
                text = { Text(if (store.anyConnected) "Connected" else "Disconnected", color = if (store.anyConnected) Palette.green else Palette.red) },
                onClick = { open = false },
            )
        }
    }
}

@Composable
private fun DiagnosticBanner(message: String, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Palette.panelRaised)
            .border(1.dp, Palette.orange.copy(alpha = 0.35f), RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.Warning, null, tint = Palette.orange)
        Column(Modifier.weight(1f)) {
            Text("Diagnostics", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.primaryText)
            Text(message, fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = Palette.secondaryText, maxLines = 3)
        }
        Icon(Icons.Default.Close, "Dismiss", tint = Palette.secondaryText, modifier = Modifier.size(32.dp).clickable(onClick = onDismiss).padding(6.dp))
    }
}

@Composable
private fun MobileTabBar(store: SqwackStore, selectedTab: String, onSelect: (String) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Palette.panel)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        tabs(store.hasHermes).forEach { (id, title, glyph) ->
            Column(
                Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .clickable { onSelect(id) },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                val tint = if (selectedTab == id) Palette.blue else Palette.secondaryText
                Text(glyph, fontSize = 16.sp, color = tint)
                Text(title, fontSize = 11.sp, color = tint)
            }
        }
    }
}

@Composable
private fun AppFooter(store: SqwackStore) {
    val names = store.connectedMachineNames
    Row(
        Modifier
            .fillMaxWidth()
            .background(Palette.background)
            .padding(horizontal = 26.dp)
            .padding(bottom = 10.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Palette.panel)
            .border(1.dp, Palette.stroke, RoundedCornerShape(12.dp))
            .height(42.dp)
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("🛡 Connected to ", fontSize = 12.sp, color = Palette.secondaryText)
        Text(if (names.isEmpty()) "No daemon" else names.joinToString(", "), fontSize = 12.sp, color = Palette.blue)
        Spacer(Modifier.weight(1f))
        Text("Tailscale", fontSize = 12.sp, color = Palette.secondaryText)
        Spacer(Modifier.width(10.dp))
        Dot(if (store.anyConnected) Palette.green else Palette.red)
        Spacer(Modifier.width(6.dp))
        Text(
            if (store.anyConnected) "Connected" else "Disconnected",
            fontSize = 12.sp,
            color = if (store.anyConnected) Palette.green else Palette.red,
        )
        Spacer(Modifier.weight(1f))
        Text("Daemon v${store.daemonVersion}", fontSize = 12.sp, color = Palette.secondaryText)
    }
}
