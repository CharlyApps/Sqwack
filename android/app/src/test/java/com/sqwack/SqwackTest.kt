package com.sqwack

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/// Mirrors ios/SqwackTests: wire decoding must survive unknown values, and the
/// glanceable label helpers must format exactly as the iOS app does.
class SqwackTest {

    @Test
    fun snapshotDecoding() {
        val json = """
        {"type":"snapshot","data":{
          "machine":{"id":"m1","name":"Mini","hostname":"mini.local","platform":"darwin","architecture":"arm64",
                     "daemonVersion":"0.1.0","status":"online","lastSeenAt":"2026-08-10T12:00:00.000Z","capabilities":["events"]},
          "status":"attention",
          "sessions":[{"id":"claude:s1","machineId":"m1","provider":"claude","projectName":"T&E Platform",
                       "state":"needs_input","summary":"Waiting for permission","updatedAt":"2026-08-10T12:00:00.000Z",
                       "waitingSince":"2026-08-10T11:59:57.000Z","source":"claude-code"}],
          "attention":[],
          "processes":[{"id":"123-abc","machineId":"m1","pid":123,"name":"tabor-api","port":3000,
                        "protocol":"tcp","category":"node","killable":true}],
          "connectedAt":"2026-08-10T12:00:00.000Z"}}
        """
        val message = ServerMessage.decode(json) as ServerMessage.SnapshotMessage
        assertEquals(SqwackStatus.ATTENTION, message.snapshot.status)
        assertEquals(AgentState.NEEDS_INPUT, message.snapshot.sessions.first().state)
        assertEquals(3000, message.snapshot.processes.first().port)
        assertEquals("Mini", message.snapshot.machine.name)
    }

    @Test
    fun hermesUpdateDecoding() {
        val json = """
        {"type":"hermes.updated","data":{"updatedAt":"2026-08-10T12:01:00Z","gateways":[{
          "profile":"writer","running":true,"state":"running","activeAgents":1,
          "platforms":[{"name":"slack","state":"connected"}],
          "cronJobs":[{"id":"writer:daily","jobId":"daily","name":"Daily report","enabled":true,
                       "schedule":"Every 60 min","nextRunAt":"2026-08-10T13:00:00Z","delivery":"slack"}]}]}}
        """
        val message = ServerMessage.decode(json) as ServerMessage.HermesUpdated
        assertEquals("writer", message.hermes.gateways.first().profile)
        assertEquals("slack", message.hermes.gateways.first().cronJobs.first().delivery)
    }

    @Test
    fun unknownEnumValueFallsBackSafely() {
        val json = """{"type":"session.updated","data":{"id":"x","machineId":"m1","provider":"codex",
         "state":"astral_projection","updatedAt":"2026-08-10T12:01:00Z","source":"t"}}"""
        val message = ServerMessage.decode(json) as ServerMessage.SessionUpdated
        assertEquals(AgentState.UNKNOWN, message.session.state)
    }

    @Test
    fun unknownMessageTypeDoesNotCrash() {
        assertEquals(ServerMessage.Unknown, ServerMessage.decode("""{"type":"quantum.entangled"}"""))
        assertEquals(ServerMessage.Unknown, ServerMessage.decode("not json"))
    }

    @Test
    fun globalStatusOrdering() {
        assertEquals(SqwackStatus.WORKING, listOf(SqwackStatus.QUIET, SqwackStatus.WORKING).maxByOrNull { it.rank })
        assertEquals(SqwackStatus.FAILURE, listOf(SqwackStatus.WORKING, SqwackStatus.FAILURE).maxByOrNull { it.rank })
        assertEquals(SqwackStatus.ATTENTION, listOf(SqwackStatus.FAILURE, SqwackStatus.ATTENTION).maxByOrNull { it.rank })
        assertNull(emptyList<SqwackStatus>().maxByOrNull { it.rank })
    }

    @Test
    fun stateLabelsAreDistinct() {
        val labels = AgentState.entries.map { it.label }
        assertEquals(labels.size, labels.toSet().size)
        assertEquals("NEEDS YOU", AgentState.NEEDS_INPUT.label)
    }

    @Test
    fun labelFormats() {
        val now = Instant.parse("2026-08-10T12:00:00Z")
        assertEquals("02:05", now.minusSeconds(125).elapsedLabel(now))
        assertEquals("2h 2m", now.minusSeconds(7320).elapsedLabel(now))
        assertEquals("just now", now.minusSeconds(30).agoLabel(now))
        assertEquals("5m ago", now.minusSeconds(300).agoLabel(now))
        assertEquals("1d 2h 3m", now.preciseRemainingLabel(now.plusSeconds(86400 + 7200 + 180)))
        assertEquals("2.0 GB", Format.bytes(2L * 1024 * 1024 * 1024))
        assertEquals("3d 4h", Format.uptime(3 * 86400 + 4 * 3600))
    }

    @Test
    fun endpointNormalization() {
        assertEquals("http://mac.local:4737", normalizeEndpoint("mac.local"))
        assertEquals("http://192.168.1.20:9000", normalizeEndpoint("192.168.1.20:9000"))
        assertEquals("https://mini.ts.net:4737", normalizeEndpoint("https://mini.ts.net"))
        assertNull(normalizeEndpoint("   "))
        assertTrue(normalizeEndpoint("mac.local")!!.startsWith("http://"))
    }
}
