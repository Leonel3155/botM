# Discord Bot Management Dashboard - Design Guidelines

## Design Approach
**System:** Custom dashboard design system inspired by modern admin panels (Vercel, Railway, Linear) with user-specified black and yellow Dark Knight color scheme. Utility-focused with emphasis on data clarity and efficient navigation.

## Core Design Principles
1. **Information Hierarchy:** Clear visual separation between critical metrics, secondary data, and controls
2. **Scannable Data:** Dashboard optimized for quick information gathering
3. **Modular Expansion:** Architecture ready for additional feature sections
4. **Professional Restraint:** Clean, focused design without unnecessary decoration

## Color System
**Base Palette:**
- Primary Background: Pure black (#000000)
- Secondary Background: Dark gray (#111111, #1a1a1a for cards/panels)
- Accent/Primary Actions: Vibrant yellow (#FFD700, #FFC107)
- Text Primary: White/off-white (#FFFFFF, #F5F5F5)
- Text Secondary: Light gray (#A0A0A0)
- Borders/Dividers: Dark gray (#2a2a2a, #333333)
- Success: Green (#00FF00 tinted)
- Warning: Orange-yellow (#FFA500)
- Error: Red (#FF4444)

## Typography
**Font Stack:** 
- Primary: Inter or DM Sans (via Google Fonts CDN)
- Monospace: JetBrains Mono for data/stats

**Hierarchy:**
- Dashboard Title/Headers: 24-32px, semi-bold
- Section Headers: 18-20px, medium
- Stats Numbers: 28-36px, bold (monospace)
- Body Text: 14-16px, regular
- Labels/Meta: 12-14px, medium
- Stat Labels: 11-13px, uppercase, tracking-wide

## Layout System

**Spacing Primitives (Tailwind):** Use 2, 4, 6, 8, 12, 16 units
- Component padding: p-6, p-8
- Section gaps: gap-6, gap-8
- Card spacing: p-6
- Tight spacing: p-2, p-4

**Grid Structure:**
- Sidebar: Fixed 240-280px width
- Main content: Fluid with max-width constraints
- Stats grid: 2-4 columns responsive (grid-cols-1 md:grid-cols-2 lg:grid-cols-4)
- Content cards: max-w-7xl container

## Component Library

### Navigation
**Sidebar:**
- Fixed left position, full height
- Logo/bot name at top
- Navigation items with icons (Heroicons)
- Active state: yellow accent border-left
- User profile section at bottom
- Collapsible for mobile

### Dashboard Cards
**Stat Cards:**
- Large number display (monospace font)
- Label below number
- Icon in top-right corner
- Subtle border, dark background
- Yellow accent on hover

**Data Tables:**
- Striped rows (alternating dark backgrounds)
- Fixed header
- Monospace for numeric columns
- Action buttons in last column
- Yellow highlights for important rows

**Security Log Panel:**
- Timeline-style layout
- Timestamp + event description
- Color-coded severity indicators
- Scrollable with max-height

### Forms & Controls
**Inputs:**
- Dark background with lighter border
- Yellow focus ring
- Labels above fields
- Helper text below in gray

**Buttons:**
- Primary: Yellow background, black text, bold
- Secondary: Black background, yellow border
- Danger: Red background
- Icon buttons: Transparent with yellow on hover

### Status Indicators
- Online/Active: Yellow dot
- Offline/Inactive: Gray dot
- Warning: Orange dot
- Error: Red dot
- Include text label alongside dot

## Dashboard-Specific Patterns

### Overview Page Layout:
1. **Top Stats Row:** 4 key metrics (servers, users, uptime, memory)
2. **Activity Graph Section:** Line/area chart (Chart.js)
3. **Recent Events:** 2-column layout (security events | command logs)
4. **Quick Actions:** Card with common bot controls

### Security Page Layout:
1. **Security Score Widget:** Prominent display
2. **Recent Security Events:** Filterable table
3. **Failed Login Attempts:** Time-series chart
4. **Bot Status Health Checks:** Grid of status indicators

## Animations
**Minimal and purposeful only:**
- Hover transitions: 150ms ease
- Page transitions: None
- Loading states: Simple spinner (yellow)
- No scroll-triggered animations

## Icons
**Library:** Heroicons (outline style via CDN)
- Consistent 20-24px size
- Yellow color for active/important states
- Gray for inactive states

## Mock Data Display
Since bot doesn't exist yet:
- Display realistic placeholder statistics
- Use "Live in 2 hours" or similar status indicators
- Show example security events with timestamps
- Include "Waiting for bot connection" states where appropriate

## Authentication
**OAuth Login Page:**
- Centered card on black background
- Discord logo
- "Login with Discord" button (yellow)
- Simple, focused design

## Responsive Behavior
- Desktop (>1024px): Full sidebar, multi-column stats
- Tablet (768-1024px): Collapsed sidebar, 2-column stats
- Mobile (<768px): Hidden sidebar (hamburger menu), single column layout