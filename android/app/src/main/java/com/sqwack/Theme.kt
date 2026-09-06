package com.sqwack

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import kotlinx.coroutines.delay
import java.time.Instant
import java.util.Locale
import kotlin.math.max

// Visual language (dark-first): blue=working, amber=needs input, green=done,
// red=failed, gray=idle. Calm by default; only needs_input pulses.

object Palette {
    val blue = Color(0xFF0A84FF)
    val green = Color(0xFF30D158)
    val red = Color(0xFFFF453A)
    val orange = Color(0xFFFF9F0A)
    val purple = Color(0xFFBF5AF2)
    val mint = Color(0xFF63E6E2)
    val gray = Color(0xFF8E8E93)
    val amber = Color(red = 1.0f, green = 0.72f, blue = 0.2f)

    val background = Color(red = 0.015f, green = 0.027f, blue = 0.043f)
    val panel = Color(red = 0.045f, green = 0.070f, blue = 0.095f)
    val panelRaised = Color(red = 0.060f, green = 0.085f, blue = 0.112f)
    val stroke = Color.White.copy(alpha = 0.115f)
    val strokeBright = Color.White.copy(alpha = 0.18f)

    val primaryText = Color(0xFFF2F2F7)
    val secondaryText = Color(0xFF9BA3AF)
    val tertiaryText = Color(0xFF6B7280)
    val fill = Color.White.copy(alpha = 0.07f)
}

val AgentState.color: Color
    get() = when (this) {
        AgentState.WORKING -> Palette.blue
        AgentState.NEEDS_INPUT -> Palette.amber
        AgentState.DONE -> Palette.green
        AgentState.FAILED -> Palette.red
        AgentState.IDLE, AgentState.UNKNOWN -> Palette.gray
    }

val AgentState.label: String
    get() = when (this) {
        AgentState.WORKING -> "WORKING"
        AgentState.NEEDS_INPUT -> "NEEDS YOU"
        AgentState.DONE -> "DONE"
        AgentState.FAILED -> "FAILED"
        AgentState.IDLE -> "IDLE"
        AgentState.UNKNOWN -> "UNKNOWN"
    }

/// Sentence-case label for list rows ("Working"), vs. the big card label.
val AgentState.shortLabel: String get() = label.lowercase(Locale.US).replaceFirstChar { it.uppercase() }

val SqwackStatus.color: Color
    get() = when (this) {
        SqwackStatus.QUIET -> Palette.green
        SqwackStatus.WORKING -> Palette.blue
        SqwackStatus.ATTENTION -> Palette.amber
        SqwackStatus.FAILURE -> Palette.red
    }

val SqwackStatus.headline: String
    get() = when (this) {
        SqwackStatus.QUIET -> "ALL QUIET"
        SqwackStatus.WORKING -> "WORKING"
        SqwackStatus.ATTENTION -> "NEEDS YOU"
        SqwackStatus.FAILURE -> "FAILURE"
    }

/// Provider display name ("codex" -> "CODEX").
val String.providerLabel: String get() = uppercase(Locale.US)

val String.sentenceCased: String get() = replaceFirstChar { it.uppercase() }

val String.capitalizedWords: String
    get() = lowercase(Locale.US).split(" ").joinToString(" ") { it.replaceFirstChar { c -> c.uppercase() } }

/// Compact elapsed time: "08:42" under an hour, "3h 12m" beyond.
fun Instant.elapsedLabel(now: Instant): String {
    val seconds = max(0, now.epochSecond - epochSecond)
    if (seconds < 3600) return String.format(Locale.US, "%02d:%02d", seconds / 60, seconds % 60)
    return "${seconds / 3600}h ${seconds % 3600 / 60}m"
}

fun Instant.agoLabel(now: Instant): String {
    val seconds = max(0, now.epochSecond - epochSecond)
    return when {
        seconds < 60 -> "just now"
        seconds < 3600 -> "${seconds / 60}m ago"
        seconds < 86400 -> "${seconds / 3600}h ago"
        else -> "${seconds / 86400}d ago"
    }
}

fun Instant.preciseRemainingLabel(until: Instant): String {
    val totalMinutes = max(0, (until.epochSecond - epochSecond) / 60)
    if (totalMinutes == 0L) return "<1m"
    val parts = buildList {
        val days = totalMinutes / 1440
        val hours = (totalMinutes % 1440) / 60
        val minutes = totalMinutes % 60
        if (days > 0) add("${days}d")
        if (hours > 0) add("${hours}h")
        if (minutes > 0) add("${minutes}m")
    }
    return parts.joinToString(" ")
}

object Format {
    fun bytes(value: Long): String {
        val gb = value / 1_073_741_824.0
        if (gb >= 1) return String.format(Locale.US, if (gb >= 10) "%.0f GB" else "%.1f GB", gb)
        return String.format(Locale.US, "%.0f MB", value / 1_048_576.0)
    }

    fun uptime(seconds: Int): String {
        val days = seconds / 86400
        val hours = seconds % 86400 / 3600
        if (days > 0) return "${days}d ${hours}h"
        val minutes = seconds % 3600 / 60
        return if (hours > 0) "${hours}h ${minutes}m" else "${minutes}m"
    }
}

/// Ticking clock, the Compose counterpart of SwiftUI's TimelineView(.periodic).
@Composable
fun rememberNow(periodMillis: Long = 1000): State<Instant> {
    val now = remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(periodMillis) {
        while (true) {
            delay(periodMillis)
            now.value = Instant.now()
        }
    }
    return now
}

/// Gentle amber pulse for needs_input; slow breathing for working.
@Composable
fun Modifier.attentionPulse(enabled: Boolean = true): Modifier =
    if (!enabled) this else this.alpha(pulseAlpha(1f, 0.6f, 1400))

@Composable
fun Modifier.workingShimmer(enabled: Boolean = true): Modifier =
    if (!enabled) this else this.alpha(pulseAlpha(0.95f, 0.55f, 2800))

@Composable
private fun pulseAlpha(from: Float, to: Float, durationMillis: Int): Float {
    val transition = rememberInfiniteTransition(label = "pulse")
    return transition.animateFloat(
        initialValue = from,
        targetValue = to,
        animationSpec = infiniteRepeatable(tween(durationMillis), RepeatMode.Reverse),
        label = "alpha",
    ).value
}

@Composable
fun SqwackTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.blue,
            background = Palette.background,
            surface = Palette.panel,
            surfaceVariant = Palette.panelRaised,
            onBackground = Palette.primaryText,
            onSurface = Palette.primaryText,
            error = Palette.red,
        ),
        typography = Typography(),
        content = content,
    )
}
