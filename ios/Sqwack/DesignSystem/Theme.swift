import SwiftUI

// Visual language (dark-first): blue=working, amber=needs input, green=done,
// red=failed, gray=idle. Calm by default; only needs_input pulses.

extension AgentState {
    var color: Color {
        switch self {
        case .working: .blue
        case .needsInput: .amber
        case .done: .green
        case .failed: .red
        case .idle, .unknown: .gray
        }
    }

    var label: String {
        switch self {
        case .working: "WORKING"
        case .needsInput: "NEEDS YOU"
        case .done: "DONE"
        case .failed: "FAILED"
        case .idle: "IDLE"
        case .unknown: "UNKNOWN"
        }
    }
}

extension SqwackStatus {
    var color: Color {
        switch self {
        case .quiet: .green
        case .working: .blue
        case .attention: .amber
        case .failure: .red
        }
    }

    var headline: String {
        switch self {
        case .quiet: "ALL QUIET"
        case .working: "WORKING"
        case .attention: "NEEDS YOU"
        case .failure: "FAILURE"
        }
    }
}

extension Color {
    static let amber = Color(red: 1.0, green: 0.72, blue: 0.2)
    static let consoleBackground = Color(red: 0.015, green: 0.027, blue: 0.043)
    static let consolePanel = Color(red: 0.045, green: 0.070, blue: 0.095)
    static let consolePanelRaised = Color(red: 0.060, green: 0.085, blue: 0.112)
    static let consoleStroke = Color.white.opacity(0.115)
    static let consoleStrokeBright = Color.white.opacity(0.18)
}

extension String {
    /// Provider display name ("codex" -> "CODEX").
    var providerLabel: String { uppercased() }

    /// "9m ago" -> "9m ago" with only the first letter uppercased.
    var sentenceCased: String { prefix(1).uppercased() + dropFirst() }
}

extension Date {
    /// Compact elapsed time: "08:42" under an hour, "3h 12m" beyond.
    var elapsedLabel: String {
        elapsedLabel(at: .now)
    }

    func elapsedLabel(at now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(self)))
        if seconds < 3600 { return String(format: "%02d:%02d", seconds / 60, seconds % 60) }
        return "\(seconds / 3600)h \(seconds % 3600 / 60)m"
    }

    var agoLabel: String {
        agoLabel(at: .now)
    }

    func agoLabel(at now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(self)))
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return "\(seconds / 60)m ago" }
        if seconds < 86400 { return "\(seconds / 3600)h ago" }
        return "\(seconds / 86400)d ago"
    }

    func preciseRemainingLabel(until future: Date) -> String {
        let totalMinutes = max(0, Int(future.timeIntervalSince(self)) / 60)
        if totalMinutes == 0 { return "<1m" }
        let days = totalMinutes / 1440
        let hours = (totalMinutes % 1440) / 60
        let minutes = totalMinutes % 60
        var parts: [String] = []
        if days > 0 { parts.append("\(days)d") }
        if hours > 0 { parts.append("\(hours)h") }
        if minutes > 0 { parts.append("\(minutes)m") }
        return parts.joined(separator: " ")
    }
}

/// Gentle amber pulse for needs_input. Static when Reduce Motion is on.
struct AttentionPulse: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dimmed = false

    func body(content: Content) -> some View {
        content
            .opacity(reduceMotion ? 1 : (dimmed ? 0.6 : 1))
            .animation(reduceMotion ? nil : .easeInOut(duration: 1.4).repeatForever(autoreverses: true), value: dimmed)
            .onAppear { dimmed = true }
    }
}

/// Slow subtle breathing for working state. Static when Reduce Motion is on.
struct WorkingShimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dimmed = false

    func body(content: Content) -> some View {
        content
            .opacity(reduceMotion ? 0.9 : (dimmed ? 0.55 : 0.95))
            .animation(reduceMotion ? nil : .easeInOut(duration: 2.8).repeatForever(autoreverses: true), value: dimmed)
            .onAppear { dimmed = true }
    }
}
