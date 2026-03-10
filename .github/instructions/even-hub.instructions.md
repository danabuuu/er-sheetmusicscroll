---
description: "Use when building the glasses/Even Hub app, working in the glasses/ folder, or using the Even Hub SDK, Vite, or evenhub-simulator. Covers Even Hub project structure, SDK usage, and G2 display constraints."
applyTo: "glasses/**"
---
# Even Hub (Glasses App) Conventions

## Project Structure
- The Even Hub app lives in the `glasses/` folder
- `glasses/index.html` — required root entry point (Even Hub looks for this first)
- `glasses/Main.ts` — main TypeScript entry point, included in `index.html` via:
  ```html
  <script type="module" src="/Main.ts"></script>
  ```

## Display Constraints
- **Usable canvas: 576×288 pixels** (Even Hub SDK coordinate system — xPosition 0–576, yPosition 0–288)
- The glasses app is a **code-only execution environment**, not a rendered web page. `index.html` runs TypeScript that calls the bridge SDK; the glasses display native containers — not HTML/CSS.
- Max **4 containers** per page (any combination of list, text, image)
- Image containers: max **200×100 px** each

## Glasses Display — Dark Mode UI
The glasses display uses a **dark theme** that is completely different from the companion app's bright mode.

### Colors (Glasses Display)
| Token | Value | Use |
|-------|-------|-----|
| `--g-bg` | `#232323` | Outer / page background |
| `--g-surface` | `#2F2F2F` | Card / widget surface |
| `--g-overlay` | `#1E1E1E` | Popup / menu / toast overlay bg (darker than bg) |
| `--g-text-primary` | `#FFFFFF` | Primary / active content text |
| `--g-text-secondary` | `#808080` | Inactive text, inactive menu icons, pagination dots |
| `--g-text-ui` | `#D3D3D3` | UI labels, headings |

### Fonts (Glasses Display)
> **Critical**: The glasses display uses DIFFERENT fonts than the companion app (`FK Grotesk Neue` is companion-app only).

| Font | Role | Actual size | Notes |
|------|------|-------------|-------|
| `Even Roster Grotesk` | Content / data display | 22px / 31px lh / weight 400 | Scrolling music text, stock tickers, notification body |
| `Even Roster Grotesk Plus` | OS UI labels | 24px / 33px lh / weight 400 | Menu item labels, toast text, popup titles |
| `Even Time Big Pixel` | Clock display | — | OS layer only; pixel/bitmap style |
| `Even Signature` | Date display | — | OS layer only; script style |

> Figma canvas values are ~1.53× larger than actual glasses device values. Divide Figma px by 1.53 to get real sizes.

### Glasses Widget / Card
Content displayed on the glasses is shown inside a rounded bordered card:
```css
border: 4px solid #FFFFFF;
border-radius: 24px;
padding: 24px 48px;
```

For text content within the widget:
```css
font-family: 'Even Roster Grotesk';
font-weight: 400;
font-size: 80px;        /* Figma canvas scale — proportionally reduce for 640×350 */
line-height: 112px;     /* 140% */
color: #FFFFFF;
```

### Glasses Pop-up / Toast Card
Overlay cards (notifications, menus, confirmation dialogs) use a darker background than the page:
```css
background: var(--g-overlay);   /* #1E1E1E */
border: 1.1px solid #FFFFFF;
border-radius: 6.7px;
/* Text: 'Even Roster Grotesk Plus', 24px, weight 400, color #FFFFFF */
/* Scaled from Figma: border 1.7px → 1.1px, radius 10.2px → 6.7px */
```

### Spacing / Layout (Glasses)
Annotation values from the Figma layout guide:
- Widget padding: **16px** horizontal, **8px** vertical (minimum safe margins)
- Widget corner radius: **24px** for content cards
- Surface corner radius: **6px** for background containers

