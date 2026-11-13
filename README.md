# Smart Bunk Calculator

A college attendance manager built with plain **HTML, CSS and JavaScript**.
It shows your attendance percentage, how many classes you can safely bunk, and how many classes you must attend to get back to the required percentage, both overall and for each subject.

## Features

- **Dashboard**
  - A large ring gauge shows your attendance %, with a marker at your target.
  - A one-line headline tells you what to do, for example "You can bunk 6 more classes" or "Attend the next 28 classes".
  - Chips show the target, your margin above or below it, and attended/total.
  - Six stat cards, each with a short explanation underneath.
  - Warnings when you or any subject is below the target, plus an action plan.
  - An attended vs absent doughnut chart, and a subject bar chart. Click a bar to jump to that subject.
- **Attendance calculator**
  - Results update as you type.
  - Every number box has − / + buttons, and the target has quick presets (60–85%).
  - Inputs are validated, and attended classes can never be more than total classes.
  - A coloured verdict banner gives a clear answer: *Safe to bunk*, *No room to bunk*, *Do not bunk* or *Target not reachable*.
- **Calculate from subjects:** a switch that makes the overall totals equal the sum of your subjects, so marking Present or Absent updates everything.
- **Bunk calculator:** the maximum number of classes you can miss while staying at or above the target.
- **Recovery calculator:** how many classes in a row you must attend to reach the target.
- **Attendance projection chart:** how your % changes if you attend, or bunk, each upcoming class.
- **What-if planner:** see your attendance after attending X and bunking Y upcoming classes.
- **Subject-wise attendance**
  - Add, edit and delete subjects, each with its own mini gauge, progress bar and advice.
  - One-click **Present / Absent** buttons for daily tracking.
  - A summary strip (safe / at the limit / below target), search, and sorting.
  - The add/edit form shows a live preview of the result.
- **Undo:** after Present/Absent, Delete, Clear or Reset, a toast lets you undo the change.
- **Status bands:** Excellent (90%+), Good (75–89.99%), Low Attendance (65–74.99%), Critical (below 65%).
- **Custom target:** any value from 1% to 100% (up to 2 decimals).
- **Dark / light mode:** follows your system setting until you choose one.
- **Responsive design:** a sidebar on desktop, and a bottom navigation bar plus slide-in menu on phones.
- **Sample data, and a reset option with confirmation.**
- **LocalStorage**
  - Data survives a refresh, and the sidebar shows when it was last saved.
  - If the browser blocks storage, you see a warning.
  - Open tabs stay in sync with each other.
  - Broken or tampered saved data is ignored instead of crashing the app.

## Formulas

The target is used as a fraction here (75% = 0.75).

| What | Formula |
|---|---|
| Attendance % | `(Attended / Total) × 100` |
| Safe bunks | `floor(Attended / Target − Total)`, never below 0 |
| Classes to attend | `ceil((Target × Total − Attended) / (1 − Target))` |

**Edge cases handled**
- 0 classes conducted: shows 0% and "No Data". It does not divide by zero.
- Already below target: safe bunks are 0, and the app says clearly that no bunk is safe.
- Target 100% with at least one class missed: the target can never be reached again, so the app shows "N/A".
- Percentages are cut off to 2 decimals, never rounded up. 74.999% shows as 74.99%, not 75.00%.

To avoid floating-point mistakes (computers can't store 0.75 or 0.8 exactly), `script.js` turns the target into a whole number first (75% → 7500), so `floor` and `ceil` always give exact answers.

**Example:** 151 attended out of 195 with a 75% target gives 77.43%.
Safe bunks = floor(151 / 0.75 − 195) = floor(201.33 − 195) = **6**. After 6 bunks you have 151/201 = 75.12%.

## How to run

**Option 1: just open it**
Double-click `index.html`. It opens in your browser.

**Option 2: VS Code + Live Server (recommended)**
1. Open the project folder in VS Code (*File → Open Folder…*).
2. Install the **Live Server** extension (by Ritwick Dey) from the Extensions panel.
3. Right-click `index.html` and choose **Open with Live Server**.
4. The page reloads automatically every time you save a file.

> Charts use Chart.js from a CDN, so they need an internet connection. Everything else works offline. If Chart.js can't load, a message appears in place of the charts.

## Project files

```
Bunk-Calculator/
├── index.html   Page structure: sidebar, dashboard, calculator, subjects, modals
├── style.css    All styling: theme colours, dark mode, cards, animations, responsive layout
├── script.js    All logic: calculations, validation, LocalStorage, rendering, charts, events
└── README.md    This file
```

`script.js` has four parts:
1. **Calculations:** pure maths functions with no page access (`calcSafeBunks`, `calcRecoveryClasses`, `getStatus`, validation helpers).
2. **State + LocalStorage:** loading, checking and saving your data.
3. **Rendering:** draws the dashboard, calculator results, subject cards and charts from the saved data.
4. **Event handlers:** buttons, forms, navigation, modals and the theme toggle.

## Future improvements

- A different target for each subject (some colleges use different rules for labs).
- Timetable support: "you have 3 classes tomorrow, can you skip them?"
- A day-by-day attendance log, and a history chart over time.
- Export and import data as JSON or CSV, to back up or move between devices.
- Turn it into a PWA so it can be installed on a phone and used fully offline.
- Reminders or notifications when a subject falls close to the limit.
