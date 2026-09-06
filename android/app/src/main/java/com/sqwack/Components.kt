package com.sqwack

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Image
import java.util.Locale
import kotlin.math.max

// Shared visual components for the mockup design language.

/// Tiny line chart. Values are auto-normalized; flat/empty data draws a baseline.
@Composable
fun Sparkline(values: List<Double>, color: Color = Palette.blue, modifier: Modifier = Modifier) {
    Canvas(modifier.fillMaxSize()) {
        val points = if (values.isEmpty()) listOf(0.0, 0.0) else values
        val maxValue = max(points.max(), 0.001)
        val stepX = size.width / max(points.size - 1, 1)
        val path = Path()
        points.forEachIndexed { index, value ->
            val x = index * stepX
            val y = size.height * (1f - (value / maxValue).toFloat() * 0.9f) - 1f
            if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(path, color, style = Stroke(width = 1.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/// Provider avatar: official icon when available, fallback glyph otherwise.
@Composable
fun ProviderBadge(provider: String, size: Dp = 44.dp) {
    val normalized = provider.lowercase(Locale.US)
    val asset = when (normalized) {
        "claude" -> R.drawable.provider_claude
        "codex", "openai", "openai api" -> R.drawable.provider_openai
        "deepseek" -> R.drawable.provider_deepseek
        else -> null
    }
    val fallbackColor = when (normalized) {
        "hermes" -> Palette.mint
        else -> Palette.gray
    }
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(Palette.panelRaised)
            .border(1.dp, Palette.strokeBright, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (asset != null) {
            Image(
                painterResource(asset),
                contentDescription = provider,
                contentScale = ContentScale.Fit,
                modifier = Modifier.padding(size * 0.18f).fillMaxSize(),
            )
        } else {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Brush.linearGradient(listOf(fallbackColor, fallbackColor.copy(alpha = 0.6f)))),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    provider.take(1).uppercase(Locale.US),
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = (size.value * 0.45f).sp,
                )
            }
        }
    }
}

/// Rounded panel container used across Overview and Development.
@Composable
fun Panel(
    modifier: Modifier = Modifier,
    title: String? = null,
    badge: String? = null,
    trailing: String? = null,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Palette.panel)
            .border(1.dp, Palette.stroke, RoundedCornerShape(16.dp))
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (title != null || badge != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (title != null) Text(title, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Palette.primaryText)
                if (badge != null) {
                    Text(
                        badge,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Palette.secondaryText,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(Palette.fill)
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
                Spacer(Modifier.weight(1f))
                if (trailing != null) Text(trailing, fontSize = 13.sp, color = Palette.blue)
            }
        }
        content()
    }
}

/// Small filled progress bar for resource meters.
@Composable
fun MeterBar(fraction: Double, color: Color = Palette.blue, height: Dp = 6.dp, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.08f)),
    ) {
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(fraction.coerceIn(0.0, 1.0).toFloat())
                .clip(CircleShape)
                .background(color),
        )
    }
}

/// Capsule chip, as under agent rows in the mockup.
@Composable
fun Chip(icon: String, text: String) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(Palette.fill)
            .padding(horizontal = 9.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(icon, fontSize = 10.sp, color = Palette.secondaryText)
        Text(text, fontSize = 12.sp, color = Palette.secondaryText, maxLines = 1)
    }
}

@Composable
fun Dot(color: Color, size: Dp = 8.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(color))
}

@Composable
fun Divider() = HorizontalDivider(color = Palette.stroke)

@Composable
fun Mono(text: String, fontSize: androidx.compose.ui.unit.TextUnit = 13.sp, color: Color = Palette.secondaryText, fontWeight: FontWeight = FontWeight.Normal, modifier: Modifier = Modifier) {
    Text(text, fontSize = fontSize, color = color, fontFamily = FontFamily.Monospace, fontWeight = fontWeight, maxLines = 1, modifier = modifier)
}

/// Pill used for tab buttons and menu triggers.
@Composable
fun Pill(
    selected: Boolean = false,
    onClick: () -> Unit,
    padding: PaddingValues = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
    content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(if (selected) Palette.blue.copy(alpha = 0.14f) else Palette.panelRaised)
            .border(1.dp, Palette.stroke, CircleShape)
            .clickable(onClick = onClick)
            .padding(padding),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}
