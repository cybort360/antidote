---
name: ANTIDOTE
description: Causal recovery for poisoned AI memory.
colors:
  prussian-night: "#070b12"
  field: "#0b1220"
  surface: "#132136"
  command-blue: "#4b91d1"
  contamination-red: "#ff6957"
  simulation-amber: "#efad62"
  evidence-white: "#f2f6f9"
  secondary-evidence: "#c2cfdd"
  quiet-evidence: "#8595a8"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(52px, 8.1vw, 134px)"
    fontWeight: 800
    lineHeight: 0.82
    letterSpacing: "-0.068em"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(27px, 3.2vw, 47px)"
    fontWeight: 700
    lineHeight: 0.94
    letterSpacing: "-0.047em"
  section-display:
    fontFamily: "Barlow Condensed, Arial Narrow, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(46px, 5.8vw, 92px)"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.045em"
  body:
    fontFamily: "Barlow Condensed, Arial Narrow, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "9px"
    fontWeight: 600
    letterSpacing: "0.14em"
rounded:
  none: "0"
spacing:
  compact: "8px"
  standard: "16px"
  section: "32px"
  canvas: "clamp(22px, 5vw, 78px)"
components:
  button-primary:
    backgroundColor: "{colors.command-blue}"
    textColor: "{colors.prussian-night}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.evidence-white}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
---

# Design System: ANTIDOTE

## Overview

**Creative North Star: "The Containment Console"**

ANTIDOTE looks like an active incident instrument, not a generic security dashboard. Giant condensed statements establish consequence first. The causal topology, not decoration, then becomes the central visual object. Every surface remains scan-ready during an incident.

Prussian night, cold blue command signals, oxidized red contamination, warm amber simulation, and governed geometric forms hold the system together. The experience uses immersive editorial pacing while preserving the clarity required for a financial or security state transition.

**Key Characteristics:**

- Oversized stacked display type for consequential statements only.
- Ruled geometry and live SVG topology instead of decorative illustration.
- Flat, bordered evidence fields with zero-radius forms.
- Cold blue denotes trusted runtime, technical focus, and committed action. Red denotes contamination. Amber denotes a dry-run simulation.
- Motion represents a real graph or lifecycle state and respects reduced-motion preferences.

## Colors

The palette is a dark operational field with a single high-energy command color. Color always conveys trust, threat, simulation, or evidence hierarchy.

### Primary

- **Command Blue:** Used for trusted runtime, selected commands, active navigation, topology signals, and the primary call to action.

### Secondary

- **Contamination Red:** Used for suspect memory, threat status, and compromised causal influence.

### Tertiary

- **Simulation Amber:** Used only for non-mutating blast-radius previews and review states.

### Neutral

- **Prussian Night:** The primary page ground and deep reading field.
- **Field:** The inner topology and inspector ground.
- **Evidence White:** Main copy and critical labels.
- **Secondary Evidence:** Supporting body copy.
- **Quiet Evidence:** Metadata, timestamps, and low-priority system context.

### Named Rules

**The Meaningful Signal Rule.** Blue, red, and amber are state colors. Do not use them as generic decoration or spread them evenly through a screen.

## Typography

**Display Font:** Barlow Condensed, bundled locally in `public/fonts`, with narrow sans fallbacks.
**Body Font:** Barlow Condensed, with narrow sans fallbacks.
**Label/Mono Font:** SFMono-Regular, Consolas, Liberation Mono, monospace.

**Character:** Condensed display type gives recovery statements urgency without reducing the supporting evidence to a theatrical visual. The monospace layer belongs only to identifiers, status labels, measurements, and timestamps.

### Hierarchy

- **Display** (800, `clamp(52px, 8.1vw, 134px)`, 0.82): Hero statements and rare decisive phrases.
- **Headline** (700, `clamp(27px, 3.2vw, 47px)`, 0.94): View titles and recovery controls.
- **Title** (700, 31px, 0.93): Inspector and documentation section titles.
- **Body** (400, 15px, 1.55): Evidence explanation and operational copy.
- **Label** (600, 9px, `0.14em`, uppercase): State, route, telemetry, and measurement labels.

### Named Rules

**The Evidence Hierarchy Rule.** Display type earns attention for one consequence at a time. Supporting evidence remains compact, readable, and never competes with the active action.

## Layout

The shell uses an edge-aware wide canvas rather than a centered card stack. Desktop opens with a statement and live telemetry, then reveals the case rail and topology at the same scroll position. The topology and inspector form a two-column instrument. Narrow screens stack the wordmark, compact navigation, recovery statement, telemetry, topology, and inspector in that order.

