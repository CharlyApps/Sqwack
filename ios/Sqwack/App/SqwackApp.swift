import SwiftUI
import UIKit

@main
struct SqwackApp: App {
    @State private var store = SqwackStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .preferredColorScheme(.dark) // dark-first ambient display
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { store.connectAll() }
                }
        }
    }
}

/// Compact connection indicator pinned beside the tab selector.
struct ConnectionChip: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        let names = store.connectedMachineNames
        HStack(spacing: 7) {
            Circle()
                .fill(store.anyConnected ? .green : .red)
                .frame(width: 8, height: 8)
            Text(names.isEmpty ? "No daemon" : names.count == 1 ? names[0] : "\(names.count) Macs")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Capsule().fill(Color.consolePanelRaised))
        .overlay(Capsule().strokeBorder(Color.consoleStroke))
    }
}

struct RootView: View {
    @Environment(SqwackStore.self) private var store
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var selectedTab = ProcessInfo.processInfo.environment["SQWACK_TAB"] ?? "overview"

    var body: some View {
        if store.isPaired {
            VStack(spacing: 0) {
                AppChrome(selectedTab: $selectedTab)
                if let error = store.lastError {
                    DiagnosticBanner(message: error) {
                        store.clearError()
                    }
                    .padding(.horizontal, horizontalSizeClass == .compact ? 16 : 28)
                    .padding(.bottom, 8)
                }
                selectedView
                if horizontalSizeClass == .compact {
                    MobileTabBar(selectedTab: $selectedTab)
                } else {
                    AppFooter()
                }
            }
            .background(Color.consoleBackground)
            .onAppear { store.connectAll() }
            .onChange(of: store.hasHermes) { _, available in
                if !available && selectedTab == "hermes" { selectedTab = "overview" }
            }
            .onOpenURL { url in
                // sqwack://tab/<overview|agents|development|hermes|settings>
                if url.host() == "tab", let tab = url.pathComponents.dropFirst().first {
                    if tab != "hermes" || store.hasHermes { selectedTab = tab }
                }
            }
        } else {
            PairingView()
        }
    }

    @ViewBuilder private var selectedView: some View {
        switch selectedTab {
        case "agents": AgentsView()
        case "development": DevelopmentView()
        case "hermes" where store.hasHermes: HermesView()
        case "settings": SettingsView()
        default: OverviewView()
        }
    }
}

private struct DiagnosticBanner: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Diagnostics")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.primary)
                Text(message)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 12)
            Button {
                UIPasteboard.general.string = message
            } label: {
                Image(systemName: "doc.on.doc")
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.consolePanelRaised)
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.orange.opacity(0.35)))
        )
    }
}

private struct AppChrome: View {
    @Environment(SqwackStore.self) private var store
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Binding var selectedTab: String
    private var tabs: [(String, String)] {
        [("overview", "Overview"), ("agents", "Agents"), ("development", "Development")]
            + (store.hasHermes ? [("hermes", "Hermes")] : [])
            + [("settings", "Settings")]
    }

    private var selectedMachineName: String {
        guard let id = store.selectedMachineId else { return "All Macs" }
        return store.nodes.first { $0.machine?.id == id }?.machine?.name ?? "All Macs"
    }

    var body: some View {
        if horizontalSizeClass == .compact {
            compactChrome
        } else {
            regularChrome
        }
    }