### CSS for Glasses App Root
```css
:root {
  /* Glasses dark display colors */
  --g-bg:             #232323;
  --g-surface:        #2F2F2F;
  --g-overlay:        #1E1E1E;  /* popup/menu/toast bg — darker than page bg */
  --g-text-primary:   #FFFFFF;
  --g-text-secondary: #808080;  /* also: inactive menu icons + pagination dots */
  --g-text-ui:        #D3D3D3;

  /* Fonts */
  --font-glasses-content: 'Even Roster Grotesk', sans-serif;       /* content / data */
  --font-glasses-ui:      'Even Roster Grotesk Plus', sans-serif;  /* menus / toasts / popups */
}

body {
  background: var(--g-bg);
  color: var(--g-text-primary);
  font-family: var(--font-glasses-content);
  width: 640px;
  height: 350px;
  overflow: hidden;
}
```

## SDK

### Initialisation
```ts
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'

const bridge = await waitForEvenAppBridge()
```

### Page Lifecycle
- **`createStartUpPageContainer`** — called **once only** at startup to define the initial page layout
- **`rebuildPageContainer`** — called for every subsequent page change or layout update (same API shape)
- Calling `createStartUpPageContainer` again after the first call has no effect

```ts
import {
  waitForEvenAppBridge,
  ListContainerProperty,
  TextContainerProperty,
  ImageContainerProperty,
  CreateStartUpPageContainer,
} from '@evenrealities/even_hub_sdk'

const bridge = await waitForEvenAppBridge()

// Called once at startup:
const result = await bridge.createStartUpPageContainer({
  containerTotalNum: 2,        // max 4
  listObject: [listContainer],
  imageObject: [imageContainer],
})
// result: 0 = success, 1 = invalid, 2 = oversize, 3 = outOfMemory

// All subsequent page updates:
await bridge.rebuildPageContainer({ ... })
```

### Container Types
All containers share `xPosition`, `yPosition`, `width`, `height`, `containerID`, `containerName`, `borderWidth`, `borderColor`, `borderRdaius` (sic), `paddingLength`, and `isEventCapture`.

> **`isEventCapture`**: Exactly **one** container per page must have `isEventCapture: 1`. All others must be `0`.

#### ListContainerProperty
- Renders a scrollable list of items on the glasses
- `itemContainer.itemCount`: 1–20 items
- `itemContainer.itemName`: string[], max 64 chars per item
- `isItemSelectBorderEn: 1` shows a border around the selected item
- **This is the primary input mechanism** — temple gestures scroll through items

#### TextContainerProperty
- Renders static or updatable text
- `content`: max 1000 chars at startup; update via `textContainerUpgrade` (max 2000 chars, supports `contentOffset`)

#### ImageContainerProperty
- Renders a raw image (pixel data)
- Width: **20–200 px**, Height: **20–100 px** (hard limits)
- Content is set via `updateImageRawData` **after** container creation
- **This is the scrolling music display widget** — send successive slices of the scroll image

### Updating Content After Startup
```ts
// Update an image container (e.g. next scroll frame):
await bridge.updateImageRawData({
  containerID: 1,
  containerName: 'scroll',
  imageData: sliceBuffer, // Uint8Array, number[], ArrayBuffer, or base64 string
})
// ⚠ Send serially — wait for each result before sending the next frame
// ⚠ Avoid sending too frequently — glasses hardware has limited memory

// Update a text container:
await bridge.textContainerUpgrade({
  containerID: 2,
  containerName: 'status',
  contentOffset: 0,
  contentLength: 100,
  content: 'Now playing: Lovely Day',
})
```

### Input / Temple Gestures
Temple scroll and tap gestures navigate the **list container** with `isEventCapture: 1`. There is no raw gesture API.

```ts
const unsubscribe = bridge.onEvenHubEvent((event) => {
  if (event.listEvent) {
    const idx = event.listEvent.currentSelectItemIndex
    const name = event.listEvent.currentSelectItemName
    // e.g. idx 0 = 'Play', 1 = 'Pause', 2 = '+BPM', 3 = '-BPM'
  }
  if (event.sysEvent) {
    // OS-level event (e.g. app losing focus)
  }
})
```

### Device Status
```ts
bridge.onDeviceStatusChanged((status) => {
  console.log(status.connectType)   // 'connected' | 'disconnected' | ...
  console.log(status.batteryLevel)  // 0-100
  console.log(status.isWearing)     // boolean
})
```

