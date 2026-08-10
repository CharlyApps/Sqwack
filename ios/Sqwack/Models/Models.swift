import Foundation

// Wire types mirroring docs/protocol.md. Decoded defensively: unknown enum
// values fall back instead of failing the whole payload.

enum AgentState: String, Codable, CaseIterable {
    case working, needsInput = "needs_input", done, failed, idle, unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AgentState(rawValue: raw) ?? .unknown
    }
}

enum SqwackStatus: String, Codable, Comparable {
    case quiet, working, attention, failure

    private var rank: Int {
        switch self {
        case .quiet: 0
        case .working: 1
        case .failure: 2
        case .attention: 3
        }
    }

    static func < (lhs: SqwackStatus, rhs: SqwackStatus) -> Bool { lhs.rank < rhs.rank }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = SqwackStatus(rawValue: raw) ?? .quiet
    }
}

struct AgentSession: Codable, Identifiable, Equatable {
    var id: String
    var machineId: String
    var provider: String
    var projectId: String?
    var projectName: String?
    var cwd: String?
    var title: String?
    var state: AgentState
    var summary: String?
    var startedAt: Date?
    var updatedAt: Date
    var finishedAt: Date?
    var waitingSince: Date?
    var source: String
}

struct Machine: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var hostname: String
    var platform: String
    var architecture: String
    var daemonVersion: String
    var status: String
    var lastSeenAt: Date
    var capabilities: [String]
}

struct DevProcess: Codable, Identifiable, Equatable {
    var id: String
    var machineId: String
    var pid: Int
    var name: String
    var command: String?
    var cwd: String?
    var port: Int?
    var protocolName: String?
    var startedAt: Date?
    var category: String?
    var killable: Bool

    enum CodingKeys: String, CodingKey {
        case id, machineId, pid, name, command, cwd, port
        case protocolName = "protocol"
        case startedAt, category, killable
    }
}

struct IntegrationCapability: Codable, Identifiable {
    var integration: String
    var installed: Bool
    var surfaces: [String]
    var events: [String]
    var confidence: String
    var id: String { integration }
}

struct UsageWindow: Codable, Equatable, Identifiable {
    var label: String
    var usedPercent: Double
    var resetsAt: Date?
    var id: String { label }
}

struct ProviderUsage: Codable, Equatable, Identifiable {
    var provider: String
    var planType: String?
    var windows: [UsageWindow]
    var collectedAt: Date
    var source: String
    var id: String { provider }
}

struct Snapshot: Codable {
    var machine: Machine
    var status: SqwackStatus
    var sessions: [AgentSession]
    var attention: [AgentSession]
    var processes: [DevProcess]
    var usage: [ProviderUsage]?
    var connectedAt: Date
}

enum ServerMessage {
    case snapshot(Snapshot)
    case event
    case sessionUpdated(AgentSession)
    case processesUpdated([DevProcess])
    case usageUpdated([ProviderUsage])
    case statusUpdated(SqwackStatus)
    case heartbeat
    case unknown
}

extension ServerMessage {
    static func decode(_ data: Data) -> ServerMessage {
        struct Envelope: Codable { var type: String }
        struct Payload<T: Codable>: Codable { var data: T }
        let decoder = JSONDecoder.sqwack
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return .unknown }
        switch envelope.type {
        case "snapshot":
            guard let p = try? decoder.decode(Payload<Snapshot>.self, from: data) else { return .unknown }
            return .snapshot(p.data)
        case "session.updated":
            guard let p = try? decoder.decode(Payload<AgentSession>.self, from: data) else { return .unknown }
            return .sessionUpdated(p.data)
        case "processes.updated":
            guard let p = try? decoder.decode(Payload<[DevProcess]>.self, from: data) else { return .unknown }
            return .processesUpdated(p.data)
        case "usage.updated":
            guard let p = try? decoder.decode(Payload<[ProviderUsage]>.self, from: data) else { return .unknown }
            return .usageUpdated(p.data)
        case "status.updated":
            guard let p = try? decoder.decode(Payload<SqwackStatus>.self, from: data) else { return .unknown }
            return .statusUpdated(p.data)
        case "event": return .event
        case "heartbeat": return .heartbeat
        default: return .unknown
        }
    }
}

extension JSONDecoder {
    /// ISO-8601 with fractional seconds (the daemon emits `Date().toISOString()`).
    static let sqwack: JSONDecoder = {
        let decoder = JSONDecoder()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        decoder.dateDecodingStrategy = .custom { d in
            let raw = try d.singleValueContainer().decode(String.self)
            if let date = fractional.date(from: raw) ?? plain.date(from: raw) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: d.codingPath, debugDescription: "bad date \(raw)"))
        }
        return decoder
    }()
}