    private var compactChrome: some View {
        HStack(spacing: 12) {
            Image("DashboardLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 36, height: 36)
            Text("SQWACK")
                .font(.title3.weight(.heavy))
            Spacer()
            ConnectionChip()
            refreshMenu
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color.consoleBackground)
    }

    private var regularChrome: some View {
        HStack {
            HStack(spacing: 10) {
                Image("DashboardLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 42, height: 42)
                Text("SQWACK")
                    .font(.title2.weight(.heavy))
            }
            .frame(width: 190, alignment: .leading)

            Spacer()

            HStack(spacing: 4) {
                ForEach(tabs, id: \.0) { id, title in
                    Button { selectedTab = id } label: {
                        Text(title)
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(selectedTab == id ? .blue : .primary)
                            .frame(minWidth: 116)
                            .padding(.vertical, 10)
                            .background(
                                Capsule()
                                    .fill(selectedTab == id ? Color.blue.opacity(0.14) : Color.clear)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(6)
            .background(Capsule().fill(.ultraThinMaterial))
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.12)))

            Spacer()
            HStack(spacing: 12) {
                Spacer()
                if store.nodes.compactMap(\.machine).count > 1 {
                    Menu {
                        Button("All Macs") { store.selectedMachineId = nil }
                        ForEach(store.nodes, id: \.credentialRef) { node in
                            if let machine = node.machine {
                                Button(machine.name) { store.selectedMachineId = machine.id }
                            }
                        }
                    } label: {
                        Label(selectedMachineName, systemImage: "desktopcomputer")
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(Color.consolePanelRaised))
                            .overlay(Capsule().strokeBorder(Color.consoleStroke))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Computer profile")
                }
                TimelineView(.periodic(from: .now, by: 60)) { timeline in
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(timeline.date, format: .dateTime.hour().minute())
                            .font(.headline.monospacedDigit())
                        Text(timeline.date, format: .dateTime.weekday(.abbreviated).day().month(.abbreviated))
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .foregroundStyle(.secondary)
                }
                refreshMenu
            }
            .frame(width: 300, alignment: .trailing)
        }
        .padding(.horizontal, 28)
        .padding(.top, 16)
        .padding(.bottom, 8)
        .background(Color.consoleBackground)
    }

    private var refreshMenu: some View {
        Menu {
            Button("Refresh Dashboard", systemImage: "arrow.clockwise") {
                Task { await store.refreshAll(machineId: store.selectedMachineId) }
            }
            Button("Refresh Agents", systemImage: "person.2") {
                Task { await store.refreshAgents(machineId: store.selectedMachineId) }
            }
            Button("Refresh Services", systemImage: "terminal") {
                Task { await store.refreshProcessesOnly(machineId: store.selectedMachineId) }
            }
            Button("Refresh Account Usage", systemImage: "chart.bar") {
                Task { await store.refreshUsage(machineId: store.selectedMachineId) }
            }
            if store.nodes.compactMap(\.machine).count > 1 {
                Divider()
                Menu("Computer", systemImage: "desktopcomputer") {
                    Button("All Macs") { store.selectedMachineId = nil }
                    ForEach(store.nodes, id: \.credentialRef) { node in
                        if let machine = node.machine {
                            Button(machine.name) { store.selectedMachineId = machine.id }
                        }
                    }
                }
            }
            Divider()
            Text(store.anyConnected ? "Connected" : "Disconnected")
        } label: {
            Image(systemName: "arrow.clockwise.circle")
                .font(.title2.weight(.medium))
                .foregroundStyle(.primary)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Color.consolePanelRaised))
                .overlay(Circle().strokeBorder(Color.consoleStrokeBright))
        }
        .buttonStyle(.plain)
    }
}

private struct MobileTabBar: View {
    @Environment(SqwackStore.self) private var store
    @Binding var selectedTab: String

    private var tabs: [(String, String, String)] {
        [("overview", "Overview", "rectangle.grid.2x2"),
         ("agents", "Agents", "person.2"),
         ("development", "Develop", "terminal")]
            + (store.hasHermes ? [("hermes", "Hermes", "bolt.horizontal")] : [])
            + [("settings", "Settings", "gearshape")]
    }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(tabs, id: \.0) { id, title, icon in
                Button { selectedTab = id } label: {
                    VStack(spacing: 3) {
                        Image(systemName: icon).font(.body.weight(.semibold))
                        Text(title).font(.caption2)
                    }
                    .foregroundStyle(selectedTab == id ? Color.blue : Color.secondary)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selectedTab == id ? .isSelected : [])
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) { Divider() }
    }
}

private struct AppFooter: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        let names = store.connectedMachineNames
        HStack {
            Label {
                HStack(spacing: 4) {
                    Text("Connected to")
                    Text(names.isEmpty ? "No daemon" : names.joined(separator: ", "))
                        .foregroundStyle(.blue)
                    if names.count > 1 {
                        Text("(\(names.count) Macs)")
                    }
                }
            } icon: {
                Image(systemName: "shield.checkered")
            }
            Spacer()
            Label("Tailscale", systemImage: "wifi")
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Circle().fill(store.anyConnected ? .green : .red).frame(width: 8, height: 8)
                Text(store.anyConnected ? "Connected" : "Disconnected")
                    .foregroundStyle(store.anyConnected ? .green : .red)
            }
            Spacer()
            Text("Daemon v\(store.daemonVersion)")
            Image(systemName: "arrow.up.right.square")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 18)
        .frame(height: 42)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.consolePanel)
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.consoleStroke))
        )
        .padding(.horizontal, 26)
        .padding(.bottom, 10)
        .background(Color.consoleBackground)
    }
}
