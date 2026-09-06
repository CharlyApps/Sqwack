package com.sqwack

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant

// Wire types mirroring docs/protocol.md (same shapes as the iOS app). Decoded
// defensively: unknown enum values fall back instead of failing the payload.

@Serializable(with = AgentStateSerializer::class)
enum class AgentState(val wire: String) {
    WORKING("working"), NEEDS_INPUT("needs_input"), DONE("done"),
    FAILED("failed"), IDLE("idle"), UNKNOWN("unknown");

    companion object {
        fun from(raw: String) = entries.firstOrNull { it.wire == raw } ?: UNKNOWN
    }
}

object AgentStateSerializer : KSerializer<AgentState> {
    override val descriptor = PrimitiveSerialDescriptor("AgentState", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder) = AgentState.from(decoder.decodeString())
    override fun serialize(encoder: Encoder, value: AgentState) = encoder.encodeString(value.wire)
}

/// Ordered worst-last: `max()` over machines picks the loudest status.
@Serializable(with = SqwackStatusSerializer::class)
enum class SqwackStatus(val wire: String, val rank: Int) {
    QUIET("quiet", 0), WORKING("working", 1), FAILURE("failure", 2), ATTENTION("attention", 3);

    companion object {
        fun from(raw: String) = entries.firstOrNull { it.wire == raw } ?: QUIET
    }
}

object SqwackStatusSerializer : KSerializer<SqwackStatus> {
    override val descriptor = PrimitiveSerialDescriptor("SqwackStatus", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder) = SqwackStatus.from(decoder.decodeString())
    override fun serialize(encoder: Encoder, value: SqwackStatus) = encoder.encodeString(value.wire)
}

/// The daemon emits `Date().toISOString()`; Instant.parse handles it directly.
object InstantSerializer : KSerializer<Instant> {
    override val descriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder): Instant = Instant.parse(decoder.decodeString())
    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(value.toString())
}

typealias WireInstant = @Serializable(with = InstantSerializer::class) Instant

@Serializable
data class AgentSession(
    val id: String,
    val machineId: String,
    val provider: String,
    val projectId: String? = null,
    val projectName: String? = null,
    val cwd: String? = null,
    val title: String? = null,
    val state: AgentState,
    val summary: String? = null,
    val startedAt: WireInstant? = null,
    val updatedAt: WireInstant,
    val finishedAt: WireInstant? = null,
    val waitingSince: WireInstant? = null,
    val source: String,
    val activity: List<Int>? = null,
)

@Serializable
data class Machine(
    val id: String,
    val name: String,
    val hostname: String,
    val platform: String,
    val architecture: String,
    val daemonVersion: String,
    val status: String,
    val lastSeenAt: WireInstant,
    val capabilities: List<String> = emptyList(),
)

@Serializable
data class DevProcess(
    val id: String,
    val machineId: String,
    val pid: Int,
    val name: String,
    val command: String? = null,
    val cwd: String? = null,
    val port: Int? = null,
    @SerialName("protocol") val protocolName: String? = null,
    val startedAt: WireInstant? = null,
    val category: String? = null,
    val containerRuntime: String? = null,
    val killable: Boolean = false,
    val cpuPercent: Double? = null,
    val memoryBytes: Long? = null,
    val cpuHistory: List<Double>? = null,
)

@Serializable
data class IntegrationCapability(
    val integration: String,
    val installed: Boolean,
    val surfaces: List<String> = emptyList(),
    val events: List<String> = emptyList(),
    val confidence: String,
)

@Serializable
data class UsageWindow(
    val label: String,
    val usedPercent: Double,
    val resetsAt: WireInstant? = null,
    val detail: String? = null,
)

@Serializable
data class ProviderUsage(
    val provider: String,
    val planType: String? = null,
    val windows: List<UsageWindow> = emptyList(),
    val collectedAt: WireInstant,
    val source: String,
)

@Serializable
data class SystemStats(
    val cpuPercent: Double,
    val cpuUserPercent: Double = 0.0,
    val cpuSystemPercent: Double = 0.0,
    val ramUsedBytes: Long,
    val ramTotalBytes: Long,
    val diskUsedBytes: Long,
    val diskTotalBytes: Long,
    val uptimeSeconds: Int,
    val processCount: Int,
    val networkMbps: Double,
    val collectedAt: WireInstant,
)

