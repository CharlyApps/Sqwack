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
        } else {
            PairingView()
        }
    }
}
