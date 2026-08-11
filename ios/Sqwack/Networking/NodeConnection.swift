import Foundation
import Observation

enum ConnectionState: String {
    case connecting, connected, disconnected, error
}

/// One daemon (= one machine). SqwackStore can hold several of these; the MVP
/// UI pairs with exactly one, but nothing in this layer assumes that.
@Observable
final class NodeConnection {
    let endpoint: URL
    let credentialRef: String

    private(set) var connectionState: ConnectionState = .disconnected
    private(set) var machine: Machine?
    private(set) var status: SqwackStatus = .quiet
    private(set) var sessions: [String: AgentSession] = [:]
    private(set) var processes: [DevProcess] = []
    private(set) var usage: [ProviderUsage] = []
    private(set) var system: SystemSnapshot?
    private(set) var topProcesses: [ProcessMetric] = []
    private(set) var activity: [ActivityItem] = []
    private(set) var lastHeartbeat: Date?
    private(set) var lastError: String?

    private var socket: URLSessionWebSocketTask?
    private var reconnectAttempt = 0
    private var closed = false
    private let session = URLSession(configuration: .default)
    private static let usageCachePrefix = "sqwack.usage."

    var token: String? { Keychain.load(ref: credentialRef) }

    init(endpoint: URL, credentialRef: String) {
        self.endpoint = endpoint
        self.credentialRef = credentialRef
        self.usage = Self.cachedUsage(ref: credentialRef)
    }

    // MARK: - Lifecycle

    func connect() {
        closed = false
        openSocket()
    }

    func disconnect() {
        closed = true
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        connectionState = .disconnected
    }

