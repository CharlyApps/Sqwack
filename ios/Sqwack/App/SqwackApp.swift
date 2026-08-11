import SwiftUI

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
        HStack(spacing: 7) {
            Circle()
                .fill(store.anyConnected ? .green : .red)
                .frame(width: 8, height: 8)
            Text(store.machineName.isEmpty ? "No daemon" : store.machineName)
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
    @State private var selectedTab = ProcessInfo.processInfo.environment["SQWACK_TAB"] ?? "overview"

    var body: some View {
        if store.isPaired {
            VStack(spacing: 0) {
                AppChrome(selectedTab: $selectedTab)
                selectedView
                AppFooter()
            }
            .background(Color.consoleBackground)
            .onAppear { store.connectAll() }
            .task {
                while !Task.isCancelled {
                    await store.refreshProcesses()
                    try? await Task.sleep(for: .seconds(8))
                }
            }
            .onOpenURL { url in
                // sqwack://tab/<overview|agents|development|settings>
                if url.host() == "tab", let tab = url.pathComponents.dropFirst().first {
                    selectedTab = tab
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
        case "settings": SettingsView()
        default: OverviewView()
        }
    }
}

private struct AppChrome: View {
    @Environment(SqwackStore.self) private var store
    @Binding var selectedTab: String
    private let tabs = [("overview", "Overview"), ("agents", "Agents"), ("development", "Development"), ("settings", "Settings")]

    var body: some View {
        HStack {
            HStack(spacing: 10) {
                Image("DashboardLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 42, height: 42)
                Text("SQWACK")
                    .font(.title2.weight(.heavy))
            }
            .frame(width: 220, alignment: .leading)

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
            HStack {
                Spacer()
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
                Menu {
                    ConnectionChip()
                    Divider()
                    Text(store.anyConnected ? "Connected" : "Disconnected")
                } label: {
                    Image(systemName: "list.bullet.circle")
                        .font(.title2.weight(.medium))
                        .foregroundStyle(.primary)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(Color.consolePanelRaised))
                        .overlay(Circle().strokeBorder(Color.consoleStrokeBright))
                }
                .buttonStyle(.plain)
            }
            .frame(width: 220, alignment: .trailing)
        }
        .padding(.horizontal, 28)
        .padding(.top, 16)
        .padding(.bottom, 8)
        .background(Color.consoleBackground)
    }
}

private struct AppFooter: View {
    @Environment(SqwackStore.self) private var store

    var body: some View {
        HStack {
            Label {
                HStack(spacing: 4) {
                    Text("Connected to")
                    Text(store.machineName.isEmpty ? "No daemon" : store.machineName)
                        .foregroundStyle(.blue)
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
