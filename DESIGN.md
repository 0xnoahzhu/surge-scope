# Surge Scope design

## 1. Visual theme
A precise, restrained, scan-friendly traffic instrument. System appearance is the default, with Graphite dark and Paper light options. Utility comes before decoration.

## 2. Palette
Use green accents at OKLCH hue 155. Light canvas L .97, sidebar .92, text .25, accent .43. Dark canvas .16, sidebar .19, text .91, accent .78. Failures use warm red at hue 30. CSS Modules is the single styling strategy.

## 3. Typography
Avenir Next and the system CJK fallback serve interface text; Menlo serves numeric and raw data. Headings use 28/19px, body 13px, table 11px, with tabular numbers. Local fonts avoid external requests and download dependencies.

## 4. Components
Buttons and inputs use a consistent 6px radius, protocol tags 3px. States combine labels and color. Focus uses a 2px accent outline; button press uses scale .95; disabled controls reduce opacity.

## 5. Layout
A 224px sidebar and 32px workspace margin. Status, metrics, filters, request table, and details follow the inspection workflow. No marketing hero or decorative card grid.

## 6. Depth
Dark surfaces use luminance steps; light surfaces use background contrast. Request details are embedded on wide screens and overlay the workspace on narrow screens.

## 7. Rules
Keep raw field names unchanged. Use monospaced numbers. Never describe connection metadata as HTTP body content. Expose errors. Truncated group names retain full title text. Avoid external decorative images.

## 8. Responsive behavior
Below 1100px, narrow the sidebar and overlay details. Below 700px, use top navigation. At 375px, only the table container scrolls horizontally. Reduce-motion settings disable press scaling and transitions.

## 9. Localization and component guide
English is the default language. User-facing strings pass through the translation function; Chinese translations use Unicode escapes in a separate JSON resource. Technical fields and stored traffic data remain original. New columns use 11px text, 500-weight headers, and 12px horizontal padding. Buttons use 6px radius, 40px minimum height, and a 120ms transform transition. New states use semantic text and existing green/red tokens.
