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
        .background(Capsule().fill(.ultraThinMaterial))
        .padding(.trailing, 16)
        .padding(.top, 4)
    }
}

struct RootView: View {
    @Environment(SqwackStore.self) private var store
    @State private var selectedTab = ProcessInfo.processInfo.environment["SQWACK_TAB"] ?? "overview"

    var body: some View {
        if store.isPaired {
            TabView(selection: $selectedTab) {
                Tab("Overview", systemImage: "circle.grid.2x2.fill", value: "overview") { OverviewView() }
                Tab("Agents", systemImage: "brain", value: "agents") { AgentsView() }
                Tab("Development", systemImage: "terminal", value: "development") { DevelopmentView() }
                Tab("Settings", systemImage: "gearshape", value: "settings") { SettingsView() }
            }
            .onAppear { store.connectAll() }
            .onOpenURL { url in
                // sqwack://tab/<overview|agents|development|settings>
                if url.host() == "tab", let tab = url.pathComponents.dropFirst().first {
                    selectedTab = tab
                }
            }
            .overlay(alignment: .topTrailing) { ConnectionChip() }
        } else {
            PairingView()
        }
    }
}
