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
    @State private var showTranscript = false

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
            Image(systemName: "chevron.right")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color(.secondarySystemBackground)))
        .contentShape(RoundedRectangle(cornerRadius: 18))
        .onTapGesture { showTranscript = true }
        .sheet(isPresented: $showTranscript) {
            TranscriptView(session: session)
                .environment(store)
        }
    }
}

/// Read-only conversation viewer. The daemon streams the provider's own
/// transcript files on demand — nothing is stored in Sqwack.
struct TranscriptView: View {
    @Environment(SqwackStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let session: AgentSession
    @State private var transcript: Transcript?
    @State private var loading = true

    private var node: NodeConnection? {
        store.nodes.first { $0.machine?.id == session.machineId } ?? store.nodes.first
    }

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView("Loading conversation…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let transcript, transcript.available {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 14) {
                                ForEach(transcript.messages) { message in
                                    MessageBubble(message: message)
                                }
                                Color.clear.frame(height: 1).id("bottom")
                            }
                            .padding(20)
                        }
                        .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
                    }
                } else {
                    ContentUnavailableView(
                        "No transcript available",
                        systemImage: "text.bubble",
                        description: Text("This provider's session file could not be found on the Mac (short-lived or non-interactive sessions may not keep one).")
                    )
                }
            }
            .navigationTitle("\(session.provider.capitalized) · \(session.projectName ?? session.source)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                if let source = transcript?.source {
                    ToolbarItem(placement: .bottomBar) {
                        Text(source)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .task {
                transcript = await node?.transcript(sessionId: session.id)
                loading = false
            }
        }
        .presentationDetents([.large])
    }
}

private struct MessageBubble: View {
    let message: TranscriptMessage

    private var isUser: Bool { message.role == "user" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 60) }
            VStack(alignment: .leading, spacing: 4) {
                Text(isUser ? "You" : "Agent")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(isUser ? Color.blue : Color.secondary)
                Text(message.text)
                    .font(.callout)
                    .textSelection(.enabled)
                if let ts = message.timestamp {
                    Text(ts.formatted(date: .omitted, time: .shortened))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(isUser ? Color.blue.opacity(0.18) : Color(.secondarySystemBackground))
            )
            if !isUser { Spacer(minLength: 60) }
        }
    }
}
