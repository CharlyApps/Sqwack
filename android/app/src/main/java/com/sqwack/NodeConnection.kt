package com.sqwack

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.net.URLEncoder
import java.time.Instant
import kotlin.math.min
import kotlin.math.pow

enum class ConnectionState { CONNECTING, CONNECTED, DISCONNECTED, ERROR }

/// One daemon (= one machine). SqwackStore can hold several of these; the MVP
/// UI pairs with exactly one, but nothing in this layer assumes that.
class NodeConnection(
    val endpoint: String,
    val credentialRef: String,
    private val prefs: SharedPreferences,
) {
    var connectionState by mutableStateOf(ConnectionState.DISCONNECTED); private set
    var machine by mutableStateOf<Machine?>(null); private set
    var status by mutableStateOf(SqwackStatus.QUIET); private set
    val sessions = mutableStateMapOf<String, AgentSession>()
    val processes = mutableStateListOf<DevProcess>()
    val usage = mutableStateListOf<ProviderUsage>()
    var system by mutableStateOf<SystemSnapshot?>(null); private set
    val topProcesses = mutableStateListOf<ProcessMetric>()
    val activity = mutableStateListOf<ActivityItem>()
    var hermes by mutableStateOf<HermesSnapshot?>(null); private set
    var timesGate by mutableStateOf<TimesGateState?>(null); private set
    var lastHeartbeat by mutableStateOf<Instant?>(null); private set
    var lastError by mutableStateOf<String?>(null); private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var socket: WebSocket? = null
    private var reconnectAttempt = 0
    private var closed = false

    val token: String? get() = prefs.getString(TOKEN_PREFIX + credentialRef, null)

    init {
        usage.addAll(cachedUsage())
    }

    // MARK: - Lifecycle

    fun connect() {
        closed = false
        if (socket != null) return
        openSocket()
    }

    fun disconnect() {
        closed = true
        socket?.close(1000, null)
        socket = null
        connectionState = ConnectionState.DISCONNECTED
    }

    private fun openSocket() {
        if (closed) return
        val token = token
        if (token == null) {
            lastError = "WebSocket $endpoint: missing stored token"
            connectionState = ConnectionState.ERROR
            return
        }
        connectionState = ConnectionState.CONNECTING
        val wsUrl = endpoint.replaceFirst("http", "ws") + "/v1/ws"
        val request = Request.Builder().url(wsUrl).header("Authorization", "Bearer $token").build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                scope.launch { if (socket === webSocket) handle(ServerMessage.decode(text)) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                scope.launch { if (socket === webSocket) scheduleReconnect(t.message ?: "connection failed") }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                scope.launch { if (socket === webSocket) scheduleReconnect(null) }
            }
        })
    }

    private fun handle(message: ServerMessage) {
        when (message) {
            is ServerMessage.SnapshotMessage -> {
                val snapshot = message.snapshot
                lastError = null
                connectionState = ConnectionState.CONNECTED
                reconnectAttempt = 0
                machine = snapshot.machine
                status = snapshot.status
                sessions.clear()
                snapshot.sessions.forEach { sessions[it.id] = it }
                processes.replaceAll(snapshot.processes)
                applyUsage(snapshot.usage ?: emptyList())
                system = snapshot.system
                topProcesses.replaceAll(snapshot.topProcesses ?: emptyList())
                activity.replaceAll(snapshot.activity ?: emptyList())
                hermes = snapshot.hermes
                lastHeartbeat = Instant.now()
            }
            is ServerMessage.SessionUpdated -> {
                lastError = null
                sessions[message.session.id] = message.session
            }
            is ServerMessage.ProcessesUpdated -> {
                lastError = null
                processes.replaceAll(message.processes)
            }
            is ServerMessage.UsageUpdated -> {
                lastError = null
                applyUsage(message.usage)
            }
            is ServerMessage.SystemUpdated -> {
                lastError = null
                system = message.system
            }
            is ServerMessage.HermesUpdated -> {
                lastError = null
                hermes = message.hermes.takeIf { it.gateways.isNotEmpty() }
            }
            is ServerMessage.StatusUpdated -> {
                lastError = null
                status = message.status
            }
            ServerMessage.Heartbeat -> lastHeartbeat = Instant.now()
            ServerMessage.Unknown -> lastError = "WebSocket: daemon sent an unknown or undecodable message"
            ServerMessage.Event -> Unit
        }
    }

    private fun scheduleReconnect(error: String?) {
        if (closed) return
        if (error != null) lastError = "WebSocket: $error"
        connectionState = if (sessions.isEmpty()) ConnectionState.ERROR else ConnectionState.DISCONNECTED
        socket?.cancel()
        socket = null
        val delaySeconds = min(2.0.pow(reconnectAttempt), 30.0)
        reconnectAttempt += 1
        scope.launch {
            delay((delaySeconds * 1000).toLong())
            if (!closed) openSocket() // server re-sends a full snapshot on connect
        }
    }

    fun clearError() {
        lastError = null
    }

    // MARK: - REST commands

    private suspend fun request(path: String, method: String = "GET", body: String? = null): String =
        withContext(Dispatchers.IO) {
            val token = token ?: throw IllegalStateException("missing stored token")
            val request = Request.Builder()
                .url(endpoint + path)
                .method(method, body?.toRequestBody(JSON_MEDIA) ?: if (method == "GET") null else EMPTY_BODY)
                .header("Authorization", "Bearer $token")
                .header("Content-Type", "application/json")
                .build()
            http.newCall(request).execute().use { response ->
                val text = response.body.string()
                if (!response.isSuccessful) throw IllegalStateException(apiError(text) ?: "request failed (${response.code})")
                text
            }
        }

    private fun apiError(body: String): String? = runCatching {
        sqwackJson.decodeFromString(MapSerializer(String.serializer(), String.serializer()), body)["error"]
    }.getOrNull()

    suspend fun refreshSnapshot() {
        runCatching { sqwackJson.decodeFromString(Snapshot.serializer(), request("/v1/snapshot")) }
            .onSuccess { handle(ServerMessage.SnapshotMessage(it)) }
            .onFailure { report("GET /v1/snapshot", it) }
    }

    suspend fun refreshProcesses() {
        runCatching {
            val text = request("/v1/processes")
            sqwackJson.decodeFromString(ProcessesWrapper.serializer(), text).processes
        }.onSuccess { handle(ServerMessage.ProcessesUpdated(it)) }
            .onFailure { report("GET /v1/processes", it) }
    }

    suspend fun refreshUsage(provider: String? = null) {
        val body = provider?.let { """{"provider":"$it"}""" } ?: "{}"
        runCatching {
            val text = request("/v1/usage/refresh", "POST", body)
            sqwackJson.decodeFromString(UsageWrapper.serializer(), text).usage
        }.onSuccess { handle(ServerMessage.UsageUpdated(it)) }
            .onFailure { report("POST /v1/usage/refresh", it) }
    }

    suspend fun kill(process: DevProcess) {
        request("/v1/processes/${encode(process.id)}/kill", "POST")
    }

    suspend fun acknowledge(sessionId: String) {
        runCatching { request("/v1/sessions/${encode(sessionId)}/ack", "POST") }
            .onFailure { report("POST /v1/sessions/ack", it) }
    }

    suspend fun transcript(sessionId: String): Transcript? =
        runCatching {
            sqwackJson.decodeFromString(Transcript.serializer(), request("/v1/sessions/${encode(sessionId)}/transcript"))
        }.onFailure { report("GET /v1/sessions/transcript", it) }.getOrNull()

    suspend fun integrations(): List<IntegrationCapability> =
        runCatching {
            sqwackJson.decodeFromString(IntegrationsWrapper.serializer(), request("/v1/integrations")).integrations
        }.onFailure { report("GET /v1/integrations", it) }.getOrDefault(emptyList())

    suspend fun refreshTimesGate() {
        runCatching { sqwackJson.decodeFromString(TimesGateState.serializer(), request("/v1/timesgate")) }
            .onSuccess { timesGate = it }
            .onFailure { report("GET /v1/timesgate", it) }
    }

    suspend fun setTimesGate(enabled: Boolean) {
        val previous = timesGate
        timesGate = TimesGateState(configured = true, enabled = enabled)
        runCatching {
            val text = request("/v1/timesgate", "POST", """{"enabled":$enabled}""")
            sqwackJson.decodeFromString(TimesGateState.serializer(), text)
        }.onSuccess { timesGate = it }
            .onFailure {
                timesGate = previous
                report("POST /v1/timesgate", it)
            }
    }

    private fun report(context: String, error: Throwable) {
        lastError = "$context: ${error.message ?: error.javaClass.simpleName}"
    }

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun applyUsage(newUsage: List<ProviderUsage>) {
        if (newUsage.isEmpty()) return
        newUsage.forEach { item ->
            val index = usage.indexOfFirst { it.provider == item.provider }
            if (index >= 0) usage[index] = item else usage.add(item)
        }
        prefs.edit()
            .putString(USAGE_PREFIX + credentialRef, sqwackJson.encodeToString(ListSerializer(ProviderUsage.serializer()), usage.toList()))
            .apply()
    }

    private fun cachedUsage(): List<ProviderUsage> = runCatching {
        val raw = prefs.getString(USAGE_PREFIX + credentialRef, null) ?: return emptyList()
        sqwackJson.decodeFromString(ListSerializer(ProviderUsage.serializer()), raw)
    }.getOrDefault(emptyList())

    companion object {
        const val TOKEN_PREFIX = "sqwack.token."
        private const val USAGE_PREFIX = "sqwack.usage."
        private val JSON_MEDIA = "application/json".toMediaType()
        private val EMPTY_BODY = "".toRequestBody(JSON_MEDIA)

        val http: OkHttpClient = OkHttpClient.Builder()
            .pingInterval(java.time.Duration.ofSeconds(20))
            .build()

        /// Pairing runs before a connection exists, so it is static and unauthenticated.
        suspend fun pair(endpoint: String, code: String, deviceName: String): PairResponse =
            withContext(Dispatchers.IO) {
                val body = sqwackJson.encodeToString(
                    MapSerializer(String.serializer(), String.serializer()),
                    mapOf("code" to code, "deviceName" to deviceName),
                )
                val request = Request.Builder()
                    .url("$endpoint/v1/pair")
                    .post(body.toRequestBody(JSON_MEDIA))
                    .build()
                http.newCall(request).execute().use { response ->
                    val text = response.body.string()
                    if (!response.isSuccessful) {
                        val message = runCatching {
                            sqwackJson.decodeFromString(MapSerializer(String.serializer(), String.serializer()), text)["error"]
                        }.getOrNull() ?: "pairing failed"
                        throw IllegalStateException(message)
                    }
                    sqwackJson.decodeFromString(PairResponse.serializer(), text)
                }
            }
    }
}

@kotlinx.serialization.Serializable
private data class ProcessesWrapper(val processes: List<DevProcess> = emptyList())

@kotlinx.serialization.Serializable
private data class UsageWrapper(val usage: List<ProviderUsage> = emptyList())

@kotlinx.serialization.Serializable
private data class IntegrationsWrapper(val integrations: List<IntegrationCapability> = emptyList())

private fun <T> androidx.compose.runtime.snapshots.SnapshotStateList<T>.replaceAll(items: List<T>) {
    clear()
    addAll(items)
}
