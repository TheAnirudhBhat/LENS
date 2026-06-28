# Compounder Design System

The active design language extracted from `OverviewTab`, `HoldingsTab`,
`BondsTab`, `MutualFundsTab`, `USStocksTab`, the asset-allocation card, and
the today's-actions card. Use this as the spec for new surfaces. Tokens live
in `app/globals.css`; primitives live in `components/ui/`.

## Colour tokens

All colours are CSS variables — never hardcode hex.

| Token | Light | Dark |
| --- | --- | --- |
| `--bg-base` | `#fafafa` | `#0a0a0a` |
| `--bg-card` | `#ffffff` | `#161616` |
| `--bg-subtle` | `#f4f4f5` | `#1f1f1f` |
| `--bg-raised` | `#ffffff` | `#18181b` |
| `--border` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.08)` |
| `--border-strong` | `rgba(0,0,0,0.14)` | `rgba(255,255,255,0.14)` |
| `--text-primary` | `rgba(0,0,0,0.9)` | `rgba(255,255,255,0.92)` |
| `--text-secondary` | `rgba(0,0,0,0.7)` | `rgba(255,255,255,0.7)` |
| `--text-tertiary` | `rgba(0,0,0,0.5)` | `rgba(255,255,255,0.5)` |
| `--brand` | `#d30ad7` | `#e55df0` |
| `--pos` | `#0f9d58` | `#34d399` |
| `--neg` | `#d93025` | `#f87171` |
| `--warn` | `#f4b400` | `#fbbf24` |

Tints: `--brand-tint`, `--pos-tint`, `--neg-tint` for soft fills.

## Typography

Three families, used surgically:

- **Anybody (display wide)** — `var(--font-display-wide)`. Page H1s only.
  Always `font-black uppercase tracking-[-0.02em]`, `font-stretch: 120%`.
- **Rubik** — `var(--font-sans)`. Default for everything: body, sub-titles,
  list rows, buttons, inputs. Numeric UI uses `mono-true` (Rubik with
  tabular figures).
- **Source Serif 4** — `var(--font-display)`. Reserved for the brand
  wordmark and rare display use (modal titles currently). Treated as the
  "editorial" voice — keep usage minimal.

Type scale (in `globals.css`): `.type-h1`, `.type-h2`, `.type-h3`, `.type-h4`,
`.type-body`, `.type-body-sm`, `.type-caption`, `.type-meta`, `.eyebrow`.

### Heading recipes

- **Page H1** — `text-[20px] md:text-[24px] font-black uppercase tracking-[-0.02em]`,
  `font-family: var(--font-display-wide)`, `font-stretch: 120%`. Use `<PageHero>`.
- **Section H2** (inside cards: "Asset allocation", "Today's actions") —
  `text-[15px] md:text-[16px] font-semibold tracking-[-0.005em] text-primary`.
  Use `<CardHeader title>` or `<SectionTitle>`.
- **List subtitle** — `text-[11.5px]` to `text-[12.5px] text-tertiary leading-snug`.

## Cards

`surface rounded-lg overflow-hidden` is the base. The header is a flex
row `px-6 py-5 flex items-center justify-between flex-wrap gap-3`, often
with `borderBottom: 1px solid var(--border)` separating header from body.

Use `<Card>` + `<CardHeader>` for consistency.

## Buttons

- **Primary CTA** (Invest, All tasks, Add idea): `rounded-md`, `pl-2.5 pr-3.5 py-1.5`,
  `text-[11.5px] font-medium`, `bg: var(--text-primary)`, `fg: var(--bg-card)`
  (auto-inverts in dark), `transition-opacity hover:opacity-90`. Optional
  11px icon left with `gap-1`. Use `<Button variant="primary">`.
- **Secondary**: `rounded-md`, `px-3.5 py-1.5`, `text-[12px]`,
  `border border-subtle text-secondary hover:bg-[var(--bg-subtle)]`.
  Use `<Button variant="secondary">`.
- **Ghost / link**: bare `text-tertiary hover:text-primary` — used for
  modal cancel, "Show stats", etc. Use `<Button variant="ghost">`.
- **Filter chips / segmented**: `<Toolbar>` + `<Segmented>`. Don't reinvent.

## Inputs

