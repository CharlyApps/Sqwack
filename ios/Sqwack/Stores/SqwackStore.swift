import Foundation
import Observation

/// Root store. Holds one NodeConnection per registered daemon; every query
/// takes a machineId or `nil` (= all machines) so multi-machine needs no
/// schema change — only more nodes in the array and a picker in the UI.
@Observable
final class SqwackStore {
    private(set) var nodes: [NodeConnection] = []

    private static let endpointsKey = "sqwack.endpoints"

    init() {
        for saved in UserDefaults.standard.stringArray(forKey: Self.endpointsKey) ?? [] {
            if let url = URL(string: saved) {
                nodes.append(NodeConnection(endpoint: url, credentialRef: saved))
            }
        }
        #if DEBUG
        // Dev/testing hook: pre-pair from the environment (used by UI automation).
        let env = ProcessInfo.processInfo.environment
        if nodes.isEmpty, let raw = env["SQWACK_ENDPOINT"], let url = URL(string: raw), let token = env["SQWACK_TOKEN"] {
            addNode(endpoint: url, token: token)
        }
        #endif
    }

    var isPaired: Bool { !nodes.isEmpty }

    func connectAll() {
        nodes.forEach { $0.connect() }
    }

    func addNode(endpoint: URL, token: String) {
        let ref = endpoint.absoluteString
        Keychain.save(token, ref: ref)
        var saved = UserDefaults.standard.stringArray(forKey: Self.endpointsKey) ?? []
        if !saved.contains(ref) { saved.append(ref) }
        UserDefaults.standard.set(saved, forKey: Self.endpointsKey)
        let node = NodeConnection(endpoint: endpoint, credentialRef: ref)
        nodes.append(node)
        node.connect()
    }

    func removeNode(_ node: NodeConnection) {
        node.disconnect()
        Keychain.delete(ref: node.credentialRef)
        var saved = UserDefaults.standard.stringArray(forKey: Self.endpointsKey) ?? []
        saved.removeAll { $0 == node.credentialRef }
        UserDefaults.standard.set(saved, forKey: Self.endpointsKey)
        nodes.removeAll { $0 === node }
    }

    func refreshUsage(provider: String? = nil) async {
        for node in nodes {
            await node.refreshUsage(provider: provider)
        }
    }

    func refreshAll() async {
        for node in nodes {
            await node.refreshSnapshot()
        }
    }

    func refreshAgents() async {
        await refreshAll()
    }

    func refreshProcessesOnly() async {
        for node in nodes {
            await node.refreshProcesses()
        }
    }

    func refreshProcesses() async {
        await refreshAll()
    }

    var lastError: String? {
        nodes.compactMap(\.lastError).first
    }

    @MainActor
    func clearError() {
        nodes.forEach { $0.clearError() }
    }

    // MARK: - Aggregation (machineId == nil means "all machines")

    func sessions(machineId: String? = nil) -> [AgentSession] {
        nodes
            .flatMap { $0.sessions.values }
            .filter { machineId == nil || $0.machineId == machineId }
            .filter { !($0.source == "claude-process" && $0.state == .idle) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    func processes(machineId: String? = nil) -> [DevProcess] {
        nodes
            .flatMap(\.processes)
            .filter { machineId == nil || $0.machineId == machineId }
            .sorted { ($0.port ?? 0) < ($1.port ?? 0) }
    }

    /// MVP: system stats of the first (only) machine. Multi-machine: key by machineId.
    var system: SystemSnapshot? { nodes.first?.system }
    var topProcesses: [ProcessMetric] { nodes.first?.topProcesses ?? [] }
    var activity: [ActivityItem] {
        nodes.flatMap(\.activity).sorted { $0.timestamp > $1.timestamp }
    }
    var machineName: String { nodes.first?.machine?.name ?? "" }
    var machineInfo: String {
        guard let m = nodes.first?.machine else { return "" }
        return "\(m.platform)/\(m.architecture)"
    }
    var daemonVersion: String { nodes.first?.machine?.daemonVersion ?? "0.1.0" }

    var usage: [ProviderUsage] {
        nodes.flatMap(\.usage).sorted { $0.provider < $1.provider }
    }

    var hermesNodes: [NodeConnection] {
        nodes.filter { !($0.hermes?.gateways.isEmpty ?? true) }
    }

    var hasHermes: Bool { !hermesNodes.isEmpty }

    /// Global status = worst status across machines (attention > failure > working > quiet).
    var globalStatus: SqwackStatus {
        nodes.map(\.status).max() ?? .quiet
    }

    var attention: [AgentSession] {
        sessions().filter { $0.state == .needsInput || $0.state == .failed }
    }

    /// Sessions worth showing on the ambient board: anything active, plus
    /// recently finished ones (done/failed fade out after an hour).
    var boardSessions: [AgentSession] {
        sessions().filter { session in
            switch session.state {
            case .working, .needsInput: true
            case .done, .failed: session.updatedAt > .now.addingTimeInterval(-3600)
            case .idle, .unknown: session.updatedAt > .now.addingTimeInterval(-900)
            }
        }
    }

    var anyConnected: Bool { nodes.contains { $0.connectionState == .connected } }
}