### Scrolling Music — Implementation Pattern
For the music scroll display:
1. Pre-render the full score as a **100px-tall** PNG strip (via `lib/staff-extraction`)
2. Create an `ImageContainerProperty` at full width (≤200px), height 100
3. On each playback tick (interval = measures/BPM), crop the next 200px-wide slice from the strip and call `updateImageRawData`
4. `imageData` should be raw pixel bytes (greyscale or 1-bit BW) — keep it small for transfer speed
5. Playback controls (Play / Pause / +BPM / -BPM) live in a `ListContainerProperty` alongside the image

```ts
// Example page layout for playback screen:
{
  containerTotalNum: 2,
  imageObject: [{
    containerID: 1, containerName: 'scroll',
    xPosition: 0, yPosition: 0,
    width: 200, height: 100,
  }],
  listObject: [{
    containerID: 2, containerName: 'controls',
    xPosition: 0, yPosition: 106,
    width: 576, height: 60,
    isEventCapture: 1,
    itemContainer: {
      itemCount: 4,
      itemName: ['▶ Play', '⏸ Pause', '+ BPM', '- BPM'],
    },
  }],
}
```

## Dev Server
Run Vite specifying your machine's local IP and a port:
```sh
vite -i 192.168.x.x -p 5173
```
Keep this terminal running at all times during development.

## Simulator
In a second terminal, point the simulator at your running Vite server:
```sh
evenhub-simulator http://192.168.x.x:5173
```
This opens a browser window showing how the app looks inside the Even Realities mobile app.

## Installing Tooling
```sh
# Even Hub CLI (global)
sudo npm install -g @evenrealities/evenhub-cli

# Even Hub SDK (project)
npm install @evenrealities/even_hub_sdk

# Even Hub Simulator (global)
sudo npm install -g @evenrealities/evenhub-simulator

# Vite (global)
sudo npm install -g vite@latest
```
> On Windows, omit `sudo`.

## Even Realities Design Tokens
Source: Even Realities Software Design Guidelines (Figma, Even OS 2.0 — Color Palette)

### Color Palette

#### Text Colors (Bright Mode)
| Token | Hex | Use |
|-------|-----|-----|
| `--tc-primary` | `#232323` | Primary text (EvenBlack) |
| `--tc-secondary` | `#7B7B7B` | Subtitle / secondary text |
| `--tc-white` | `#FFFFFF` | Text on dark backgrounds |
| `--tc-red` | `#FF453A` | Destructive / error |
| `--tc-green` | `#4BB956` | Success / connected |
| `--tc-accent` | `#FF453A` | Accent (same as red in bright mode) |

#### Background Colors (Bright Mode)
| Token | Hex | Use |
|-------|-----|-----|
| `--bc-black` | `#232323` | Dark/inverse backgrounds |
| `--bc-white` | `#FFFFFF` | Card / list item backgrounds |
| `--bc-app` | `#F6F6F6` | Main app background |
| `--bc-surface` | `#EEEEEE` | Nav bars, pop-ups, section backgrounds |
| `--bc-subtle` | `#E4E4E4` | Subtle fills, placeholders |
| `--bc-highlight` | `#FEF991` | Highlight / attention (yellow) |

#### Shaded / Overlay Colors
| Token | Value | Use |
|-------|-------|-----|
| `--sc-overlay` | `rgba(0, 0, 0, 0.5)` | Modal/dark overlay |
| `--sc-pressing` | `rgba(0, 0, 0, 0.12)` | Button press state |
| `--sc-tint` | `rgba(35, 35, 35, 0.08)` | Search bar fill, subtle tint |
| `--sc-unavailable` | `rgba(255, 255, 255, 0.8)` | Disabled element overlay |

#### Utility
| Token | Hex | Use |
|-------|-----|-----|
| `--divider` | `#BDBDBD` | Dividers, borders |

### Typography
- **Font family**: `FK Grotesk Neue`
- **Design guide weight**: `300` (light) for display/body copy; `400` (regular) for UI labels and buttons
- **Letter spacing**: `-0.05em` for display/labels; `-0.03em` for feature names; `-0.01em` for UI buttons/titles

