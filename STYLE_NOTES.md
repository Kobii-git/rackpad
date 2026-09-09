# Rackpad Style Notes

## Reference Aesthetic

Rackpad now leans into a premium infra-control look inspired by modern operator tools like Linear, Tailscale, Grafana, Proxmox, and NetBox. That mix fits Rackpad because it keeps the UI dense, technical, and operational without becoming cold, generic, neon, or marketing-like.

## Token List

### Background and surface scale

- `--bg-page`: theme-specific page background
- `--bg-shell`: app shell and chrome background
- `--surface-1`: inset panels, tables, grids
- `--surface-2`: standard cards
- `--surface-3`: elevated controls and headers
- `--surface-4`: stronger elevated surface
- `--surface-input`: input/select background
- `--surface-hover`: hover state for rows, nav, and controls
- `--surface-selected`: selected state surface

### Border scale

- `--border-subtle`: inner dividers and low-priority edges
- `--border-default`: standard borders
- `--border-strong`: stronger framing edges
- `--border-focus`: focus ring edge
- `--border-selected`: selected panel edge

### Text scale

- `--text-primary`: primary content
- `--text-secondary`: supporting content
- `--text-tertiary`: labels, metadata, helper copy
- `--text-muted`: tertiary low-contrast metadata
- `--text-disabled`: disabled fields and controls
- `--text-inverse`: text on the primary amber button

### Accent colors

- `--accent-primary`: Rackpad amber/orange
- `--accent-primary-hover`: brighter amber hover
- `--accent-primary-active`: darker amber active
- `--accent-primary-soft`: tinted amber background
- `--accent-primary-border`: amber border state
- `--accent-secondary`: cyan/teal info-network accent
- `--accent-secondary-soft`: tinted cyan background

### Semantic colors

- `--success`: online / healthy
- `--warning`: caution / unknown-ish operational attention
- `--danger`: down / destructive
- `--info`: informational / structured infra state
- `--neutral`: low-emphasis chip state
- each semantic color has a matching `*-soft` and `*-border`

## Primary Accent Usage Rules

- Use amber for primary calls to action: save, add, allocate, import.
- Use amber for active navigation, selected high-priority items, and key numeric emphasis.
- Do not use amber on every panel or border; it should guide attention, not coat the app.

## Secondary Accent Choice and Rationale

Rackpad uses cyan/teal as the secondary accent because it reads as network, telemetry, and linkage without competing with the brand amber. It is best for:

- link/relationship states
- active port/link indicators
- info-oriented badges
- connectivity and network visuals

## Semantic Color Usage Rules

- Success green: online, healthy, recovered
- Warning amber/yellow: warning, reserved, cautionary states
- Danger red: offline, failing, destructive actions
- Info blue: structured technical state that is neither success nor danger
- Neutral slate: inactive, reference, or low-priority metadata

## Badge and Status Rules

- Badges should always use tinted backgrounds, not text-only color.
- Status badges must still include text labels; color is reinforcement, not the only signal.
- Use rounded pills for badges and chips to separate them from harder-edged cards and tables.
- Dots and LED-like indicators can glow subtly when showing live or healthy states.

## Surface Hierarchy Rules

- Use the theme tokens for page and card separation. The dark theme uses a darker page; the light theme uses its own surface scale.
- Cards sit one step above the page.
- Inspectors, tables, range bars, and embedded panels sit one step above or inset within cards.
- Inputs are clearly interactive and distinct from their surrounding panel in both themes.
- Selected surfaces use a dedicated selected background and edge treatment instead of louder borders everywhere.
- Cards can use a subtle top-edge highlight to simulate overhead lighting.

## Typography Rules

- Page titles are tighter and slightly bolder.
- Section labels use small uppercase monospace with tracking.
- Important values use tabular numerals and stronger weight.
- Technical identifiers like IPs, CIDRs, MACs, ports, VLAN IDs, and speeds should stay monospace.
- Muted text should remain readable in light and dark modes; avoid dropping too close to the background.

## Do and Don't

### Do

- preserve density
- use contrast through surfaces before adding more borders
- keep technical data monospace where it improves scanning
- use color as a focused signal
- make signature views feel tactile and operational

### Don't

- turn the app into a marketing site
- add blur or glass everywhere
- overuse gradients
- make cards overly padded
- make status meaning ambiguous
- replace useful density with oversized spacing

## Preserving Density

The polish pass deliberately keeps compact controls, tight tables, and dense dashboards. Most improvements come from:

- better background and surface separation
- clearer borders
- stronger label/value hierarchy
- better hover and selected states
- cleaner grouped panels

## Tradeoffs

- A full shared table component was not introduced to avoid unnecessary refactors; shared table styling is applied through CSS utilities and lightweight page updates.
- Existing route structure, data layout, and business behavior were preserved even where some page markup is still locally structured.
- IBM Plex Sans and IBM Plex Mono are bundled through `@fontsource` imports in `src/main.tsx`. Fonts are self-hosted; retain system fallbacks and test both themes.
