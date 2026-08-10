import SwiftUI

/// The ambient screen. One second from several feet away must answer:
/// "Does anything need me?" Status header dominates; agent cards carry the
/// detail; Services / System / Activity sit in a calm bottom band.
struct OverviewView: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    BrandHeader()
                    StatusHeader()
                    AgentCardsRow()
                    HStack(alignment: .top, spacing: 20) {
                        ServicesPanel()
                        SystemPanel()
                        ActivityPanel()
                    }
                    if !store.usage.isEmpty { AccountUsageBand() }
                    FooterBar()
                }
                .padding(28)
            }
        }
        .background(Color(.systemBackground))
    }
}

private struct BrandHeader: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "waveform.path.ecg")
                .font(.title2.weight(.bold))
                .foregroundStyle(.blue)
            Text("SQWACK")
                .font(.system(.title3, design: .rounded, weight: .heavy))
                .kerning(1)
            Spacer()
        }
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
        default: "Nothing needs you right now."
        }
    }

    var body: some View {
        let status = store.globalStatus
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 16) {
                    Circle()
                        .fill(status.color)
                        .frame(width: 24, height: 24)
                        .modifier(status == .attention ? AnyModifier(AttentionPulse()) : AnyModifier(EmptyModifier()))
                    Text(status.headline)
                        .font(.system(size: 56, weight: .heavy, design: .rounded))
                        .foregroundStyle(status == .quiet ? Color.primary : status.color)
                }
                Text(subline)
                    .font(.title3)
                    .foregroundStyle(.secondary)
                Text(needLine)
                    .font(.body)
                    .foregroundStyle(status == .attention || status == .failure ? status.color : Color.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(Date.now, format: .dateTime.hour().minute())
                    .font(.system(size: 38, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
                Text(Date.now, format: .dateTime.weekday(.abbreviated).day().month(.abbreviated))
                    .font(.title3)
                    .foregroundStyle(.tertiary)
                if !store.anyConnected {
                    Label("Reconnecting…", systemImage: "wifi.slash")
                        .font(.callout)
                        .foregroundStyle(.orange)
                }
            }
        }
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
                .frame(maxWidth: .infinity, minHeight: 160)
                .background(RoundedRectangle(cornerRadius: 20).fill(Color(.secondarySystemBackground)))
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 16) {
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
        case .needsInput: "Waiting " + (session.waitingSince ?? session.updatedAt).elapsedLabel
        case .working: "Running " + (session.startedAt ?? session.updatedAt).elapsedLabel
        default: session.updatedAt.agoLabel.sentenceCased
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ProviderBadge(provider: session.provider)
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.provider.providerLabel)
                        .font(.system(.headline, design: .rounded, weight: .bold))
                    Text(session.projectName ?? session.title ?? session.source)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            HStack(spacing: 8) {
                Circle().fill(session.state.color).frame(width: 9, height: 9)
                Text(session.state.label)
                    .font(.system(.title3, design: .rounded, weight: .heavy))
                    .foregroundStyle(session.state.color)
            }
            Text(timeLabel)
                .font(.callout.monospacedDigit())
                .foregroundStyle(.secondary)
            Sparkline(
                values: (session.activity ?? []).map(Double.init),
                color: session.state.color
            )
            .frame(height: 28)
        }
        .padding(18)
        .frame(width: 250, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color(.secondarySystemBackground))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .strokeBorder(session.state.color.opacity(session.state == .needsInput ? 0.9 : 0.3), lineWidth: session.state == .needsInput ? 2.5 : 1)
                )
        )
        .modifier(session.state == .needsInput ? AnyModifier(AttentionPulse()) : AnyModifier(EmptyModifier()))
    }
}

private struct AccountUsageBand: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        Panel(title: "ACCOUNT USAGE") {
            HStack(alignment: .top, spacing: 16) {
                ForEach(store.usage) { usage in
                    UsageCard(usage: usage)
                }
            }
        }
    }
}

private struct UsageCard: View {
    let usage: ProviderUsage

    /// The window that should dominate the card: the shortest (most urgent).
    private var primary: UsageWindow? {
        usage.windows.min { a, b in a.label < b.label } // "5h" sorts before "week"
    }

    private var barColor: Color {
        guard let p = primary else { return .green }
        return p.usedPercent >= 90 ? .red : p.usedPercent >= 70 ? .amber : .blue
    }