#### Companion App Type Scale (reference — scale down ~50% for glasses)
| Role | Size | Line height | Weight | Spacing |
|------|------|-------------|--------|---------|
| Display | 60px | 77px | 300 | -0.05em |
| Section heading | 32px | 41px | 300 | -0.05em |
| Body | 24px | 31px | 300 | -0.05em |
| Caption | 16px | 22px | 300–400 | -0.05em |
| UI Title 1 | 17px | 22px | 400 | -0.01em |
| UI Title 2 | 15px | 19px | 400 | -0.01em |
| UI Subtitle | 13px | 17px | 400 | -0.01em |

> For the 640×350 glasses display, use the UI scale (15–17px) directly — it maps well to the glasses viewport.

### Component Patterns

#### Button — Primary (dark)
```css
background: #232323;
border-radius: 6px;
padding: 13px 16px;
height: 48px;
color: #FFFFFF;
font-size: 17px;
font-weight: 400;
letter-spacing: -0.01em;
```

#### Button — Secondary (light)
```css
background: #FFFFFF;
border-radius: 6px;
padding: 13px 16px;
height: 48px;
color: #232323;
```

#### Button — Destructive
```css
background: #FFFFFF;
color: #FF453A;
```

#### Button states
- **Pressing**: add `rgba(0, 0, 0, 0.12)` overlay
- **Unavailable**: add `rgba(255, 255, 255, 0.8)` overlay

#### List Item
```css
display: flex;
align-items: center;
padding: 16px;
gap: 16px;
height: 74px;
background: #FFFFFF;
border-radius: 6px; /* optional */
```
- Primary text: 15px / weight 400 / `#232323`
- Subtitle text: 13px / weight 400 / `#7B7B7B`

#### Nav Header
```css
display: flex;
justify-content: space-between;
align-items: center;
padding: 14px 12px;
height: 52px;
background: #EEEEEE;
```

#### Pop-up / Sheet
```css
background: #EEEEEE;
border-radius: 6px 6px 0 0;
box-shadow: 0px -4px 12px rgba(0, 0, 0, 0.12);
```

#### Search Bar fill
```css
background: rgba(35, 35, 35, 0.08);
border-radius: 6px;
height: 36px;
```

### CSS Variables (add to glasses app root)
```css
:root {
  /* Text colors */
  --tc-primary:   #232323;
  --tc-secondary: #7B7B7B;
  --tc-white:     #FFFFFF;
  --tc-red:       #FF453A;
  --tc-green:     #4BB956;

  /* Background colors */
  --bc-app:       #F6F6F6;
  --bc-surface:   #EEEEEE;
  --bc-white:     #FFFFFF;
  --bc-subtle:    #E4E4E4;
  --bc-black:     #232323;
  --bc-highlight: #FEF991;

  /* Overlays */
  --sc-overlay:     rgba(0, 0, 0, 0.5);
  --sc-pressing:    rgba(0, 0, 0, 0.12);
  --sc-tint:        rgba(35, 35, 35, 0.08);
  --sc-unavailable: rgba(255, 255, 255, 0.8);

  /* Utility */
  --divider: #BDBDBD;

  /* Typography */
  --font-family:    'FK Grotesk Neue', sans-serif;
  --font-weight-ui: 400;
  --font-weight-display: 300;
  --spacing-ui:     -0.01em;
  --spacing-display: -0.05em;
}

body {
  background: var(--bc-app);
  color: var(--tc-primary);
  font-family: var(--font-family);
}
```

## General Rules
- Do not use Next.js or SSR in the glasses app — it must be a plain Vite + TypeScript site
- The glasses display is **not** a rendered web page — do not write HTML/CSS expecting it to appear on the glasses
- All glasses UI is defined through `createStartUpPageContainer` / `rebuildPageContainer` — max 4 containers per page
- Image updates must be **serial** — await each `updateImageRawData` before sending the next
- Do not rely on localStorage for persistence — fetch data from the shared admin API
- Test every UI change in the Even Hub Simulator before considering it done
- Always use the design tokens above for colors and typography — do not introduce arbitrary colors or fonts
