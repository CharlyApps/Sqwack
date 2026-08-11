import SwiftUI

struct OverviewView: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    DashboardTopStrip(now: timeline.date)
                    HStack(alignment: .top, spacing: 20) {
                        ServicesPanel()
                        SystemPanel()
                        ActivityPanel(now: timeline.date)
                    }
                    AccountUsageBand(now: timeline.date)
                }
                .padding(.horizontal, 26)
                .padding(.top, 12)
                .padding(.bottom, 12)
            }
        }
        .background(Color.consoleBackground)
    }
}

private struct DashboardTopStrip: View {
    let now: Date

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            StatusHeader(now: now)
                .frame(minWidth: 240, idealWidth: 280, maxWidth: 300, alignment: .leading)
                .layoutPriority(1)
            AgentCardsRow(now: now)
                .frame(maxWidth: .infinity)
        }
    }
}

private struct StatusHeader: View {
    @Environment(SqwackStore.self) private var store
    let now: Date

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
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                Circle()
                    .fill(status.color)
                    .frame(width: 18, height: 18)
                    .modifier(status == .attention ? AnyModifier(AttentionPulse()) : AnyModifier(EmptyModifier()))
                Text(status.headline)
                    .font(.system(size: 40, weight: .heavy, design: .rounded))
                    .foregroundStyle(status == .quiet ? Color.primary : status.color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            Text(subline)
                .font(.callout)
                .foregroundStyle(.secondary)
            Text(needLine)
                .font(.callout)
                .foregroundStyle(status == .attention || status == .failure ? status.color : Color.secondary)
            if !store.anyConnected {
                Label("Reconnecting...", systemImage: "wifi.slash")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .frame(height: 132, alignment: .center)
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
    let now: Date

    var body: some View {
        let sessions = store.boardSessions
        if sessions.isEmpty {
            Text("No recent agent activity")
                .font(.body)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, minHeight: 132)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.consolePanel)
                        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.consoleStroke))
                )
        } else {
            HStack(spacing: 12) {
                ForEach(sessions.prefix(4)) { session in
                    AgentCard(session: session, now: now)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

struct AgentCard: View {
    let session: AgentSession
    let now: Date

    private var timeLabel: String {
        switch session.state {
        case .needsInput: "Waiting " + (session.waitingSince ?? session.updatedAt).elapsedLabel(at: now)
        case .working: "Running " + (session.startedAt ?? session.updatedAt).elapsedLabel(at: now)
        default: session.updatedAt.agoLabel(at: now).sentenceCased
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                ProviderBadge(provider: session.provider, size: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.provider.providerLabel)
                        .font(.system(.subheadline, design: .rounded, weight: .bold))
                    Text(session.projectName ?? session.title ?? session.source)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            HStack(spacing: 8) {
                Circle().fill(session.state.color).frame(width: 9, height: 9)
                Text(session.state.label)
                    .font(.system(.subheadline, design: .rounded, weight: .heavy))
                    .foregroundStyle(session.state.color)
            }
            Text(timeLabel)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
            Sparkline(
                values: (session.activity ?? []).map(Double.init),
                color: session.state.color
            )
            .frame(height: 16)
        }
        .padding(14)
        .frame(minWidth: 0, maxWidth: 210, minHeight: 132, maxHeight: 132, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.consolePanel)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(session.state.color.opacity(session.state == .working ? 0.8 : 0.25), lineWidth: session.state == .working ? 1.2 : 1)
                )
        )
        .modifier(session.state == .needsInput ? AnyModifier(AttentionPulse()) : AnyModifier(EmptyModifier()))
    }
}

private struct AccountUsageBand: View {
    @Environment(SqwackStore.self) private var store
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Text("ACCOUNT USAGE")
                    .font(.headline.weight(.heavy))
                Text("Manual refresh")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                Menu {
                    Button("Refresh Account Usage", systemImage: "chart.bar") {
                        Task { await store.refreshUsage() }
                    }
                    Button("Refresh Codex Usage", systemImage: "cube.fill") {
                        Task { await store.refreshUsage(provider: "codex") }
                    }
                    Button("Refresh Claude Usage", systemImage: "sparkles") {
                        Task { await store.refreshUsage(provider: "claude") }
                    }
                    Button("Refresh DeepSeek Balance", systemImage: "creditcard") {
                        Task { await store.refreshUsage(provider: "deepseek") }
                    }
                    Button("Refresh Dashboard", systemImage: "arrow.clockwise") {
                        Task { await store.refreshAll() }
                    }
                } label: {
                    Image(systemName: "arrow.clockwise.circle")
                        .font(.title3)
                        .frame(width: 34, height: 30)
                }
                .buttonStyle(.plain)
                .help("Refresh account usage")
            }
            if store.usage.isEmpty {
                HStack {
                    Text("Refresh usage when you need it.")
                        .foregroundStyle(.tertiary)
                    Spacer()
                }
                .frame(minHeight: 86)
            } else {
                HStack(alignment: .top, spacing: 0) {
                    ForEach(Array(store.usage.enumerated()), id: \.element.id) { index, usage in
                        UsageColumn(usage: usage, now: now)
                            .frame(maxWidth: .infinity)
                        if index < store.usage.count - 1 {
                            Rectangle()
                                .fill(Color.consoleStroke)
                                .frame(width: 1)
                                .padding(.horizontal, 24)
                        }
                    }
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.consolePanel)
                .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.consoleStroke))
        )
    }
}

