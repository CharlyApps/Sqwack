import SwiftUI

/// The ambient screen. One second from several feet away must answer:
/// "Does anything need me?" Four regions max: status header, agent cards,
/// services strip, attention strip.
struct OverviewView: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            VStack(alignment: .leading, spacing: 28) {
                StatusHeader()
                AgentCardsRow()
                Spacer(minLength: 0)
                HStack(alignment: .top, spacing: 32) {
                    ServicesStrip()
                    if !store.attention.isEmpty { AttentionStrip() }
                }
            }
            .padding(32)
        }
        .background(Color(.systemBackground))
    }
}

private struct StatusHeader: View {
    @Environment(SqwackStore.self) private var store

    private var subline: String {
        let working = store.sessions().filter { $0.state == .working }.count
        let services = store.processes().count
        var parts: [String] = []
        if working > 0 { parts.append("\(working) agent\(working == 1 ? "" : "s") working") }
        if services > 0 { parts.append("\(services) service\(services == 1 ? "" : "s")") }
        return parts.isEmpty ? "Nothing running" : parts.joined(separator: " · ")
    }

    private var needLine: String {
        switch store.globalStatus {
        case .attention: "Agents are waiting for you"
        case .failure: "Something failed"
        default: "Nothing needs you"
        }
    }

    var body: some View {
        let status = store.globalStatus
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 18) {
                    Circle()
                        .fill(status.color)
                        .frame(width: 28, height: 28)
                        .modifier(statusPulse(status))
                    Text(status.headline)
                        .font(.system(size: 64, weight: .heavy, design: .rounded))
                        .foregroundStyle(status == .quiet ? Color.primary : status.color)
                }
                Text(subline)
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Text(needLine)
                    .font(.title3)
                    .foregroundStyle(store.globalStatus == .attention || store.globalStatus == .failure ? status.color : Color.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                Text(Date.now, format: .dateTime.hour().minute())
                    .font(.system(size: 40, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
                if !store.anyConnected {
                    Label("Reconnecting…", systemImage: "wifi.slash")
                        .font(.callout)
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    private func statusPulse(_ status: SqwackStatus) -> some ViewModifier {
        status == .attention ? AnyModifier(AttentionPulse()) : AnyModifier(EmptyModifier())
    }
}

struct AnyModifier: ViewModifier {
    private let apply: (Content) -> AnyView
    init<M: ViewModifier>(_ modifier: M) {
        apply = { AnyView($0.modifier(modifier)) }
    }
    func body(content: Content) -> some View { apply(content) }
}

private struct AgentCardsRow: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        let sessions = store.boardSessions
        if sessions.isEmpty {
            Text("No recent agent activity")
                .font(.title3)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, minHeight: 180)
                .background(RoundedRectangle(cornerRadius: 24).fill(Color(.secondarySystemBackground)))
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 20) {
                    ForEach(sessions.prefix(6)) { session in
                        AgentCard(session: session)
                    }
                }
            }
        }
    }
}

struct AgentCard: View {
    let session: AgentSession

    private var timeLabel: String {
        switch session.state {
        case .needsInput: (session.waitingSince ?? session.updatedAt).elapsedLabel
        case .working: (session.startedAt ?? session.updatedAt).elapsedLabel
        default: session.updatedAt.agoLabel
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(session.provider.providerLabel)
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(.secondary)
            Text(session.state.label)
                .font(.system(size: 34, weight: .heavy, design: .rounded))
                .foregroundStyle(session.state.color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(session.projectName ?? session.title ?? session.source)
                .font(.title3.weight(.medium))
                .lineLimit(1)
            Text(timeLabel)
                .font(.system(.title3, design: .monospaced))
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(width: 260, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(Color(.secondarySystemBackground))
                .overlay(
                    RoundedRectangle(cornerRadius: 24)
                        .strokeBorder(session.state.color.opacity(session.state == .needsInput ? 0.9 : 0.35), lineWidth: session.state == .needsInput ? 3 : 1.5)
                )
        )
        .modifier(cardEffect)
    }

    private var cardEffect: AnyModifier {
        switch session.state {
        case .needsInput: AnyModifier(AttentionPulse())
        case .working: AnyModifier(EmptyModifier())
        default: AnyModifier(EmptyModifier())
        }
    }
}

private struct ServicesStrip: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        let processes = store.processes()
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Text("SERVICES")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Text("\(processes.count)")
                    .font(.headline)
                    .foregroundStyle(.tertiary)
            }
            if processes.isEmpty {
                Text("None running")
                    .foregroundStyle(.tertiary)
            }
            ForEach(processes.prefix(5)) { process in
                HStack(spacing: 12) {
                    Circle().fill(.green).frame(width: 10, height: 10)
                    Text(verbatim: process.port.map { ":\($0)" } ?? "—")
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(width: 64, alignment: .leading)
                    Text(process.name)
                        .font(.body.weight(.medium))
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct AttentionStrip: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Text("ATTENTION")
                    .font(.headline)
                    .foregroundStyle(Color.amber)
                Text("\(store.attention.count)")
                    .font(.headline)
                    .foregroundStyle(.tertiary)
            }
            ForEach(store.attention.prefix(3)) { session in
                HStack(spacing: 12) {
                    Image(systemName: session.state == .failed ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(session.state.color)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(session.provider.capitalized) · \(session.projectName ?? session.source)")
                            .font(.body.weight(.semibold))
                        Text(session.summary ?? (session.state == .failed ? "Failed" : "Waiting for input"))
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
