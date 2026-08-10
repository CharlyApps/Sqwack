import SwiftUI

struct SettingsView: View {
    @Environment(SqwackStore.self) private var store
    @State private var integrations: [String: [IntegrationCapability]] = [:]
    @State private var showPairing = false

    var body: some View {
        NavigationStack {
            Form {
                ForEach(store.nodes, id: \.credentialRef) { node in
                    Section(node.machine?.name ?? node.endpoint.host() ?? "Daemon") {
                        LabeledContent("Endpoint", value: node.endpoint.absoluteString)
                        LabeledContent("Connection") {
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(node.connectionState == .connected ? .green : node.connectionState == .connecting ? .amber : .red)
                                    .frame(width: 10, height: 10)
                                Text(node.connectionState.rawValue.capitalized)
                            }
                        }
                        if let machine = node.machine {
                            LabeledContent("Machine", value: "\(machine.name) (\(machine.platform)/\(machine.architecture))")
                            LabeledContent("Daemon version", value: machine.daemonVersion)
                            LabeledContent("Machine ID", value: String(machine.id.prefix(8)) + "…")
                        }
                        if let heartbeat = node.lastHeartbeat {
                            LabeledContent("Last heartbeat", value: heartbeat.agoLabel)
                        }
                        ForEach(integrations[node.credentialRef] ?? []) { integration in
                            LabeledContent(integration.integration) {
                                Text(integration.installed ? "\(integration.confidence) / active" : "not installed")
                                    .foregroundStyle(integration.installed ? .green : .secondary)
                            }
                        }
                        Button("Unpair this machine", role: .destructive) {
                            store.removeNode(node)
                        }
                    }
                }
                Section {
                    Button("Pair a machine…") { showPairing = true }
                } footer: {
                    Text("Pair over LAN or Tailscale. Run `sqwackd pair` on the Mac to get a code. Credentials are stored in the iOS Keychain.")
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showPairing) { PairingView() }
            .task {
                for node in store.nodes {
                    integrations[node.credentialRef] = await node.integrations()
                }
            }
        }
    }
}

/// Pairing: enter the daemon endpoint + the short-lived code from `sqwackd pair`.
struct PairingView: View {
    @Environment(SqwackStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var host = ""
    @State private var code = ""
    @State private var error: String?
    @State private var busy = false

    private var endpointURL: URL? {
        var raw = host.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return nil }
        if !raw.contains("://") { raw = "http://" + raw }
        if URL(string: raw)?.port == nil, !raw.hasSuffix(":4737") { raw += ":4737" }
        return URL(string: raw)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("mac-mini.tailnet.ts.net or 192.168.1.20", text: $host)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                } header: {
                    Text("Daemon address")
                } footer: {
                    Text("Port 4737 is assumed if omitted. On the Mac, run `sqwackd pair` to display a pairing code.")
                }
                Section("Pairing code") {
                    TextField("8-character code", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.system(.title2, design: .monospaced))
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
                Button {
                    pair()
                } label: {
                    if busy { ProgressView() } else { Text("Pair") }
                }
                .disabled(endpointURL == nil || code.count < 4 || busy)
            }
            .navigationTitle("Pair with a Mac")
            .toolbar {
                if store.isPaired {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
            }
        }
        .interactiveDismissDisabled(!store.isPaired)
    }

    private func pair() {
        guard let url = endpointURL else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                let response = try await NodeConnection.pair(
                    endpoint: url,
                    code: code.trimmingCharacters(in: .whitespaces),
                    deviceName: UIDevice.current.name
                )
                store.addNode(endpoint: url, token: response.token)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