Content uses a compact 8px base rhythm, 16px standard internal spacing, 32px section spacing, and responsive canvas padding. The topology preserves its SVG proportions and scrolls horizontally on small screens instead of compressing causal labels into illegibility.

## Elevation & Depth

The system is flat by default. Borders, tonal fields, and deliberate negative space separate surfaces. The hero has a restrained radial field to locate the containment geometry. There are no floating cards and no ambient shadows.

### Named Rules

**The No Floating Evidence Rule.** Evidence surfaces use a rule, a tonal shift, or both. Do not place a soft shadow under a forensic object.

## Shapes

Squares, diamonds, circles, and strict one-pixel rules form the containment language. Most controls, tags, panels, inputs, and tables use zero radius. The sole circular geometry belongs to blast-radius and containment visualization. Node shapes remain semantic: square source, circle memory, diamond derived memory, hexagonal agent, pill decision, and triangle action.

## Components

### Buttons

- **Shape:** Square corners with a 45px minimum height.
- **Primary:** Command-blue field or bordered blue wash with Prussian-night text on active fill. Reserved for executing recovery, running the scenario, and starting the developer quickstart.
- **Hover / Focus:** Ghost actions receive a command-blue border and subtle tonal wash. Focus uses a 2px command-blue outline with 4px offset.
- **Ghost:** Transparent field, evidence-white text, and a rule border for non-destructive actions.

### Chips

- **Style:** Transparent field, 1px rule, square corners, compact evidence text.
- **State:** Chips classify related artifacts and never compete with lifecycle badges.

### Cards / Containers

- **Corner Style:** Square corners.
- **Background:** Prussian night, field, or a command-blue-tinted operational field.
- **Shadow Strategy:** None.
- **Border:** 1px evidence rule.
- **Internal Padding:** 18px to 28px, based on density.

### Inputs / Fields

- **Style:** Prussian-night field, evidence rule, square corners, monospace content for candidate memory text.
- **Focus:** Command-blue border.
- **Error / Disabled:** Contamination red communicates risk. Disabled controls lower opacity without changing their semantic color.

### Navigation

- **Style:** Small mono labels with a one-pixel command-blue active rule.
- **State:** Hover and active labels use evidence white. The active underline grows from the left.
- **Mobile:** Compact, single-row route labels with section numerals removed to protect available width.

### Causal Topology

The topology is a live semantic SVG, not a background illustration. Each node remains keyboard-operable and exposes kind, label, lifecycle status, and blast-radius state. Animated edges express active contamination only. Repair stages changes by actual graph depth.

### Landing Story Scene

The landing page is a Persuade surface leading into the operational case map. A Canvas 2D causal field visualizes one root memory, its agent retrievals, downstream decision, and external action. A red pulse communicates active influence. The primary containment control turns the field blue and moves the pulse backward to communicate revocation. The scene is visually complete before animation begins and is not required to understand the product or reach the functional map.

The landing scene responds softly to pointer position. Its requestAnimationFrame loop runs only while the scene is visible, the document is visible, and reduced motion is not enabled. The DOM copy, controls, and status state always remain available.

### Developer Field Guide

The root route is the developer onboarding surface. Its first viewport pairs a direct integration promise with a causal instrument showing source, memory, decision, and action around one governed record. The guide then follows the real adoption sequence: architecture, local install, REST integration, recovery, production setup, verification, and public deployment boundaries. A top-right command opens the operational case at `/case`. Documentation stays in the footer rather than competing with the live-case views.

Code panels use a deep Prussian-night field, one-pixel evidence rules, horizontal overflow, and copy controls with explicit labels. Status rails distinguish working local behavior, private deployment configuration, and planned SDK or platform work. The page must never present planned authentication, tenant isolation, or re-evaluation callbacks as shipped behavior.

The developer guide uses scroll-entry reveals only when the browser supports view timelines. The causal instrument, flow signals, and footer path remain understandable as static geometry. Reduced-motion mode removes every repeating or entry animation.

## Do's and Don'ts

### Do:

- **Do** use display type for one high-stakes message, then yield space to evidence.
- **Do** make the causal graph, inspector, and recovery action present without relying on motion.
- **Do** reserve command blue for trusted runtime and intentional command moments.
- **Do** use actual lifecycle colors and labels from the product vocabulary.
- **Do** retain horizontal graph overflow on narrow screens when it preserves evidence readability.

### Don't:

- **Don't** use generic dashboard card walls, rounded floating modules, neon glows, or decorative glass.
- **Don't** use color as an ungrounded visual accent. State colors must retain their meaning.
- **Don't** replace the live topology with a static illustration or a fake recovery animation.
- **Don't** let immersive motion obscure an action, a warning, a status, or the details required for audit.
