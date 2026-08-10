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
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Agents").font(.largeTitle.weight(.bold))
                            Text("All agent sessions and activity")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Menu {
                            Button("All Agents") { stateFilter = nil }
                            ForEach(AgentState.allCases.filter { $0 != .unknown }, id: \.self) { state in
                                Button(state.shortLabel) { stateFilter = state }
                            }
                        } label: {
                            HStack(spacing: 6) {
                                Text(stateFilter?.shortLabel ?? "All Agents")
                                Image(systemName: "chevron.down").font(.caption)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(Color(.secondarySystemBackground)))
                        }
                    }
                    .padding(.bottom, 8)

                    ForEach(filtered) { session in
                        SessionRow(session: session)
                    }
                    if filtered.isEmpty {
                        Text("No sessions" + (stateFilter.map { " in state \($0.rawValue)" } ?? ""))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, minHeight: 120)
                    }

                    Text("Showing \(filtered.count) of \(store.sessions().count) agents")
                        .font(.subheadline)
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                }
                .padding(24)
            }
            .background(Color(.systemBackground))
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

private struct SessionRow: View {
    @Environment(SqwackStore.self) private var store
    let session: AgentSession
    @State private var showAck = false

    private var machineName: String {
        store.nodes.first { $0.machine?.id == session.machineId }?.machine?.name ?? session.machineId
    }

    private var timeDetail: String {
        switch session.state {
        case .working: "Running " + (session.startedAt ?? session.updatedAt).elapsedLabel
        case .needsInput: "Waiting " + (session.waitingSince ?? session.updatedAt).elapsedLabel
        default: session.updatedAt.agoLabel.sentenceCased
        }
    }

    var body: some View {
        HStack(spacing: 16) {
            ProviderBadge(provider: session.provider, size: 52)
            VStack(alignment: .leading, spacing: 3) {
                Text(session.provider.capitalized).font(.headline)
                Text(session.projectName ?? session.cwd ?? session.source)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(width: 170, alignment: .leading)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Circle().fill(session.state.color).frame(width: 8, height: 8)
                    Text(session.state.label)
                        .font(.subheadline.weight(.heavy))
                        .foregroundStyle(session.state.color)
                    Text(timeDetail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let summary = session.summary {
                    Text(summary)
                        .font(.body)
                        .lineLimit(1)
                }
                HStack(spacing: 8) {
                    Chip(icon: "desktopcomputer", text: machineName)
                    Chip(icon: "terminal", text: session.source)
                }
            }
            Spacer()
            Sparkline(values: (session.activity ?? []).map(Double.init), color: session.state.color)
                .frame(width: 180, height: 34)
            if session.state == .needsInput || session.state == .failed {
                Button {
                    Task {
                        for node in store.nodes where node.machine?.id == session.machineId {
                            await node.acknowledge(session: session.id)
                        }
                    }
                } label: {
                    Image(systemName: "checkmark.circle")
                        .font(.title3)
                }
                .buttonStyle(.borderless)
                .help("Acknowledge")
            }
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color(.secondarySystemBackground)))
    }
}