private struct UsageColumn: View {
    let usage: ProviderUsage
    let now: Date

    /// The window that should dominate the card: the shortest (most urgent).
    private var primary: UsageWindow? {
        usage.windows.min { a, b in a.label < b.label } // "5h" sorts before "week"
    }

    private var barColor: Color {
        guard let p = primary else { return .green }
        return p.usedPercent >= 90 ? .red : p.usedPercent >= 70 ? .amber : .blue
    }

    private var displayName: String {
        switch usage.provider.lowercased() {
        case "codex": "Codex"
        case "claude": "Claude"
        case "deepseek": "DeepSeek"
        default: usage.provider.capitalized
        }
    }

    private var planLabel: String? {
        switch usage.provider.lowercased() {
        case "codex": usage.planType?.lowercased() == "chatgpt" ? nil : usage.planType?.uppercased()
        case "claude": nil
        case "deepseek": "API"
        default: usage.planType?.uppercased()
        }
    }

    private var isBalanceStyle: Bool {
        usage.provider.lowercased() == "deepseek" || primary?.detail?.contains("$") == true
    }

    private var metricText: String {
        guard let primary else { return "--" }
        if isBalanceStyle, let detail = primary.detail {
            return detail.split(separator: "(").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? detail
        }
        return "\(Int(primary.usedPercent))%"
    }

    private var detailText: String {
        if isBalanceStyle { return primary?.detail ?? usage.source }
        return usage.windows.map { "\($0.label) \(Int($0.usedPercent))%" }.joined(separator: " / ")
    }

