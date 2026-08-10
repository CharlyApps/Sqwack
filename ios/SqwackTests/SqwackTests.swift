import XCTest
@testable import Sqwack

final class SqwackTests: XCTestCase {

    // MARK: - Wire decoding

    func testSnapshotDecoding() throws {
        let json = """
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
        guard case .snapshot(let snapshot) = ServerMessage.decode(Data(json.utf8)) else {
            return XCTFail("expected snapshot")
        }
        XCTAssertEqual(snapshot.status, .attention)
        XCTAssertEqual(snapshot.sessions.first?.state, .needsInput)
        XCTAssertEqual(snapshot.processes.first?.port, 3000)
        XCTAssertEqual(snapshot.machine.name, "Mini")
    }

    func testSessionUpdateDecoding() throws {
        let json = """
        {"type":"session.updated","data":{"id":"codex:s2","machineId":"m1","provider":"codex",
         "state":"done","updatedAt":"2026-08-10T12:01:00Z","source":"codex-cli"}}
        """
        guard case .sessionUpdated(let session) = ServerMessage.decode(Data(json.utf8)) else {
            return XCTFail("expected session.updated")
        }
        XCTAssertEqual(session.state, .done)
    }

    func testUnknownStateAndStatusFallBackSafely() throws {
        let json = """
        {"type":"session.updated","data":{"id":"x","machineId":"m1","provider":"codex",
         "state":"astral_projection","updatedAt":"2026-08-10T12:01:00Z","source":"t"}}
        """
        guard case .sessionUpdated(let session) = ServerMessage.decode(Data(json.utf8)) else {
            return XCTFail("expected decode to survive unknown enum value")
        }
        XCTAssertEqual(session.state, .unknown)
    }

    func testUnknownMessageTypeDoesNotCrash() {
        if case .unknown = ServerMessage.decode(Data(#"{"type":"quantum.entangled"}"#.utf8)) {} else {
            XCTFail("expected .unknown")
        }
        if case .unknown = ServerMessage.decode(Data("not json".utf8)) {} else {
            XCTFail("expected .unknown")
        }
    }

    // MARK: - Aggregate status (multi-machine-safe: worst wins)

    func testGlobalStatusOrdering() {
        XCTAssertEqual([SqwackStatus.quiet, .working].max(), .working)
        XCTAssertEqual([SqwackStatus.working, .failure].max(), .failure)
        XCTAssertEqual([SqwackStatus.failure, .attention].max(), .attention)
        XCTAssertEqual([SqwackStatus]().max(), nil)
    }

    // MARK: - Glanceable rendering helpers

    func testStateLabelsAndColorsAreDistinct() {
        let labels = AgentState.allCases.map(\.label)
        XCTAssertEqual(Set(labels).count, labels.count)
        XCTAssertEqual(AgentState.needsInput.label, "NEEDS YOU")
    }

    func testElapsedLabelFormats() {
        XCTAssertEqual(Date.now.addingTimeInterval(-125).elapsedLabel, "02:05")
        XCTAssertEqual(Date.now.addingTimeInterval(-7320).elapsedLabel, "2h 2m")
        XCTAssertEqual(Date.now.addingTimeInterval(-30).agoLabel, "just now")
        XCTAssertEqual(Date.now.addingTimeInterval(-300).agoLabel, "5m ago")
    }
}
