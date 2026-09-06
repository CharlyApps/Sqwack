package com.sqwack

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import java.time.Instant

@Composable
fun SettingsScreen(store: SqwackStore) {
    val compact = isCompact()
    val scope = rememberCoroutineScope()
    val integrations = remember { mutableStateMapOf<String, List<IntegrationCapability>>() }
    var showPairing by remember { mutableStateOf(false) }
    val now by rememberNow(30_000)

    LaunchedEffect(store.nodes.size) {
        store.nodes.forEach { node ->
            integrations[node.credentialRef] = node.integrations()
            node.refreshTimesGate()
        }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(if (compact) 16.dp else 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Settings", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Palette.primaryText)

        store.nodes.forEach { node ->
            Panel(title = node.machine?.name ?: node.endpoint) {
                LabeledRow("Endpoint", node.endpoint)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Connection", fontSize = 14.sp, color = Palette.secondaryText)
                    Spacer(Modifier.weight(1f))
                    Dot(
                        when (node.connectionState) {
                            ConnectionState.CONNECTED -> Palette.green
                            ConnectionState.CONNECTING -> Palette.amber
                            else -> Palette.red
                        },
                        10.dp,
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(node.connectionState.name.lowercase().replaceFirstChar { it.uppercase() }, fontSize = 14.sp, color = Palette.primaryText)
                }
                node.machine?.let { machine ->
                    LabeledRow("Machine", "${machine.name} (${machine.platform}/${machine.architecture})")
                    LabeledRow("Daemon version", machine.daemonVersion)
                    LabeledRow("Machine ID", machine.id.take(8) + "…")
                }
                node.lastHeartbeat?.let { LabeledRow("Last heartbeat", it.agoLabel(now)) }
                if (node.timesGate?.configured == true) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Times Gate dashboard", fontSize = 14.sp, color = Palette.primaryText)
                        Spacer(Modifier.weight(1f))
                        Switch(
                            checked = node.timesGate?.enabled == true,
                            onCheckedChange = { enabled -> scope.launch { node.setTimesGate(enabled) } },
                        )
                    }
                }
                integrations[node.credentialRef].orEmpty().forEach { integration ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(integration.integration, fontSize = 14.sp, color = Palette.secondaryText)
                        Spacer(Modifier.weight(1f))
                        Text(
                            if (integration.installed) "${integration.confidence} / active" else "not installed",
                            fontSize = 14.sp,
                            color = if (integration.installed) Palette.green else Palette.secondaryText,
                        )
                    }
                }
                TextButton({ store.removeNode(node) }) { Text("Unpair this machine", color = Palette.red) }
            }
        }

        Panel {
            Button({ showPairing = true }) { Text("Pair a machine…") }
            Text(
                "Pair over LAN or Tailscale. Run `sqwackd pair` on the Mac to get a code. Credentials are stored in this app's private storage.",
                fontSize = 12.sp,
                color = Palette.tertiaryText,
            )
        }
    }

    if (showPairing) {
        Dialog({ showPairing = false }, DialogProperties(usePlatformDefaultWidth = false)) {
            PairingScreen(store, onDismiss = { showPairing = false })
        }
    }
}

@Composable
private fun LabeledRow(label: String, value: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 14.sp, color = Palette.secondaryText)
        Spacer(Modifier.weight(1f))
        Text(value, fontSize = 14.sp, color = Palette.primaryText, maxLines = 1)
    }
}

/// Pairing: enter the daemon endpoint + the short-lived code from `sqwackd pair`.
@Composable
fun PairingScreen(store: SqwackStore, onDismiss: (() -> Unit)?) {
    var host by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val endpoint = remember(host) { normalizeEndpoint(host) }

    Box(Modifier.fillMaxSize().background(Palette.background), contentAlignment = Alignment.Center) {
        Column(
            Modifier
                .width(460.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Palette.panel)
                .border(1.dp, Palette.stroke, RoundedCornerShape(16.dp))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Pair with a Mac", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Palette.primaryText)
            Text("Daemon address", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.secondaryText)
            OutlinedTextField(
                host,
                { host = it },
                Modifier.fillMaxWidth(),
                placeholder = { Text("mac-mini.tailnet.ts.net or 192.168.1.20") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
            )
            Text(
                "Port 4737 is assumed if omitted. On the Mac, run `sqwackd pair` to display a pairing code.",
                fontSize = 11.sp,
                color = Palette.tertiaryText,
            )
            Text("Pairing code", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.secondaryText)
            OutlinedTextField(
                code,
                { code = it },
                Modifier.fillMaxWidth(),
                placeholder = { Text("8-character code") },
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace, fontSize = 20.sp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
            )
            error?.let { Text(it, color = Palette.red, fontSize = 13.sp) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(
                    enabled = endpoint != null && code.trim().length >= 4 && !busy,
                    onClick = {
                        val target = endpoint ?: return@Button
                        busy = true
                        error = null
                        scope.launch {
                            runCatching { NodeConnection.pair(target, code.trim(), Build.MODEL) }
                                .onSuccess {
                                    store.addNode(target, it.token)
                                    onDismiss?.invoke()
                                }
                                .onFailure { error = it.message ?: "pairing failed" }
                            busy = false
                        }
                    },
                ) {
                    if (busy) CircularProgressIndicator(Modifier.height(18.dp)) else Text("Pair")
                }
                if (onDismiss != null) TextButton(onDismiss) { Text("Cancel") }
            }
        }
    }
}

/// "mac.local" -> "http://mac.local:4737"; an explicit scheme or port is kept.
fun normalizeEndpoint(raw: String): String? {
    var value = raw.trim()
    if (value.isEmpty()) return null
    if (!value.contains("://")) value = "http://$value"
    val uri = runCatching { java.net.URI(value) }.getOrNull() ?: return null
    if (uri.host.isNullOrEmpty()) return null
    return if (uri.port == -1) "$value:4737" else value.trimEnd('/')
}