@Serializable
data class SystemHistory(
    val cpu: List<Double> = emptyList(),
    val ram: List<Double> = emptyList(),
    val network: List<Double> = emptyList(),
)

@Serializable
data class SystemSnapshot(val stats: SystemStats, val history: SystemHistory)

@Serializable
data class ProcessMetric(val pid: Int, val name: String, val cpuPercent: Double, val memoryBytes: Long)

@Serializable
data class ActivityItem(val timestamp: WireInstant, val message: String, val severity: String)

@Serializable
data class TranscriptMessage(val role: String, val text: String, val timestamp: WireInstant? = null)

@Serializable
data class Transcript(val available: Boolean, val source: String? = null, val messages: List<TranscriptMessage> = emptyList())

@Serializable
data class HermesPlatform(val name: String, val state: String)

@Serializable
data class HermesCronJob(
    val id: String,
    val jobId: String,
    val name: String,
    val enabled: Boolean,
    val state: String? = null,
    val schedule: String,
    val nextRunAt: WireInstant? = null,
    val lastRunAt: WireInstant? = null,
    val lastStatus: String? = null,
    val errorKind: String? = null,
    val delivery: String? = null,
)

@Serializable
data class HermesGateway(
    val profile: String,
    val running: Boolean,
    val state: String,
    val activeAgents: Int = 0,
    val platforms: List<HermesPlatform> = emptyList(),
    val cronJobs: List<HermesCronJob> = emptyList(),
)

@Serializable
data class HermesSnapshot(val gateways: List<HermesGateway> = emptyList(), val updatedAt: WireInstant)

@Serializable
data class Snapshot(
    val machine: Machine,
    val status: SqwackStatus,
    val sessions: List<AgentSession> = emptyList(),
    val attention: List<AgentSession> = emptyList(),
    val processes: List<DevProcess> = emptyList(),
    val usage: List<ProviderUsage>? = null,
    val system: SystemSnapshot? = null,
    val topProcesses: List<ProcessMetric>? = null,
    val activity: List<ActivityItem>? = null,
    val hermes: HermesSnapshot? = null,
    val connectedAt: WireInstant,
)

@Serializable
data class TimesGateState(val configured: Boolean, val enabled: Boolean)

@Serializable
data class PairResponse(val token: String, val deviceId: String, val machine: Machine)

val sqwackJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    explicitNulls = false
    encodeDefaults = true
}

sealed interface ServerMessage {
    data class SnapshotMessage(val snapshot: Snapshot) : ServerMessage
    data class SessionUpdated(val session: AgentSession) : ServerMessage
    data class ProcessesUpdated(val processes: List<DevProcess>) : ServerMessage
    data class UsageUpdated(val usage: List<ProviderUsage>) : ServerMessage
    data class SystemUpdated(val system: SystemSnapshot) : ServerMessage
    data class HermesUpdated(val hermes: HermesSnapshot) : ServerMessage
    data class StatusUpdated(val status: SqwackStatus) : ServerMessage
    data object Event : ServerMessage
    data object Heartbeat : ServerMessage
    data object Unknown : ServerMessage

    companion object {
        fun decode(text: String): ServerMessage = runCatching {
            val root: JsonObject = sqwackJson.parseToJsonElement(text).jsonObject
            val data = root["data"]
            fun <T> payload(serializer: KSerializer<T>): T =
                sqwackJson.decodeFromJsonElement(serializer, data!!)
            when (root["type"]?.jsonPrimitive?.content) {
                "snapshot" -> SnapshotMessage(payload(Snapshot.serializer()))
                "session.updated" -> SessionUpdated(payload(AgentSession.serializer()))
                "processes.updated" -> ProcessesUpdated(payload(kotlinx.serialization.builtins.ListSerializer(DevProcess.serializer())))
                "usage.updated" -> UsageUpdated(payload(kotlinx.serialization.builtins.ListSerializer(ProviderUsage.serializer())))
                "system.updated" -> SystemUpdated(payload(SystemSnapshot.serializer()))
                "hermes.updated" -> HermesUpdated(payload(HermesSnapshot.serializer()))
                "status.updated" -> StatusUpdated(payload(SqwackStatusSerializer))
                "event" -> Event
                "heartbeat" -> Heartbeat
                else -> Unknown
            }
        }.getOrElse { Unknown }
    }
}
