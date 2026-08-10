import SwiftUI

/// Ports & processes with a confirmed, daemon-verified kill action.
struct DevelopmentView: View {
    @Environment(SqwackStore.self) private var store
    @State private var confirmKill: DevProcess?
    @State private var killError: String?
    @State private var killing = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.processes()) { process in
                    ProcessRow(process: process) { confirmKill = process }
                }
                if store.processes().isEmpty {
                    Text("No development services detected")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Development")
            .refreshable {
                for node in store.nodes { await node.refreshSnapshot() }
            }
            .confirmationDialog(
                "Kill \(confirmKill?.name ?? "")?",
                isPresented: Binding(get: { confirmKill != nil }, set: { if !$0 { confirmKill = nil } }),
                titleVisibility: .visible
            ) {
                let killLabel: String = "Kill PID \(confirmKill?.pid ?? 0)" + (confirmKill?.port.map { " on :\($0)" } ?? "")
                Button(killLabel, role: .destructive) {
                    if let process = confirmKill { kill(process) }
                }
                Button("Cancel", role: .cancel) { confirmKill = nil }
            } message: {
                Text("The daemon verifies the process still exists before terminating it (SIGTERM).")
            }
            .alert("Kill failed", isPresented: Binding(get: { killError != nil }, set: { if !$0 { killError = nil } })) {
                Button("OK") { killError = nil }
            } message: {
                Text(killError ?? "")
            }
            .overlay {
                if killing { ProgressView("Terminating…") }
            }
        }
    }

    private func kill(_ process: DevProcess) {
        guard let node = store.nodes.first(where: { $0.machine?.id == process.machineId }) ?? store.nodes.first else { return }
        killing = true
        Task {
            defer { killing = false }
            do {
                try await node.kill(process: process)
            } catch {
                killError = error.localizedDescription
            }
            await node.refreshSnapshot()
        }
    }
}

private struct ProcessRow: View {
    let process: DevProcess
    let onKill: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            Text(verbatim: process.port.map { ":\($0)" } ?? "—")
                .font(.system(.title3, design: .monospaced, weight: .semibold))
                .frame(width: 80, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(process.name)
                    .font(.headline)
                HStack(spacing: 10) {
                    Text(process.category ?? "other").font(.caption).foregroundStyle(.secondary)
                    Text(verbatim: "PID \(process.pid)").font(.caption.monospaced()).foregroundStyle(.secondary)
                    if let cwd = process.cwd {
                        Text(cwd).font(.caption).foregroundStyle(.tertiary).lineLimit(1).truncationMode(.head)
                    }
                }
            }
            Spacer()
            if process.killable {
                Button("Kill", role: .destructive, action: onKill)
                    .buttonStyle(.bordered)
            } else {
                Text("protected")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 6)
    }
}