Form inputs follow `AddIdeaModal`'s shape: full-width, `rounded-md`,
`px-3 py-2`, `text-[12.5px] text-primary`, `placeholder:text-tertiary`,
`border: 1px solid var(--border)` on `var(--bg-subtle)` background,
`outline-none focus:border-[var(--brand)]`. Same shape for `<input>` and
`<textarea>` (textarea adds `resize-none leading-snug`).

The Invest modal historically used a transparent input with a bottom
border for the amount field — keep that exception only when the input
sits next to a large numeral (the ₹ symbol).

## InfoTip

Feather `info` icon. Scales with surrounding text via `em`:
- default `size="md"` → 0.7em (sits inline next to small body text)
- `size="sm"` → 1em (used inside `eyebrow` labels in CompactStat)

Always `text-tertiary hover:text-primary`. Tooltip placed via portal,
256px wide, `var(--bg-card)` with subtle border.

## List rows

Standard pattern (Holdings, MF, US, Bonds, Earnings, Tasks):

- 40px chip (logo) · `1fr` single-line label · numeric columns aligned right
- **Single-line label only** — never main text + subtext under it. Supporting
  context (sector, qty, freq) goes into a numeric/badge column or the
  detail modal, not a second line. Repeating fact-strings under the label
  reads as noise. Page heroes also follow this rule (no subtitle prop).
- `py-5 px-1` on the row, parent gets `px-3 md:px-5` indent (or `px-1.5`
  on log pages where there's no card above)
- Inset divider via `after:left-[52px] after:right-1 after:bottom-0 after:h-px after:bg-[var(--border)]`
  (i.e. divider starts after the chip)
- Hover: `hover:bg-[var(--bg-subtle)]`
- Animated entry: parent `list-stagger`, child sets `--idx`

For rows without a chip (e.g. Tasks-as-text), still respect the indent
and inset divider but skip the 40px column.

## Modals

Backdrop + card pattern (in `globals.css`):

- `.modal-backdrop`: fixed inset-0 z-50 with `bg-black/40 backdrop-blur-sm`,
  fade-in 180ms.
- `.modal-card`: `surface rounded-lg max-w-lg w-full max-h-[90vh]
  overflow-y-auto no-scrollbar`, pop-in 220ms.
- Header: title + optional subtitle on left, close button (×, `text-tertiary
  hover:text-primary`) top-right. **Decision:** title uses Source Serif
  (`font-serif text-[22px] font-semibold tracking-[-0.015em]`) for the
  editorial voice — the modal is a quiet pause from the dense dashboard.
  Everything else inside the modal is Rubik.
- Sections separated by `borderTop: 1px solid var(--border)` with `pt-5 mt-5`.
- Footer: `pt-5 mt-5 borderTop` divider, primary CTA right-aligned, ghost
  cancel left.

Use `<Modal>` + `<ModalFooter>`.

## Spacing rhythm

- Page header → first card: `space-y-8` (32px). `<PageHero>` enforces it.
- Card → card on Overview: `space-y-5` (20px).
- Card → list on portfolio tabs: `space-y-7` (28px).
- Toolbar / list indent: `px-3 md:px-5`.
- Inside cards: header `px-6 py-5`, body `px-6 py-6` or `py-7`.
- Modal: `p-7` outer; sections separated by `pt-5 mt-5`.

Snap everything to 4px / 8px multiples.

## View Transitions

Wrapper `view-transition-name: tab-content` for tab content slides;
`stat-card` for the 4-stat strip morph.

- Old: 200ms fade-out using `vt-slide-left-out`.
- New: 320ms slide-in with 80ms delay using `vt-slide-left-in`.
- Curve: `cubic-bezier(0.4, 0, 0.2, 1)` aliased as `--vt-ease`.
- Stat card: 340ms group, 200ms old fade, 280ms new fade with 60ms delay.

Reduced-motion: all view-transition animations disabled.

## What lives where

- **Tokens** → `app/globals.css`
- **Primitives** → `components/ui/` (re-exported via `index.ts`)
- **Tab-specific layouts** → `app/page.tsx`
- **Domain widgets** (HoldingCard, MFCard, TickerTape, LogoImg) → `components/`

When a new pattern shows up twice in `app/page.tsx`, lift it to
`components/ui/` and update this doc.