    private func openSocket() {
        guard !closed else { return }
        guard let token else {
            lastError = "WebSocket \(endpoint.absoluteString): missing stored token"
            connectionState = .error
            return
        }
        connectionState = .connecting
        var components = URLComponents(url: endpoint.appending(path: "/v1/ws"), resolvingAgainstBaseURL: false)!
        components.scheme = endpoint.scheme == "https" ? "wss" : "ws"
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let task = session.webSocketTask(with: request)
        socket = task
        task.resume()
        receive(on: task)
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self, self.socket === task else { return }
            switch result {
            case .success(let message):
                let data: Data? = switch message {
                case .data(let d): d
                case .string(let s): Data(s.utf8)
                @unknown default: nil
                }
                if let data {
                    Task { @MainActor in self.handle(ServerMessage.decode(data)) }
                }
                self.receive(on: task)
            case .failure(let error):
                Task { @MainActor in self.scheduleReconnect(error) }
            }
        }
    }

    @MainActor
    private func handle(_ message: ServerMessage) {
        switch message {
        case .snapshot(let snapshot):
            lastError = nil
            connectionState = .connected
            reconnectAttempt = 0
            machine = snapshot.machine
            status = snapshot.status
            sessions = Dictionary(uniqueKeysWithValues: snapshot.sessions.map { ($0.id, $0) })
            processes = snapshot.processes
            applyUsage(snapshot.usage ?? [])
            system = snapshot.system
            topProcesses = snapshot.topProcesses ?? []
            activity = snapshot.activity ?? []
            lastHeartbeat = .now
        case .sessionUpdated(let session):
            lastError = nil
            sessions[session.id] = session
        case .processesUpdated(let procs):
            lastError = nil
            processes = procs
        case .usageUpdated(let newUsage):
            lastError = nil
            applyUsage(newUsage)
        case .systemUpdated(let newSystem):
            lastError = nil
            system = newSystem
        case .statusUpdated(let newStatus):
            lastError = nil
            status = newStatus
        case .heartbeat:
            lastHeartbeat = .now
        case .unknown:
            lastError = "WebSocket: daemon sent an unknown or undecodable message"
        case .event:
            break
        }
    }

    @MainActor
    private func scheduleReconnect(_ error: Error? = nil) {
        guard !closed else { return }
        if let error { reportError("WebSocket", error) }
        connectionState = sessions.isEmpty ? .error : .disconnected
        socket?.cancel()
        socket = nil
        let delay = min(pow(2.0, Double(reconnectAttempt)), 30)
        reconnectAttempt += 1
        Task {
            try? await Task.sleep(for: .seconds(delay))
            guard !closed else { return }
            openSocket() // server re-sends a full snapshot on connect: state refreshes automatically
        }
    }

    @MainActor
    func clearError() {
        lastError = nil
    }

    @MainActor
    private func reportError(_ context: String, _ error: Error) {
        lastError = "\(context): \(error.localizedDescription)"
        lastHeartbeat = .now
    }

    private func decodeError(_ context: String) -> NSError {
        NSError(domain: "sqwack", code: 0, userInfo: [NSLocalizedDescriptionKey: "\(context) response could not be decoded"])
    }

    // MARK: - REST commands

    private func request(_ path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        guard let token else { throw URLError(.userAuthenticationRequired) }
        var request = URLRequest(url: endpoint.appending(path: path))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            struct APIError: Codable { var error: String }
            let message = (try? JSONDecoder().decode(APIError.self, from: data))?.error ?? "request failed"
            throw NSError(domain: "sqwack", code: (response as? HTTPURLResponse)?.statusCode ?? 0,
                          userInfo: [NSLocalizedDescriptionKey: message])
        }
        return data
    }

    func refreshSnapshot() async {
        do {
            let data = try await request("/v1/snapshot")
            guard let snapshot = try? JSONDecoder.sqwack.decode(Snapshot.self, from: data) else {
                await reportError("GET /v1/snapshot", decodeError("snapshot"))
                return
            }
            await handle(.snapshot(snapshot))
        } catch {
            await reportError("GET /v1/snapshot", error)
        }
    }

    func refreshProcesses() async {
        struct Wrapper: Codable { var processes: [DevProcess] }
        do {
            let data = try await request("/v1/processes")
            guard let wrapper = try? JSONDecoder.sqwack.decode(Wrapper.self, from: data) else {
                await reportError("GET /v1/processes", decodeError("processes"))
                return
            }
            await handle(.processesUpdated(wrapper.processes))
        } catch {
            await reportError("GET /v1/processes", error)
        }
    }

    func refreshUsage(provider: String? = nil) async {
        struct Wrapper: Codable { var usage: [ProviderUsage] }
        let body = try? JSONEncoder().encode(provider.map { ["provider": $0] } ?? [:])
        do {
            let data = try await request("/v1/usage/refresh", method: "POST", body: body)
            guard let wrapper = try? JSONDecoder.sqwack.decode(Wrapper.self, from: data) else {
                await reportError("POST /v1/usage/refresh", decodeError("usage"))
                return
            }
            await handle(.usageUpdated(wrapper.usage))
        } catch {
            await reportError("POST /v1/usage/refresh", error)
        }
    }

    func kill(process: DevProcess) async throws {
        _ = try await request("/v1/processes/\(process.id)/kill", method: "POST")
    }

    func acknowledge(session sessionId: String) async {
        let escaped = pathComponent(sessionId)
        do {
            _ = try await request("/v1/sessions/\(escaped)/ack", method: "POST")
        } catch {
            await reportError("POST /v1/sessions/\(escaped)/ack", error)
        }
    }

    func transcript(sessionId: String) async -> Transcript? {
        let escaped = pathComponent(sessionId)
        do {
            let data = try await request("/v1/sessions/\(escaped)/transcript")
            guard let transcript = try? JSONDecoder.sqwack.decode(Transcript.self, from: data) else {
                await reportError("GET /v1/sessions/\(escaped)/transcript", decodeError("transcript"))
                return nil
            }
            return transcript
        } catch {
            await reportError("GET /v1/sessions/\(escaped)/transcript", error)
            return nil
        }
    }

    func integrations() async -> [IntegrationCapability] {
        struct Wrapper: Codable { var integrations: [IntegrationCapability] }
        do {
            let data = try await request("/v1/integrations")
            guard let wrapper = try? JSONDecoder.sqwack.decode(Wrapper.self, from: data) else {
                await reportError("GET /v1/integrations", decodeError("integrations"))
                return []
            }
            return wrapper.integrations
        } catch {
            await reportError("GET /v1/integrations", error)
            return []
        }
    }

    // MARK: - Pairing (static: runs before a connection exists)

    struct PairResponse: Codable {
        var token: String
        var deviceId: String
        var machine: Machine
    }

    static func pair(endpoint: URL, code: String, deviceName: String) async throws -> PairResponse {
        var request = URLRequest(url: endpoint.appending(path: "/v1/pair"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["code": code, "deviceName": deviceName])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            struct APIError: Codable { var error: String }
            let message = (try? JSONDecoder().decode(APIError.self, from: data))?.error ?? "pairing failed"
            throw NSError(domain: "sqwack", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        }
        return try JSONDecoder.sqwack.decode(PairResponse.self, from: data)
    }

    private func pathComponent(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#[]@!$&'()*+,;=")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private func applyUsage(_ newUsage: [ProviderUsage]) {
        guard !newUsage.isEmpty else { return }
        for item in newUsage {
            if let index = usage.firstIndex(where: { $0.provider == item.provider }) {
                usage[index] = item
            } else {
                usage.append(item)
            }
        }
        if let data = try? JSONEncoder().encode(usage) {
            UserDefaults.standard.set(data, forKey: Self.usageCachePrefix + credentialRef)
        }
    }

    private static func cachedUsage(ref: String) -> [ProviderUsage] {
        guard let data = UserDefaults.standard.data(forKey: usageCachePrefix + ref),
              let usage = try? JSONDecoder().decode([ProviderUsage].self, from: data) else { return [] }
        return usage
    }
}
