import SwiftUI

// Shared visual components for the mockup design language.

/// Tiny line chart. Values are auto-normalized; flat/empty data draws a baseline.
struct Sparkline: View {
    let values: [Double]
    var color: Color = .blue

    var body: some View {
        GeometryReader { geo in
            let maxValue = max(values.max() ?? 1, 0.001)
            let points = values.isEmpty ? [0, 0] : values
            let stepX = geo.size.width / CGFloat(max(points.count - 1, 1))
            Path { path in
                for (i, value) in points.enumerated() {
                    let x = CGFloat(i) * stepX
                    let y = geo.size.height * (1 - CGFloat(value / maxValue) * 0.9) - 1
                    if i == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(color, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
        }
    }
}

/// Provider avatar: official icon when available, fallback glyph otherwise.
struct ProviderBadge: View {
    let provider: String
    var size: CGFloat = 44

    private var normalizedProvider: String {
        provider.lowercased()
    }

    private var assetName: String? {
        switch normalizedProvider {
        case "claude": "ProviderClaude"
        case "codex": "ProviderOpenAI"
        case "deepseek": "ProviderDeepSeek"
        case "openai", "openai api": "ProviderOpenAI"
        default: nil
        }
    }

    private var color: Color {
        switch normalizedProvider {
        case "claude": .orange
        case "codex": .blue
        case "openai", "openai api": .green
        case "deepseek": .purple
        default: .gray
        }
    }

    private var symbol: String {
        switch normalizedProvider {
        case "claude": "rays"
        case "codex": "cube.fill"
        case "openai", "openai api": "sparkles"
        default: "sparkles"
        }
    }

    var body: some View {
        ZStack {
            Circle().fill(Color.consolePanelRaised)
            if let assetName {
                Image(assetName)
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.18)
            } else {
                Circle().fill(color.gradient)
                Image(systemName: symbol)
                    .font(.system(size: size * 0.45, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .overlay(Circle().strokeBorder(Color.consoleStrokeBright))
        .frame(width: size, height: size)
    }
}

/// Rounded panel container used across Overview and Development.
struct Panel<Content: View>: View {
    var title: String?
    var badge: String?
    var trailing: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if title != nil || badge != nil {
                HStack(spacing: 10) {
                    if let title {
                        Text(title)
                            .font(.headline)
                    }
                    if let badge {
                        Text(badge)
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Color(.tertiarySystemFill)))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let trailing {
                        Text(trailing)
                            .font(.subheadline)
                            .foregroundStyle(.blue)
                    }
                }
            }
            content
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

/// Small filled progress bar for resource meters.
struct MeterBar: View {
    let fraction: Double
    var color: Color = .blue
    var height: CGFloat = 6

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.08))
                Capsule()
                    .fill(color)
                    .frame(width: max(height, geo.size.width * min(max(fraction, 0), 1)))
            }
        }
        .frame(height: height)
    }
}

/// Capsule chip with an SF Symbol, as under agent rows in the mockup.
struct Chip: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.caption2)
            Text(text).font(.caption)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(Color.white.opacity(0.07)))
        .foregroundStyle(.secondary)
    }
}

enum Format {
    static func bytes(_ value: Int64) -> String {
        let gb = Double(value) / 1_073_741_824
        if gb >= 1 { return String(format: gb >= 10 ? "%.0f GB" : "%.1f GB", gb) }
        return String(format: "%.0f MB", Double(value) / 1_048_576)
    }

    static func uptime(_ seconds: Int) -> String {
        let days = seconds / 86400
        let hours = seconds % 86400 / 3600
        if days > 0 { return "\(days)d \(hours)h" }
        let minutes = seconds % 3600 / 60
        return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
    }
}

extension AgentState {
    /// Sentence-case label for list rows ("Working"), vs. the big card label.
    var shortLabel: String { label.capitalized }
}