    private func resetText(_ window: UsageWindow) -> String {
        guard let resets = window.resetsAt else { return "" }
        let hours = Int(resets.timeIntervalSinceNow / 3600)
        let when = resets.formatted(date: .abbreviated, time: .omitted)
        if hours <= 0 { return "Resets soon" }
        if hours < 24 { return "Resets in \(hours)h" }
        return "Resets in \(hours / 24) days · \(when)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ProviderBadge(provider: usage.provider, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text(usage.provider.capitalized).font(.headline)
                    if let plan = usage.planType {
                        Text(plan.capitalized).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if let primary {
                Text(verbatim: "\(Int(primary.usedPercent))%")
                    .font(.system(.title, design: .rounded, weight: .heavy))
                Text(usage.windows.map { "\($0.label) \(Int($0.usedPercent))%" }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                MeterBar(fraction: primary.usedPercent / 100, color: barColor)
                Text(resetText(primary))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(.tertiarySystemBackground)))
    }
}

private struct FooterBar: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.shield")
                .foregroundStyle(store.anyConnected ? .green : .orange)
            Text("Connected to ").foregroundStyle(.secondary)
                + Text(store.machineName).foregroundStyle(.blue)
            Spacer()
            Circle().fill(store.anyConnected ? .green : .red).frame(width: 8, height: 8)
            Text(store.anyConnected ? "Connected" : "Disconnected")
                .foregroundStyle(store.anyConnected ? .green : .red)
            Spacer()
            Text("Daemon v" + (store.nodes.first?.machine?.daemonVersion ?? "—"))
                .foregroundStyle(.secondary)
        }
        .font(.callout)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color(.secondarySystemBackground)))
    }
}

struct UsageMeter: View {
    let window: UsageWindow

    private var barColor: Color {
        window.usedPercent >= 90 ? .red : window.usedPercent >= 70 ? .amber : .green
    }

    private var resetLabel: String? {
        guard let resets = window.resetsAt else { return nil }
        let hours = Int(resets.timeIntervalSinceNow / 3600)
        if hours <= 0 { return "resets soon" }
        if hours < 24 { return "resets \(hours)h" }
        return "resets \(hours / 24)d"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(window.label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(verbatim: "\(Int(window.usedPercent))%")
                    .font(.caption.monospacedDigit().weight(.bold))
                if let resetLabel {
                    Text(resetLabel)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            MeterBar(fraction: window.usedPercent / 100, color: barColor)
                .frame(width: 110)
        }
    }
}

// MARK: - Bottom band

private struct ServicesPanel: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        let processes = store.processes()
        Panel(title: "SERVICES", badge: "\(processes.count)") {
            if processes.isEmpty {
                Text("None running").foregroundStyle(.tertiary)
            }
            ForEach(processes.prefix(4)) { process in
                HStack(spacing: 12) {
                    Circle().fill(.green).frame(width: 9, height: 9)
                    Text(verbatim: process.port.map { ":\($0)" } ?? "—")
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(width: 62, alignment: .leading)
                    Text(process.name)
                        .font(.body.weight(.medium))
                        .lineLimit(1)
                    Spacer()
                    Text(process.category ?? "")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                if process.id != processes.prefix(4).last?.id { Divider() }
            }
        }
    }
}

private struct SystemPanel: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        Panel(title: "SYSTEM") {
            if let system = store.system {
                HStack(spacing: 12) {
                    StatTile(label: "CPU", value: "\(Int(system.stats.cpuPercent))", suffix: "%",
                             fraction: system.stats.cpuPercent / 100, color: .blue, history: system.history.cpu)
                    StatTile(label: "RAM", value: Format.bytes(system.stats.ramUsedBytes).replacingOccurrences(of: " GB", with: ""), suffix: " GB",
                             detail: "of \(Format.bytes(system.stats.ramTotalBytes))",
                             fraction: Double(system.stats.ramUsedBytes) / Double(system.stats.ramTotalBytes), color: .purple, history: system.history.ram)
                    StatTile(label: "UPTIME", value: Format.uptime(system.stats.uptimeSeconds), suffix: "",
                             color: .purple, history: system.history.network)
                }
                HStack(spacing: 8) {
                    Image(systemName: "desktopcomputer").font(.caption)
                    Text(store.machineName).font(.caption)
                    Spacer()
                    Text(store.machineInfo).font(.caption)
                }
                .foregroundStyle(.tertiary)
                .padding(.top, 4)
            } else {
                Text("Waiting for system stats…").foregroundStyle(.tertiary)
            }
        }
    }
}

private struct StatTile: View {
    let label: String
    let value: String
    let suffix: String
    var detail: String?
    var fraction: Double?
    var color: Color = .blue
    var history: [Double] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            (Text(value).font(.system(.title2, design: .rounded, weight: .bold))
                + Text(suffix).font(.callout.weight(.semibold)).foregroundStyle(.secondary))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let detail {
                Text(detail).font(.caption2).foregroundStyle(.tertiary)
            }
            if let fraction {
                MeterBar(fraction: fraction, color: color, height: 5)
            }
            Sparkline(values: history, color: color)
                .frame(height: 18)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(.tertiarySystemBackground)))
    }
}

private struct ActivityPanel: View {
    @Environment(SqwackStore.self) private var store

    private func dotColor(_ severity: String) -> Color {
        switch severity {
        case "success": .green
        case "warning": .amber
        case "error": .red
        default: .blue
        }
    }

    var body: some View {
        Panel(title: "ACTIVITY") {
            if store.activity.isEmpty {
                Text("No recent activity").foregroundStyle(.tertiary)
            }
            ForEach(store.activity.prefix(5)) { item in
                HStack(spacing: 10) {
                    Circle().fill(dotColor(item.severity)).frame(width: 8, height: 8)
                    Text(item.message)
                        .font(.subheadline)
                        .lineLimit(1)
                    Spacer()
                    Text(item.timestamp.agoLabel)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                if item.id != store.activity.prefix(5).last?.id { Divider() }
            }
        }
    }
}
