import SwiftUI

/// Services, processes and system health — the full monitor screen.
struct DevelopmentView: View {
    @Environment(SqwackStore.self) private var store
    @State private var confirmKill: DevProcess?
    @State private var killError: String?
    @State private var killing = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Development").font(.largeTitle.weight(.bold))
                            Text("Services, processes and system health")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        ServicesTable(now: timeline.date, onKill: { confirmKill = $0 })

                        HStack(alignment: .top, spacing: 20) {
                            ResourcePanel()
                            RecentOutputPanel()
                            SystemHealthPanel()
                        }

                        TopProcessesPanel()
                    }
                    .padding(24)
                }
                .background(Color.consoleBackground)
                .toolbar(.hidden, for: .navigationBar)
                .refreshable {
                    await store.refreshProcesses()
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
            await node.refreshProcesses()
        }
    }
}

// MARK: - Services table

private struct ServicesTable: View {
    @Environment(SqwackStore.self) private var store
    let now: Date
    let onKill: (DevProcess) -> Void

    var body: some View {
        let processes = store.processes()
        Panel(title: "SERVICES", badge: "\(processes.count) running") {
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 12) {
                GridRow {
                    ForEach(["PORT", "NAME", "TYPE", "PID", "PATH", "STATUS", "UPTIME", "CPU", "MEMORY", "ACTIONS"], id: \.self) { header in
                        Text(header).font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                }
                Divider().gridCellColumns(10)
                ForEach(processes) { process in
                    GridRow {
                        HStack(spacing: 8) {
                            Circle().fill(.green).frame(width: 8, height: 8)
                            Text(verbatim: process.port.map { ":\($0)" } ?? "—")
                                .font(.system(.body, design: .monospaced, weight: .semibold))
                        }
                        Text(process.name).font(.body.weight(.medium)).lineLimit(1)
                        Text(process.category ?? "other")
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Capsule().fill(Color.white.opacity(0.07)))
                            .foregroundStyle(.secondary)
                        Text(verbatim: "\(process.pid)").font(.body.monospacedDigit()).foregroundStyle(.secondary)
                        Text(process.cwd ?? "—")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                            .truncationMode(.head)
                            .frame(maxWidth: 260, alignment: .leading)
                        Text("Running")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 9).padding(.vertical, 3)
                            .background(Capsule().strokeBorder(.green.opacity(0.6)))
                            .foregroundStyle(.green)
                        Text(process.startedAt.map { Format.uptime(Int(now.timeIntervalSince($0))) } ?? "—")
                            .font(.body.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .fixedSize()
                        HStack(spacing: 6) {
                            Text(verbatim: process.cpuPercent.map { String(format: "%.1f%%", $0) } ?? "—")
                                .font(.body.monospacedDigit())
                                .fixedSize()
                            Sparkline(values: process.cpuHistory ?? [], color: .blue)
                                .frame(width: 56, height: 18)
                        }
                        Text(process.memoryBytes.map { Format.bytes($0) } ?? "—")
                            .font(.body.monospacedDigit())
                            .foregroundStyle(.secondary)
                        ProcessActions(process: process, onKill: onKill)
                    }
                }
                if processes.isEmpty {
                    GridRow {
                        Text("No development services detected")
                            .foregroundStyle(.secondary)
                            .gridCellColumns(10)
                    }
                }
            }
        }
    }
}

private struct ProcessActions: View {
    let process: DevProcess
    let onKill: (DevProcess) -> Void

    var body: some View {
        Menu {
            if process.killable {
                Button("Kill", systemImage: "xmark.octagon", role: .destructive) {
                    onKill(process)
                }
            } else {
                Text("Protected")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.title3)
                .frame(width: 32, height: 28)
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .help("Process actions")
    }
}

// MARK: - Panels

private struct ResourcePanel: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        Panel(title: "RESOURCE USAGE") {
            if let stats = store.system?.stats {
                ResourceRow(icon: "cpu", label: "CPU",
                            value: "\(Int(stats.cpuPercent))%",
                            detail: "Total across the machine",
                            fraction: stats.cpuPercent / 100, color: .blue)
                ResourceRow(icon: "memorychip", label: "RAM",
                            value: "\(Format.bytes(stats.ramUsedBytes)) / \(Format.bytes(stats.ramTotalBytes))",
                            detail: "\(Int(100 * Double(stats.ramUsedBytes) / Double(stats.ramTotalBytes)))% used",
                            fraction: Double(stats.ramUsedBytes) / Double(stats.ramTotalBytes), color: .purple)
                ResourceRow(icon: "internaldrive", label: "DISK",
                            value: "\(Int(100 * Double(stats.diskUsedBytes) / Double(stats.diskTotalBytes)))%",
                            detail: "\(Format.bytes(stats.diskUsedBytes)) of \(Format.bytes(stats.diskTotalBytes)) used",
                            fraction: Double(stats.diskUsedBytes) / Double(stats.diskTotalBytes), color: .orange)
            } else {
                Text("Waiting for system stats…").foregroundStyle(.tertiary)
            }
        }
    }
}