    private func resetText(_ window: UsageWindow) -> String {
        guard let resets = window.resetsAt else { return "" }
        let when = resets.formatted(date: .abbreviated, time: .shortened)
        return "Resets \(when) · \(now.preciseRemainingLabel(until: resets))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                ProviderBadge(provider: usage.provider, size: 28)
                Text(displayName)
                    .font(.headline.weight(.semibold))
                if let planLabel {
                    Text(planLabel)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.purple.opacity(0.95))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(.purple.opacity(0.18)))
                }
                Spacer()
                Text("Cached · \(usage.collectedAt.agoLabel(at: now))")
                    .font(.caption)
                    .foregroundStyle(now.timeIntervalSince(usage.collectedAt) > 15 * 60 ? Color.orange : Color.secondary)
            }
            if let primary {
                HStack(alignment: .firstTextBaseline) {
                    Text(verbatim: metricText)
                        .font(.system(size: 26, weight: .heavy, design: .rounded))
                    Spacer()
                    Text(detailText)
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                if !isBalanceStyle {
                    MeterBar(fraction: primary.usedPercent / 100, color: barColor)
                        .frame(height: 5)
                    HStack(spacing: 7) {
                        Image(systemName: "clock")
                            .font(.caption)
                        Text(resetText(primary).isEmpty ? primary.label : resetText(primary))
                            .font(.caption)
                        Spacer()
                        Text(primary.label)
                            .font(.caption)
                    }
                    .foregroundStyle(.tertiary)
                }
            } else {
                Text("No usage windows")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
                    .frame(minHeight: 74, alignment: .leading)
            }
        }
    }
}

private struct UsageCard: View {
    @Environment(SqwackStore.self) private var store
    let usage: ProviderUsage
    let now: Date

    private var primary: UsageWindow? {
        usage.windows.min { a, b in a.label < b.label }
    }

    private var barColor: Color {
        guard let p = primary else { return .green }
        return p.usedPercent >= 90 ? .red : p.usedPercent >= 70 ? .amber : .blue
    }

    private var displayName: String {
        switch usage.provider.lowercased() {
        case "codex": "Codex"
        case "claude": "Claude"
        case "deepseek": "DeepSeek"
        default: usage.provider.capitalized
        }
    }

    private var planLabel: String? {
        switch usage.provider.lowercased() {
        case "codex": usage.planType?.lowercased() == "chatgpt" ? nil : usage.planType?.uppercased()
        case "claude": nil
        case "deepseek": "API"
        default: usage.planType?.uppercased()
        }
    }

    private var isBalanceStyle: Bool {
        usage.provider.lowercased() == "deepseek" || primary?.detail?.contains("$") == true
    }

    private var metricText: String {
        guard let primary else { return "--" }
        if isBalanceStyle, let detail = primary.detail {
            return detail.split(separator: "(").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? detail
        }
        return "\(Int(primary.usedPercent))%"
    }

    private func resetText(_ window: UsageWindow) -> String {
        guard let resets = window.resetsAt else { return "" }
        let when = resets.formatted(date: .abbreviated, time: .shortened)
        return "Resets \(when) · \(now.preciseRemainingLabel(until: resets))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ProviderBadge(provider: usage.provider, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text(displayName).font(.headline)
                    if let plan = planLabel {
                        Text(plan).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button {
                    Task { await store.refreshUsage(provider: usage.provider) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("Refresh \(usage.provider.capitalized) usage")
            }
            if let primary {
                Text(verbatim: metricText)
                    .font(.system(.title, design: .rounded, weight: .heavy))
                Text(isBalanceStyle ? primary.detail ?? usage.source : usage.windows.map { "\($0.label) \(Int($0.usedPercent))%" }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if !isBalanceStyle {
                    MeterBar(fraction: primary.usedPercent / 100, color: barColor)
                    Text(resetText(primary))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.consolePanelRaised))
    }
}


struct UsageMeter: View {
    let window: UsageWindow

    private var barColor: Color {
        window.usedPercent >= 90 ? .red : window.usedPercent >= 70 ? .amber : .green
    }

    private var resetLabel: String? {
        guard let resets = window.resetsAt else { return nil }
        return "resets \(Date().preciseRemainingLabel(until: resets))"
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
    let now: Date

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
            ForEach(store.activity.prefix(4)) { item in
                HStack(spacing: 10) {
                    Circle().fill(dotColor(item.severity)).frame(width: 8, height: 8)
                    Text(item.message)
                        .font(.subheadline)
                        .lineLimit(1)
                    Spacer()
                    Text(item.timestamp.agoLabel(at: now))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                if item.id != store.activity.prefix(4).last?.id { Divider() }
            }
        }
    }
}
