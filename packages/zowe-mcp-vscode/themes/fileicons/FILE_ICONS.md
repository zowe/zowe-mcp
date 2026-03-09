# Zowe File Icon Theme – Review & Design

## Current Style (Zowe)

All icons use the same **document shape** as VS Code’s default file icon (page + folded corner), adapted for Zowe:

- **Dark theme**: Document fill `#525456`, fold `#5e6164` (visible on sidebar `#3d3f42`).
- **Light theme**: Document fill `#dddee0`, fold `#c7c9cc`.
- **Accent**: A colored bar (rect, 6,6 → 20×3, rx 0.5) + optional label (e.g. COB, JCL, PY, JSON).
- **Label**: Centered text below the bar; dark theme `#f3f4f4`, light `#0d0d0e`. Short abbreviations (2–4 chars) for readability at 16–32px.

This keeps a consistent “Zowe document” look while differing by color and label (inspired by Seti/VS Code semantics).

## Icon Palette (Accent Colors)

| Type        | Dark     | Light    | Label |
|------------|----------|----------|--------|
| **Mainframe** |          |          |        |
| COBOL      | `#3975d0` | `#3162ac` | COB   |
| JCL        | `#c17a3a` | `#b86e2a` | JCL   |
| PL/I       | `#16825d` | `#16825d` | PL/I  |
| Assembler  | `#97cf46` | `#97cf46` | ASM   |
| Copybook   | `#1b375f` | `#1b375f` | cpy   |
| REXX       | `#e0182d` | `#e0182d` | (logo) |
| **Languages / Data** | | | |
| Java       | `#e37933` | `#cc6d2e` | J     |
| Python     | `#3776ab` | `#2d5a87` | PY    |
| Go         | `#00add8` | `#0096b8` | GO    |
| JSON       | `#cbcb41` | `#b7b73b` | JSON  |
| YAML       | `#a074c4` | `#9068b0` | YML   |
| Shell      | `#8dc149` | `#7fae42` | SH    |
| JavaScript | `#cbcb41` | `#b7b73b` | JS    |
| TypeScript | `#519aba` | `#3975d0` | TS    |
| HTML       | `#e37933` | `#cc6d2e` | HTML  |
| CSS        | `#519aba` | `#3975d0` | CSS   |
| Markdown   | `#519aba` | `#3975d0` | MD    |
| Config     | `#6d7176` | `#55585c` | CFG   |
| XML        | `#6d7176` | `#55585c` | XML   |
| Log        | `#6d7176` | `#55585c` | LOG   |
| Dockerfile | `#0db7ed` | `#0996e0` | DK    |
| Makefile   | `#8dc149` | `#7fae42` | MK    |
| **Generic** |          |          |        |
| Document   | (no bar)  | (no bar)  | —     |

Colors align with VS Code/Seti semantics (e.g. Java orange, Python blue, Go cyan, JSON/JS yellow, YAML purple) and Zowe palette where applicable.

## Suggestions Applied

1. **Visibility**: Dark icons use lighter document/fold fills (`#525456` / `#5e6164`) so they stand out on the Zowe dark sidebar.
2. **Distinct mainframe icons**: COBOL (blue), JCL (amber), PL/I (teal), ASM (green), Copybook (dark blue), REXX (red).
3. **New Zowe-styled icons**: Java, Python, Go, JSON, YAML, Shell, JavaScript, TypeScript, HTML, CSS, Markdown, Config — same document + bar + label pattern.
4. **Config group**: `.ini`, `.cfg`, `.conf`, `.config`, `.toml`, `.env`, `.properties` and name `.env` use the shared “CFG” config icon.
5. **README → Markdown**: `README` (no extension) uses the Markdown icon.
6. **XML/XSD**: Dedicated XML icon (gray bar, XML label) for `.xml` and `.xsd` files.
7. **Log**: Dedicated LOG icon (gray bar) for `.log` files.
8. **Dockerfile / Makefile**: Dedicated DK (Docker blue) and MK (green) icons for `Dockerfile` and `Makefile` file names.

## File icon design guidelines

When adding or changing icons in this theme:

- **Labels**: Prefer 2–3 character abbreviations (e.g. COB, PY, TS) or a single symbol (e.g. `<>`, `{ }`). Long labels (e.g. "HTML", "JSON") can overflow at 16px; use a symbol or shorter text.
- **Font**: Use consistent `font-size` (10–12) and `font-weight="700"` across all text labels. Use `font-family="system-ui, monospace, sans-serif"` for symbol-like text (`<>`, `{ }`).
- **Alignment**: Center the label in the document area: `x="16"` (viewBox width 32), `y="21"` or `y="22"`, `text-anchor="middle"`.
- **Contrast**: Label fill must contrast with the document body — `#f3f4f4` (dark theme) or `#0d0d0e` (light theme). On a colored bar, ensure text is readable (dark text on yellow bars, e.g. JSON/JS).
- **No thin strokes**: Avoid stroke-based shapes that become invisible at 16px; use filled paths or text.
- **Consistency**: Keep the same document shape, bar dimensions (6,6 → 20×3, rx 0.5), and layout for every icon so the set reads as one theme.