private struct ResourceRow: View {
    let icon: String
    let label: String
    let value: String
    let detail: String
    let fraction: Double
    let color: Color

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(color)
                .frame(width: 34, height: 34)
                .background(RoundedRectangle(cornerRadius: 8).fill(color.opacity(0.15)))
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(label).font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(value).font(.subheadline.weight(.bold).monospacedDigit())
                }
                MeterBar(fraction: fraction, color: color)
                Text(detail).font(.caption).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct RecentOutputPanel: View {
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
        Panel(title: "RECENT OUTPUT") {
            if store.activity.isEmpty {
                Text("No recent events").foregroundStyle(.tertiary)
            }
            ForEach(store.activity.prefix(6)) { item in
                HStack(spacing: 10) {
                    Text(verbatim: "[" + item.timestamp.formatted(date: .omitted, time: .standard) + "]")
                        .font(.caption.monospaced())
                        .foregroundStyle(.tertiary)
                    Circle().fill(dotColor(item.severity)).frame(width: 7, height: 7)
                    Text(item.message)
                        .font(.callout)
                        .foregroundStyle(dotColor(item.severity))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
            }
        }
    }
}

private struct SystemHealthPanel: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        Panel(title: "SYSTEM HEALTH") {
            if let system = store.system {
                HealthRow(icon: "waveform.path.ecg", label: "CPU Load",
                          value: "\(Int(system.stats.cpuPercent))%", history: system.history.cpu, color: .green)
                HealthRow(icon: "memorychip", label: "Memory",
                          value: "\(Format.bytes(system.stats.ramUsedBytes)) / \(Format.bytes(system.stats.ramTotalBytes))",
                          history: system.history.ram, color: .purple)
                HealthRow(icon: "internaldrive", label: "Disk",
                          value: "\(Int(100 * Double(system.stats.diskUsedBytes) / Double(system.stats.diskTotalBytes)))%",
                          history: [], color: .orange)
                HealthRow(icon: "wifi", label: "Network",
                          value: String(format: "%.0f Mbps", system.stats.networkMbps),
                          history: system.history.network, color: .blue)
                HealthRow(icon: "square.grid.3x3", label: "Processes",
                          value: "\(system.stats.processCount)", history: [], color: .gray)
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.shield")
                        .foregroundStyle(.green)
                    Text(store.globalStatus == .quiet || store.globalStatus == .working ? "All systems normal" : "Attention needed")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(store.globalStatus == .quiet || store.globalStatus == .working ? .green : .amber)
                }
                .padding(.top, 6)
            } else {
                Text("Waiting for system stats…").foregroundStyle(.tertiary)
            }
        }
    }
}

private struct HealthRow: View {
    let icon: String
    let label: String
    let value: String
    let history: [Double]
    let color: Color

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.callout).foregroundStyle(.secondary).frame(width: 22)
            Text(label).font(.callout)
            Spacer()
            Text(value).font(.callout.weight(.semibold).monospacedDigit())
            Sparkline(values: history, color: color)
                .frame(width: 90, height: 16)
        }
    }
}

private struct TopProcessesPanel: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        Panel(title: "TOP PROCESSES", badge: "By CPU") {
            HStack(spacing: 14) {
                ForEach(Array(store.topProcesses.prefix(5).enumerated()), id: \.element.id) { index, metric in
                    HStack(spacing: 10) {
                        Text(verbatim: "\(index + 1)")
                            .font(.caption.weight(.bold))
                            .frame(width: 22, height: 22)
                            .background(Circle().fill(Color.white.opacity(0.07)))
                            .foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(metric.name).font(.callout.weight(.medium)).lineLimit(1)
                            Text(verbatim: "PID \(metric.pid)").font(.caption2).foregroundStyle(.tertiary)
                        }
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(verbatim: String(format: "%.1f%%", metric.cpuPercent))
                                .font(.callout.weight(.bold).monospacedDigit())
                            Text(Format.bytes(metric.memoryBytes)).font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.consolePanelRaised))
                }
                if store.topProcesses.isEmpty {
                    Text("Waiting for process metrics…").foregroundStyle(.tertiary)
                }
            }
        }
    }
}
