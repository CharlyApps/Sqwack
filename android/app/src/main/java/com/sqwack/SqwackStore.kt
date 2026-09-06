package com.sqwack

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import java.time.Instant

/// Root store. Holds one NodeConnection per registered daemon; every query
/// takes a machineId or `null` (= all machines) so multi-machine needs no
/// schema change — only more nodes in the list and a picker in the UI.
class SqwackStore(context: Context) {
    // ponytail: app-private SharedPreferences, not EncryptedSharedPreferences.
    // Jetpack Security Crypto is deprecated and the file is already inside the
    // app sandbox on a full-disk-encrypted device. Swap it if the tablet is shared.
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("sqwack", Context.MODE_PRIVATE)

    val nodes = mutableStateListOf<NodeConnection>()
    var selectedMachineId by mutableStateOf<String?>(null)

    init {
        prefs.getStringSet(ENDPOINTS_KEY, emptySet()).orEmpty().sorted().forEach { saved ->
            nodes.add(NodeConnection(saved, saved, prefs))
        }
    }

    val isPaired: Boolean get() = nodes.isNotEmpty()

    fun connectAll() = nodes.forEach { it.connect() }

    fun addNode(endpoint: String, token: String) {
        prefs.edit()
            .putString(NodeConnection.TOKEN_PREFIX + endpoint, token)
            .putStringSet(ENDPOINTS_KEY, savedEndpoints() + endpoint)
            .apply()
        val node = NodeConnection(endpoint, endpoint, prefs)
        nodes.add(node)
        node.connect()
    }

    fun removeNode(node: NodeConnection) {
        if (selectedMachineId == node.machine?.id) selectedMachineId = null
        node.disconnect()
        prefs.edit()
            .remove(NodeConnection.TOKEN_PREFIX + node.credentialRef)
            .putStringSet(ENDPOINTS_KEY, savedEndpoints() - node.credentialRef)
            .apply()
        nodes.remove(node)
    }

    private fun savedEndpoints(): Set<String> = prefs.getStringSet(ENDPOINTS_KEY, emptySet()).orEmpty().toSet()

    private fun matching(machineId: String?) = nodes.filter { machineId == null || it.machine?.id == machineId }

    suspend fun refreshUsage(provider: String? = null, machineId: String? = null) {
        matching(machineId).forEach { it.refreshUsage(provider) }
    }

    suspend fun refreshAll(machineId: String? = null) {
        matching(machineId).forEach { it.refreshSnapshot() }
    }

    suspend fun refreshAgents(machineId: String? = null) = refreshAll(machineId)

    suspend fun refreshProcessesOnly(machineId: String? = null) {
        matching(machineId).forEach { it.refreshProcesses() }
    }

    suspend fun refreshProcesses(machineId: String? = null) = refreshAll(machineId)

    val lastError: String? get() = nodes.firstNotNullOfOrNull { it.lastError }

    fun clearError() = nodes.forEach { it.clearError() }

    // MARK: - Aggregation (machineId == null means "all machines")

    fun sessions(machineId: String? = null): List<AgentSession> =
        nodes.flatMap { it.sessions.values }
            .filter { machineId == null || it.machineId == machineId }
            .filterNot { it.source == "claude-process" && it.state == AgentState.IDLE }
            .sortedByDescending { it.updatedAt }

    fun processes(machineId: String? = null): List<DevProcess> =
        nodes.flatMap { it.processes }
            .filter { machineId == null || it.machineId == machineId }
            .sortedBy { it.port ?: 0 }

    fun machineName(machineId: String): String =
        nodes.firstOrNull { it.machine?.id == machineId }?.machine?.name ?: machineId

    /// MVP: system stats of the first (only) machine. Multi-machine: key by machineId.
    val system: SystemSnapshot? get() = nodes.firstOrNull()?.system
    val topProcesses: List<ProcessMetric> get() = nodes.firstOrNull()?.topProcesses.orEmpty()

    fun activity(machineId: String? = null): List<ActivityItem> =
        matching(machineId).flatMap { it.activity }.sortedByDescending { it.timestamp }

    val machineName: String get() = nodes.firstOrNull()?.machine?.name.orEmpty()
    val daemonVersion: String get() = nodes.firstOrNull()?.machine?.daemonVersion ?: "0.1.0"

    fun usage(machineId: String? = null): List<ProviderUsage> =
        matching(machineId).flatMap { it.usage }
            .groupBy { it.provider }
            .mapNotNull { (_, items) -> items.maxByOrNull { it.collectedAt } }
            .sortedBy { it.provider }

    val hermesNodes: List<NodeConnection>
        get() = nodes.filter {
            (selectedMachineId == null || it.machine?.id == selectedMachineId) &&
                it.hermes?.gateways?.isNotEmpty() == true
        }

    val hasHermes: Boolean get() = hermesNodes.isNotEmpty()

    /// Global status = worst status across machines (attention > failure > working > quiet).
    fun status(machineId: String? = null): SqwackStatus =
        matching(machineId).maxByOrNull { it.status.rank }?.status ?: SqwackStatus.QUIET

    val attention: List<AgentSession>
        get() = sessions().filter { it.state == AgentState.NEEDS_INPUT || it.state == AgentState.FAILED }

    /// Sessions worth showing on the ambient board: anything active, plus
    /// recently finished ones (done/failed fade out after an hour).
    fun boardSessions(machineId: String? = null): List<AgentSession> {
        val now = Instant.now()
        return sessions(machineId).filter { session ->
            when (session.state) {
                AgentState.WORKING, AgentState.NEEDS_INPUT -> true
                AgentState.DONE, AgentState.FAILED -> session.updatedAt > now.minusSeconds(3600)
                AgentState.IDLE, AgentState.UNKNOWN -> session.updatedAt > now.minusSeconds(900)
            }
        }
    }

    val anyConnected: Boolean get() = nodes.any { it.connectionState == ConnectionState.CONNECTED }
    val connectedMachineNames: List<String>
        get() = nodes.filter { it.connectionState == ConnectionState.CONNECTED }.mapNotNull { it.machine?.name }

    private companion object {
        const val ENDPOINTS_KEY = "sqwack.endpoints"
    }
}
