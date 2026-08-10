import SwiftUI

/// Detailed session list — the information-dense counterpart to Overview.
struct AgentsView: View {
    @Environment(SqwackStore.self) private var store
    @State private var stateFilter: AgentState?

    private var filtered: [AgentSession] {
        store.sessions().filter { stateFilter == nil || $0.state == stateFilter }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(filtered) { session in
                    SessionRow(session: session)
                        .swipeActions(edge: .trailing) {
                            if session.state == .needsInput || session.state == .failed {
                                Button("Acknowledge") {
                                    Task {
                                        for node in store.nodes where node.machine?.id == session.machineId {
                                            await node.acknowledge(session: session.id)
                                        }
                                    }
                                }
                                .tint(.blue)
                            }
                        }
                }
                if filtered.isEmpty {
                    Text("No sessions" + (stateFilter.map { " in state \($0.rawValue)" } ?? ""))
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Agents")
            .toolbar {
                Menu {
                    Button("All states") { stateFilter = nil }
                    ForEach(AgentState.allCases.filter { $0 != .unknown }, id: \.self) { state in
                        Button(state.label.capitalized) { stateFilter = state }
                    }
                } label: {
                    Label(stateFilter?.label.capitalized ?? "Filter", systemImage: "line.3.horizontal.decrease.circle")
                }
            }
        }
    }
}

private struct SessionRow: View {
    @Environment(SqwackStore.self) private var store
    let session: AgentSession

    private var machineName: String {
        store.nodes.first { $0.machine?.id == session.machineId }?.machine?.name ?? session.machineId
    }

    var body: some View {
        HStack(spacing: 16) {
            Circle()
                .fill(session.state.color)
                .frame(width: 14, height: 14)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(session.provider.capitalized)
                        .font(.headline)
                    Text(session.projectName ?? session.cwd ?? "")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let summary = session.summary {
                    Text(summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                HStack(spacing: 12) {
                    Text(session.state.label)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(session.state.color)
                    if let started = session.startedAt, session.state == .working {
                        Text("running \(started.elapsedLabel)").font(.caption).foregroundStyle(.tertiary)
                    }
                    Text("updated \(session.updatedAt.agoLabel)").font(.caption).foregroundStyle(.tertiary)
                    Text(machineName).font(.caption).foregroundStyle(.tertiary)
                    Text(session.source).font(.caption).foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
