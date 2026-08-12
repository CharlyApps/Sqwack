import SwiftUI

struct HermesView: View {
    @Environment(SqwackStore.self) private var store
    @State private var selectedMachine = "all"

    private var nodes: [NodeConnection] {
        let available = store.hermesNodes
        guard selectedMachine != "all", available.contains(where: { $0.machine?.id == selectedMachine }) else { return available }
        return available.filter { $0.machine?.id == selectedMachine }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 14) {
                    ProviderBadge(provider: "hermes", size: 46)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Hermes Gateways")
                            .font(.title2.bold())
                        Text("Local gateway health and scheduled jobs")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if store.hermesNodes.count > 1 { machinePicker }
                }

                ForEach(nodes, id: \.credentialRef) { node in
                    VStack(alignment: .leading, spacing: 12) {
                        Label(node.machine?.name ?? node.endpoint.host() ?? "Mac", systemImage: "desktopcomputer")
                            .font(.headline)
                            .foregroundStyle(.secondary)
                        ForEach(node.hermes?.gateways ?? []) { gateway in
                            HermesGatewayPanel(gateway: gateway)
                        }
                    }
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 18)
        }
        .refreshable { await store.refreshAll() }
    }

    private var machinePicker: some View {
        Picker("Machine", selection: $selectedMachine) {
            Text("All Macs").tag("all")
            ForEach(store.hermesNodes, id: \.credentialRef) { node in
                if let id = node.machine?.id {
                    Text(node.machine?.name ?? "Mac").tag(id)
                }
            }
        }
        .pickerStyle(.menu)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Capsule().fill(Color.consolePanelRaised))
        .overlay(Capsule().strokeBorder(Color.consoleStroke))
    }
}

private struct HermesGatewayPanel: View {
    let gateway: HermesGateway

    var body: some View {
        Panel(title: gateway.profile, badge: gateway.running ? "Running" : "Stopped", trailing: "\(gateway.cronJobs.count) cron jobs") {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 18) {
                    Label("\(gateway.activeAgents) active", systemImage: "bolt.fill")
                        .foregroundStyle(gateway.activeAgents > 0 ? .mint : .secondary)
                    Text(gateway.state.replacingOccurrences(of: "_", with: " ").capitalized)
                        .foregroundStyle(gateway.running ? .green : .secondary)
                    ForEach(gateway.platforms) { platform in
                        HStack(spacing: 5) {
                            Circle()
                                .fill(platform.state == "connected" || platform.state == "running" ? .green : .secondary)
                                .frame(width: 7, height: 7)
                            Text("\(platform.name.capitalized) · \(platform.state.capitalized)")
                        }
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(Color.consolePanelRaised))
                    }
                    Spacer()
                }
                .font(.subheadline)

                if gateway.cronJobs.isEmpty {
                    Text("No cron jobs in this profile")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 8)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(gateway.cronJobs.enumerated()), id: \.element.id) { index, job in
                            HermesCronRow(job: job)
                            if index < gateway.cronJobs.count - 1 { Divider().opacity(0.5) }
                        }
                    }
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.consolePanelRaised))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.consoleStroke))
                }
            }
        }
    }
}

private struct HermesCronRow: View {
    let job: HermesCronJob

    private var status: String {
        if !job.enabled { return "Paused" }
        if job.state == "completed" { return "Completed" }
        if job.lastStatus == "error" || job.errorKind != nil { return "Error" }
        return job.lastStatus == "ok" ? "Healthy" : "Scheduled"
    }

    private var statusColor: Color {
        switch status {
        case "Error": .red
        case "Healthy", "Completed": .green
        case "Paused": .secondary
        default: .blue
        }
    }

    var body: some View {
        HStack(spacing: 14) {
            Circle().fill(statusColor).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 4) {
                Text(job.name).font(.headline)
                HStack(spacing: 12) {
                    Label(job.schedule, systemImage: "calendar.badge.clock")
                    if let delivery = job.delivery {
                        Label(delivery.capitalized, systemImage: "paperplane")
                    }
                    if let error = job.errorKind {
                        Label(error.replacingOccurrences(of: "_", with: " ").capitalized, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(status)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(statusColor)
                if let next = job.nextRunAt {
                    Text("Next \(next.formatted(.dateTime.month().day().hour().minute()))")
                } else if let last = job.lastRunAt {
                    Text("Last \(last.formatted(.dateTime.month().day().hour().minute()))")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
    }
}
