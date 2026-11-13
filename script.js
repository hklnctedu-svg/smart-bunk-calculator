/* ==========================================================
   SMART BUNK CALCULATOR - MAIN SCRIPT
   ----------------------------------------------------------
   PART 1: Calculation functions (pure maths, no DOM)
   PART 2: App state + LocalStorage
   PART 3: Rendering (dashboard, calculator, subjects, charts)
   PART 4: Event handlers
   ========================================================== */


/* ==========================================================
   PART 1: CALCULATIONS
   ----------------------------------------------------------
   These functions only take numbers and return numbers, so
   they are easy to test. They are written in simple "var /
   function" style on purpose.

   Why "basis points"?
   Decimals like 0.75 are not always stored exactly by
   computers, which can make floor()/ceil() give an answer
   that is off by one. So we convert the target percentage
   into a whole number first: 75%  -> 7500,  75.5% -> 7550.
   With whole numbers the results are always exact.
   ========================================================== */
// ===== CALCULATIONS START =====

var MAX_CLASSES = 100000; // sensible upper limit for inputs

/** Converts a target like 75 or 75.5 into basis points (7500 / 7550). */
function toBasisPoints(targetPercent) {
  return Math.round(targetPercent * 100);
}

/** Attendance % = (Attended / Total) x 100. Returns 0 when no classes. */
function calcPercentage(attended, total) {
  if (total <= 0) return 0;
  return (attended * 100) / total;
}

/**
 * Formats a percentage with 2 decimals.
 * We cut off (truncate) instead of rounding, so 74.999% shows as
 * "74.99%" and never pretends to have reached 75%.
 */
function formatPercent(attended, total) {
  if (total <= 0) return '0.00%';
  var hundredths = Math.floor((attended * 10000) / total); // e.g. 7499
  return (hundredths / 100).toFixed(2) + '%';
}

/**
 * Difference between the shown percentage and the target, in hundredths
 * of a percent. 77.43% with a 75% target -> 243 (= +2.43 points).
 * Uses the same truncation as formatPercent so the numbers always agree.
 */
function calcMarginHundredths(attended, total, targetPercent) {
  if (total <= 0) return 0;
  return Math.floor((attended * 10000) / total) - toBasisPoints(targetPercent);
}

/** True if attendance is at or above the target. */
function meetsTarget(attended, total, targetPercent) {
  return attended * 10000 >= toBasisPoints(targetPercent) * total;
}

/**
 * Safe bunks = floor((Attended / Target) - Total), never below 0.
 * Rewritten with whole numbers:
 *   floor((Attended x 10000 - T x Total) / T)   where T = target in basis points
 */
function calcSafeBunks(attended, total, targetPercent) {
  var t = toBasisPoints(targetPercent);
  if (t <= 0) return 0; // target is always validated to be >= 1, this is a safety net
  var bunks = Math.floor((attended * 10000 - t * total) / t);
  return bunks > 0 ? bunks : 0;
}

/**
 * Classes to attend in a row = ceil((Target x Total - Attended) / (1 - Target)).
 * Rewritten with whole numbers:
 *   ceil((T x Total - Attended x 10000) / (10000 - T))
 * Returns 0 if the target is already met.
 * Returns Infinity if the target is 100% and a class was already missed
 * (100% can never be reached again in that case).
 */
function calcRecoveryClasses(attended, total, targetPercent) {
  var t = toBasisPoints(targetPercent);
  if (meetsTarget(attended, total, targetPercent)) return 0;
  if (t >= 10000) return Infinity;
  return Math.ceil((t * total - attended * 10000) / (10000 - t));
}

/**
 * Attendance status using the fixed bands:
 *   >= 90 Excellent | 75-89.99 Good | 65-74.99 Low | < 65 Critical
 * Comparisons use whole numbers (attended x 100 >= 90 x total) so
 * the boundaries are exact.
 */
function getStatus(attended, total) {
  if (total <= 0) return { key: 'none', label: 'No Data' };
  var a = attended * 100;
  if (a >= 90 * total) return { key: 'excellent', label: 'Excellent' };
  if (a >= 75 * total) return { key: 'good', label: 'Good' };
  if (a >= 65 * total) return { key: 'low', label: 'Low Attendance' };
  return { key: 'critical', label: 'Critical' };
}

/**
 * Validates a class count typed by the user.
 * Returns { value: number } or { error: 'message' }.
 * An empty box counts as 0 when allowEmpty is true.
 */
function validateCount(raw, label, allowEmpty) {
  var text = String(raw === null || raw === undefined ? '' : raw).replace(/^\s+|\s+$/g, '');
  if (text === '') {
    return allowEmpty ? { value: 0 } : { error: label + ' is required.' };
  }
  if (!/^\d+$/.test(text)) {
    return { error: label + ' must be a whole number (0 or more).' };
  }
  var n = parseInt(text, 10);
  if (n > MAX_CLASSES) {
    return { error: label + ' cannot be more than ' + MAX_CLASSES + '.' };
  }
  return { value: n };
}

/** Validates total + attended together (attended can't exceed total). */
function validateClasses(totalRaw, attendedRaw) {
  var total = validateCount(totalRaw, 'Total classes', true);
  var attended = validateCount(attendedRaw, 'Attended classes', true);
  var errors = { total: total.error || '', attended: attended.error || '' };

  if (!errors.total && !errors.attended && attended.value > total.value) {
    errors.attended = 'Attended classes cannot be more than total classes (' + total.value + ').';
  }
  var ok = !errors.total && !errors.attended;
  return { ok: ok, total: total.value, attended: attended.value, errors: errors };
}

/** Validates the required percentage: 1 to 100, max 2 decimal places. */
function validateTarget(raw) {
  var text = String(raw === null || raw === undefined ? '' : raw).replace(/^\s+|\s+$/g, '');
  if (text === '') return { error: 'Required attendance is required.' };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) {
    return { error: 'Enter a number like 75 or 75.5 (up to 2 decimals).' };
  }
  var n = parseFloat(text);
  if (n < 1 || n > 100) return { error: 'Required attendance must be between 1 and 100.' };
  return { value: n };
}

// ===== CALCULATIONS END =====


/* ==========================================================
   PART 2: APP STATE + LOCALSTORAGE
   ========================================================== */

const STORAGE_KEY = 'smartBunkCalculator.v1';

/** Returns a fresh, empty state object. */
function createDefaultState() {
  return {
    overall: { total: 0, attended: 0, target: 75 },
    subjects: [],     // { id, name, total, attended }
    autoSync: false,  // true = overall totals are the sum of all subjects
    theme: null,      // 'light' | 'dark' | null (null = follow the system)
    updatedAt: null   // time of the last save (milliseconds)
  };
}

/** Checks that a stored count pair is valid. */
function isValidPair(total, attended) {
  return Number.isInteger(total) && Number.isInteger(attended) &&
         total >= 0 && attended >= 0 && attended <= total && total <= MAX_CLASSES;
}

/**
 * Loads saved data from LocalStorage.
 * Anything broken or tampered with is ignored so the app never crashes.
 */
function loadState() {
  const state = createDefaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return state;

    const o = saved.overall || {};
    if (isValidPair(o.total, o.attended)) {
      state.overall.total = o.total;
      state.overall.attended = o.attended;
    }
    if (!validateTarget(o.target).error) state.overall.target = Number(o.target);

    if (Array.isArray(saved.subjects)) {
      state.subjects = saved.subjects.filter(s =>
        s && typeof s.id === 'string' && typeof s.name === 'string' &&
        s.name.trim() !== '' && isValidPair(s.total, s.attended)
      );
    }
    state.autoSync = saved.autoSync === true;
    if (saved.theme === 'light' || saved.theme === 'dark') state.theme = saved.theme;
    if (typeof saved.updatedAt === 'number') state.updatedAt = saved.updatedAt;
  } catch (err) {
    console.warn('Could not read saved data, starting fresh.', err);
  }
  return state;
}

/** Checks once whether the browser lets us use LocalStorage at all. */
function isStorageAvailable() {
  try {
    const key = STORAGE_KEY + '.test';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch (err) {
    return false;
  }
}

/** Saves the whole state to LocalStorage. Returns true on success. */
function saveState() {
  state.updatedAt = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    lastSaveFailed = false;
    return true;
  } catch (err) {
    lastSaveFailed = true;
    showToast('Could not save data (storage may be full or blocked).', 'error');
    return false;
  }
}

/** When "Calculate from subjects" is on, overall = sum of all subjects. */
function applyAutoSync() {
  if (!state.autoSync) return;
  state.overall.total = state.subjects.reduce((sum, s) => sum + s.total, 0);
  state.overall.attended = state.subjects.reduce((sum, s) => sum + s.attended, 0);
}

/**
 * The one place every data change goes through:
 * keep overall in sync -> save -> redraw everything.
 */
function commit() {
  applyAutoSync();
  saveState();
  renderAll();
}

/** A copy of the data, used for "Undo". */
function takeSnapshot() {
  return JSON.stringify({ overall: state.overall, subjects: state.subjects, autoSync: state.autoSync });
}

function restoreSnapshot(snapshot) {
  const data = JSON.parse(snapshot);
  state.overall = data.overall;
  state.subjects = data.subjects;
  state.autoSync = data.autoSync;
  calcInputsInvalid = false;
  commit();
  fillCalculatorInputs();
  showToast('Change undone.');
}

let lastSaveFailed = false;
let state = loadState();
let charts = { doughnut: null, subjects: null, projection: null };
let editingSubjectId = null;   // null = adding a new subject
let confirmAction = null;      // function to run when "Yes" is clicked in the confirm modal
let calcInputsInvalid = false; // true while the calculator form shows an error
let subjectQuery = '';         // subject search text
let subjectSort = 'added';     // subject sort order

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 68; // ring radius in the SVG is 68


/* ==========================================================
   PART 3: RENDERING
   ========================================================== */

/** Short helper for document.getElementById */
const $ = (id) => document.getElementById(id);

/** Prevents subject names from being treated as HTML (security). */
function escapeHTML(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** "1 class", "3 classes" */
function plural(n, word) {
  return n + ' ' + (n === 1 ? word : word + (word.endsWith('s') ? 'es' : 's'));
}

/** Width for progress bars: always between 0% and 100%. */
function barWidth(attended, total) {
  return Math.min(100, Math.max(0, calcPercentage(attended, total))) + '%';
}

/** Applies a status colour class (excellent/good/low/critical/none) to an element. */
function setStatusClass(el, key) {
  el.classList.remove('excellent', 'good', 'low', 'critical', 'none');
  el.classList.add(key);
}

/** "+2.43%" / "-1.20%" margin text for the hero chip. */
function formatMargin(attended, total, target) {
  if (total <= 0) return '--';
  const diff = calcMarginHundredths(attended, total, target);
  return (diff >= 0 ? '+' : '-') + (Math.abs(diff) / 100).toFixed(2) + '%';
}

/** Updates an SVG ring gauge (fill length + target tick). */
function setGauge(fillEl, targetEl, attended, total, target, statusKey) {
  const pct = Math.min(100, calcPercentage(attended, total));
  fillEl.style.strokeDashoffset = GAUGE_CIRCUMFERENCE * (1 - pct / 100);
  setStatusClass(fillEl, statusKey);
  targetEl.style.transform = `rotate(${target * 3.6}deg)`;
}

/** Small ring gauge used on each subject card (built as an HTML string). */
function miniGaugeHTML(attended, total, target, statusKey) {
  const pct = Math.min(100, calcPercentage(attended, total));
  const offset = GAUGE_CIRCUMFERENCE * (1 - pct / 100);
  return `
    <div class="gauge gauge-sm" role="img" aria-label="${formatPercent(attended, total)} attendance">
      <svg viewBox="0 0 160 160">
        <circle class="gauge-track" cx="80" cy="80" r="68" />
        <circle class="gauge-fill ${statusKey}" cx="80" cy="80" r="68" style="stroke-dashoffset:${offset}" />
        <g class="gauge-target" style="transform:rotate(${target * 3.6}deg)"><line x1="142" y1="80" x2="158" y2="80" /></g>
      </svg>
      <div class="gauge-center"><span class="gauge-value">${Math.floor(pct)}%</span></div>
    </div>`;
}

/** Motivational messages for each status. One is picked per day. */
const MESSAGES = {
  none: ['Enter your attendance in the Calculator, or load sample data to explore.'],
  excellent: [
    'Outstanding! Your consistency is paying off.',
    'Top of the class attendance. Keep this streak alive!',
    'Excellent work. You have earned some breathing room.'
  ],
  good: [
    'Good going! Stay consistent and you will stay safe.',
    'You are in a healthy zone. Plan your bunks wisely.',
    'Nice work. A few more classes will push you to excellent.'
  ],
  low: [
    'Attendance is slipping. A few regular weeks will fix this.',
    'Time to focus. Every class you attend now counts double.',
    'You can turn this around. Start with the very next class.'
  ],
  critical: [
    'Critical zone. Attend every class until you recover.',
    'Do not give up. Consistent attendance from today will get you back.',
    'Talk to your teachers and attend every class this week.'
  ]
};

function pickMessage(key) {
  const list = MESSAGES[key] || MESSAGES.none;
  const dayNumber = Math.floor(Date.now() / 86400000); // changes once per day
  return list[dayNumber % list.length];
}

/** Re-draws everything. Called after any data change. */
function renderAll() {
  renderDashboard();
  renderCalculatorResults();
  renderPlanner();
  renderSubjects();
  renderCharts();
  renderSaveStatus();
}

/* ---------- Dashboard ---------- */
function renderDashboard() {
  const { total, attended, target } = state.overall;
  const absent = total - attended;
  const status = getStatus(attended, total);
  const bunks = calcSafeBunks(attended, total, target);
  const need = calcRecoveryClasses(attended, total, target);
  const meets = meetsTarget(attended, total, target);
  const percentText = formatPercent(attended, total);

  // Hero: gauge, headline, chips, progress bar
  $('heroPercent').textContent = percentText;
  setGauge($('heroGaugeFill'), $('heroGaugeTarget'), attended, total, target, status.key);
  $('heroGauge').setAttribute('aria-label', `Attendance ${percentText}, target ${target}%`);
  $('heroBadge').textContent = status.label;
  setStatusClass($('heroBadge'), status.key);

  let headline;
  if (total === 0) headline = "Let's set up your attendance";
  else if (need === Infinity) headline = `${target}% can't be reached any more`;
  else if (!meets) headline = `Attend the next ${plural(need, 'class')}`;
  else if (bunks > 0) headline = `You can bunk ${plural(bunks, 'more class')}`;
  else headline = "You're right at the limit";
  $('heroHeadline').textContent = headline;
  $('heroMessage').textContent = pickMessage(status.key);

  $('heroChipTarget').textContent = target + '%';
  $('heroChipMargin').textContent = formatMargin(attended, total, target);
  $('heroChipRatio').textContent = `${attended}/${total}`;

  $('heroProgress').style.width = barWidth(attended, total);
  setStatusClass($('heroProgress'), status.key);
  $('heroTarget').style.left = target + '%';
  $('heroProgressWrap').dataset.tip = total > 0 ? `${attended}/${total} attended · target ${target}%` : '';

  // Stat cards
  $('statTotal').textContent = total;
  $('statAttended').textContent = attended;
  $('statAttendedSub').textContent = total > 0 ? `${percentText} of classes` : 'no classes yet';
  $('statAbsent').textContent = absent;
  $('statAbsentSub').textContent = total > 0 ? `${formatPercent(absent, total)} of classes` : 'no classes yet';
  $('statPercent').textContent = percentText;
  $('statPercentSub').textContent = total > 0 ? status.label : 'No data yet';
  $('statBunks').textContent = total > 0 ? bunks : 0;
  $('statBunksSub').textContent =
    total === 0 ? 'add classes first' :
    need === Infinity ? 'target unreachable' :
    !meets ? `attend ${plural(need, 'class')} first` :
    bunks > 0 ? `before dropping below ${target}%` : 'no room to bunk';
  $('statTarget').textContent = target + '%';

  // Warnings (overall + subjects below target)
  const warnings = [];
  if (total > 0 && !meets) {
    warnings.push(need === Infinity
      ? `Your attendance is ${percentText}. A ${target}% target can't be reached any more because you have already missed ${plural(absent, 'class')}.`
      : `Your attendance (${percentText}) is below the required ${target}%. No bunks are safe. Attend the next <strong>${plural(need, 'class')}</strong> in a row to recover.`);
  }
  const lowSubjects = state.subjects.filter(s => s.total > 0 && !meetsTarget(s.attended, s.total, target));
  if (lowSubjects.length > 0) {
    warnings.push(`${plural(lowSubjects.length, 'subject')} below ${target}%: ` +
      lowSubjects.map(s => `<strong>${escapeHTML(s.name)}</strong>`).join(', ') + '.');
  }
  $('dashWarning').classList.toggle('hidden', warnings.length === 0);
  $('dashWarningText').innerHTML = warnings.join('<br>');

  // Action plan
  $('actionPlan').innerHTML = buildActionPlan().join('');
}

/** Builds the list of tips shown in "Your Action Plan". */
function buildActionPlan() {
  const { total, attended, target } = state.overall;
  const item = (type, icon, html) =>
    `<div class="plan-item ${type}"><svg class="icon"><use href="#${icon}"/></svg><div>${html}</div></div>`;
  const items = [];

  if (total === 0) {
    items.push(item('info', 'i-calc', 'Open the <strong>Calculator</strong> and enter your classes, or click <strong>Load Sample Data</strong> to try the app.'));
    return items;
  }

  if (meetsTarget(attended, total, target)) {
    const bunks = calcSafeBunks(attended, total, target);
    if (bunks > 0) {
      items.push(item('ok', 'i-coffee', `You can safely bunk <strong>${plural(bunks, 'class')}</strong> and still stay at or above ${target}%.`));
      items.push(item('info', 'i-trend', `If you bunk all ${bunks}, your attendance becomes <strong>${formatPercent(attended, total + bunks)}</strong>.`));
    } else {
      items.push(item('warn', 'i-alert', `You are right at the limit. Missing the next class drops you to <strong>${formatPercent(attended, total + 1)}</strong>, below ${target}%.`));
    }
  } else {
    const need = calcRecoveryClasses(attended, total, target);
    if (need === Infinity) {
      items.push(item('bad', 'i-alert', `A ${target}% target is no longer possible. Consider a realistic target in the Calculator.`));
    } else {
      items.push(item('bad', 'i-alert', `No bunks are safe. Attend the next <strong>${plural(need, 'class')}</strong> without missing any.`));
      items.push(item('ok', 'i-check', `After that, your attendance will be <strong>${formatPercent(attended + need, total + need)}</strong>.`));
    }
    items.push(item('warn', 'i-user-x', `Bunking one more class would drop you to <strong>${formatPercent(attended, total + 1)}</strong>.`));
  }

  // Lowest subject tip
  const withData = state.subjects.filter(s => s.total > 0);
  if (withData.length > 0) {
    const lowest = withData.reduce((low, s) =>
      s.attended * low.total < low.attended * s.total ? s : low); // compares percentages without division
    items.push(item('info', 'i-book', `Lowest subject: <strong>${escapeHTML(lowest.name)}</strong> at ${formatPercent(lowest.attended, lowest.total)}.`));
  }
  return items;
}

/* ---------- Calculator ---------- */

/** Reads an input. If the browser says the number is malformed (e.g. "12e"), return text that fails validation. */
function inputValue(id) {
  const el = $(id);
  return el.validity && el.validity.badInput ? 'invalid' : el.value;
}

/** Puts saved values into the calculator inputs and sets the auto-sync lock. */
function fillCalculatorInputs() {
  const { total, attended, target } = state.overall;
  const empty = total === 0 && attended === 0;
  $('inTotal').value = empty ? '' : total;
  $('inAttended').value = empty ? '' : attended;
  $('inTarget').value = target;
  calcInputsInvalid = false;
  clearCalcErrors();
  updateAutoSyncLock();
}

/** When auto-sync is on, the count inputs are locked (they follow subjects). */
function updateAutoSyncLock() {
  const locked = state.autoSync;
  $('autoSyncToggle').checked = locked;
  ['inTotal', 'inAttended'].forEach(id => { $(id).disabled = locked; });
  document.querySelectorAll('.step-btn[data-for="inTotal"], .step-btn[data-for="inAttended"]')
    .forEach(btn => { btn.disabled = locked; });
}

function clearCalcErrors() {
  ['Total', 'Attended', 'Target'].forEach(name => showFieldError('in' + name, 'err' + name, ''));
}

function showFieldError(inputId, errorId, message) {
  $(errorId).textContent = message || '';
  $(inputId).classList.toggle('invalid', Boolean(message));
}

/** Sets the coloured verdict banner under the results. */
function setVerdict(type, icon, title, html) {
  const box = $('resVerdict');
  box.classList.remove('ok', 'warn', 'bad', 'info');
  box.classList.add(type);
  $('resVerdictIcon').setAttribute('href', '#' + icon);
  $('resVerdictTitle').textContent = title;
  $('resExplain').innerHTML = html;
}

function renderCalculatorResults() {
  const { total, attended, target } = state.overall;

  // Keep the auto-synced inputs showing the live totals
  if (state.autoSync) {
    $('inTotal').value = total === 0 && attended === 0 ? '' : total;
    $('inAttended').value = total === 0 && attended === 0 ? '' : attended;
  }

  // Preset buttons: highlight the one matching the current target
  document.querySelectorAll('[data-target-preset]').forEach(btn =>
    btn.classList.toggle('active', Number(btn.dataset.targetPreset) === target));

  ['resBunksBox', 'resRecoveryBox'].forEach(id => $(id).classList.remove('ok', 'bad'));

  if (calcInputsInvalid) {
    // Inputs contain an error: don't show stale numbers
    $('resPercent').textContent = '--';
    $('resRatio').textContent = 'Waiting for valid input';
    $('resBadge').textContent = 'Check inputs';
    setStatusClass($('resBadge'), 'none');
    setGauge($('resGaugeFill'), $('resGaugeTarget'), 0, 0, target, 'none');
    $('resProgress').style.width = '0%';
    $('resProgressWrap').dataset.tip = '';
    $('resAbsent').textContent = '--';
    $('resBunks').textContent = '--';
    $('resRecovery').textContent = '--';
    setVerdict('warn', 'i-alert', 'Check your inputs', 'Fix the highlighted fields to see your results.');
    return;
  }

  const status = getStatus(attended, total);
  const bunks = calcSafeBunks(attended, total, target);
  const need = calcRecoveryClasses(attended, total, target);

  $('resPercent').textContent = formatPercent(attended, total);
  $('resRatio').textContent = `${attended} of ${plural(total, 'class')} attended`;
  $('resBadge').textContent = status.label;
  setStatusClass($('resBadge'), status.key);
  setGauge($('resGaugeFill'), $('resGaugeTarget'), attended, total, target, status.key);
  $('resProgress').style.width = barWidth(attended, total);
  setStatusClass($('resProgress'), status.key);
  $('resTarget').style.left = target + '%';
  $('resProgressWrap').dataset.tip = total > 0 ? `${formatPercent(attended, total)} now · target ${target}%` : '';
  $('resAbsent').textContent = total - attended;
  $('resBunks').textContent = total > 0 ? bunks : 0;
  $('resRecovery').textContent = need === Infinity ? 'N/A' : need;
  if (total > 0 && bunks > 0) $('resBunksBox').classList.add('ok');
  if (need > 0) $('resRecoveryBox').classList.add('bad');

  if (total === 0) {
    setVerdict('info', 'i-info', 'Enter your classes',
      'Type the number of classes conducted and attended to see your results.');
  } else if (need === Infinity) {
    setVerdict('bad', 'i-alert', 'Target not reachable',
      `A <strong>${target}%</strong> target is impossible once a class has been missed. Try a lower target.`);
  } else if (need > 0) {
    setVerdict('bad', 'i-alert', 'Do not bunk',
      `You are below ${target}%, so <strong>no bunk is safe</strong>. Attend <strong>${plural(need, 'class')}</strong> in a row ` +
      `to reach <strong>${formatPercent(attended + need, total + need)}</strong> (${attended + need}/${total + need}).`);
  } else if (bunks > 0) {
    setVerdict('ok', 'i-shield', `Safe to bunk ${plural(bunks, 'class')}`,
      `You can miss <strong>${plural(bunks, 'class')}</strong> and still have ` +
      `<strong>${formatPercent(attended, total + bunks)}</strong> (${attended}/${total + bunks}), meeting the ${target}% target.`);
  } else {
    setVerdict('warn', 'i-alert', 'No room to bunk',
      `You meet the ${target}% target, but missing one class drops you to <strong>${formatPercent(attended, total + 1)}</strong>.`);
  }
}

/** What-If planner: attendance after attending X and bunking Y more classes. */
function renderPlanner() {
  const { total, attended, target } = state.overall;
  const attendNext = validateCount(inputValue('inPlanAttend'), '"Attend next"', true);
  const bunkNext = validateCount(inputValue('inPlanBunk'), '"Bunk next"', true);
  const error = attendNext.error || bunkNext.error || '';

  $('errPlan').textContent = error;
  $('inPlanAttend').classList.toggle('invalid', Boolean(attendNext.error));
  $('inPlanBunk').classList.toggle('invalid', Boolean(bunkNext.error));
  if (error) {
    $('planResult').textContent = 'Fix the planner values to see a result.';
    return;
  }

  const newAttended = attended + attendNext.value;
  const newTotal = total + attendNext.value + bunkNext.value;
  if (newTotal === 0) {
    $('planResult').textContent = 'Enter some classes above to see your future attendance.';
    return;
  }

  const status = getStatus(newAttended, newTotal);
  const ok = meetsTarget(newAttended, newTotal, target);
  $('planResult').innerHTML =
    `New attendance: <strong>${formatPercent(newAttended, newTotal)}</strong> (${newAttended}/${newTotal})` +
    `<span class="badge ${status.key}">${status.label}</span>` +
    `<span class="badge ${ok ? 'excellent' : 'critical'}">${ok ? 'Meets' : 'Below'} ${target}%</span>`;
}

/* ---------- Subjects ---------- */

/** Works out the advice line for one subject. */
function subjectAdvice(s, target) {
  const bunks = calcSafeBunks(s.attended, s.total, target);
  const need = calcRecoveryClasses(s.attended, s.total, target);
  if (s.total === 0) return { type: '', icon: 'i-info', text: 'No classes yet. Use Present / Absent to start tracking.' };
  if (need === Infinity) return { type: 'bad', icon: 'i-alert', text: `${target}% is no longer reachable here.` };
  if (need > 0) return { type: 'bad', icon: 'i-alert', text: `No safe bunks. Attend the next ${plural(need, 'class')}.` };
  if (bunks > 0) return { type: 'ok', icon: 'i-shield', text: `You can safely bunk ${plural(bunks, 'class')}.` };
  return { type: 'warn', icon: 'i-alert', text: 'At the limit. Do not miss the next class.' };
}

/** Returns the subjects after applying search + sort (original list is not changed). */
function visibleSubjects() {
  const query = subjectQuery.trim().toLowerCase();
  const list = state.subjects.filter(s => s.name.toLowerCase().includes(query));
  // Compare percentages by cross-multiplying (no division). Empty subjects count as 0%.
  const pctCompare = (a, b) => a.attended * Math.max(b.total, 1) - b.attended * Math.max(a.total, 1);
  if (subjectSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  if (subjectSort === 'low') list.sort(pctCompare);
  if (subjectSort === 'high') list.sort((a, b) => pctCompare(b, a));
  return list;
}

function renderSubjects() {
  const target = state.overall.target;
  const hasSubjects = state.subjects.length > 0;
  $('subjectTargetLabel').textContent = target + '%';
  $('navSubjectCount').textContent = state.subjects.length;

  // Summary strip
  const advice = state.subjects.map(s => subjectAdvice(s, target).type);
  $('sumSubjects').textContent = state.subjects.length;
  $('sumSafe').textContent = advice.filter(t => t === 'ok').length;
  $('sumLimit').textContent = advice.filter(t => t === 'warn').length;
  $('sumBelow').textContent = advice.filter(t => t === 'bad').length;

  const list = visibleSubjects();
  const grid = $('subjectsGrid');
  $('subjectsEmpty').classList.toggle('hidden', hasSubjects);
  grid.classList.toggle('hidden', !hasSubjects);
  $('subjectsNoMatch').classList.toggle('hidden', !hasSubjects || list.length > 0);

  grid.innerHTML = list.map(s => {
    const id = escapeHTML(s.id);
    const name = escapeHTML(s.name);
    const status = getStatus(s.attended, s.total);
    const info = subjectAdvice(s, target);
    const tip = s.total > 0 ? `${s.attended}/${s.total} attended · target ${target}%` : '';

    return `
      <article class="card subject-card ${status.key}" data-card-id="${id}">
        <div class="subject-head">
          ${miniGaugeHTML(s.attended, s.total, target, status.key)}
          <div class="subject-title">
            <p class="subject-name">${name}</p>
            <p class="subject-meta">${formatPercent(s.attended, s.total)} &middot; ${s.attended}/${s.total} attended &middot; ${s.total - s.attended} absent</p>
            <span class="badge ${status.key}">${status.label}</span>
          </div>
        </div>
        <div class="progress" data-tip="${tip}">
          <div class="progress-fill ${status.key}" style="width:${barWidth(s.attended, s.total)}"></div>
          <div class="progress-target" style="left:${target}%"></div>
        </div>
        <p class="subject-info ${info.type}"><svg class="icon"><use href="#${info.icon}"/></svg>${info.text}</p>
        <div class="subject-actions">
          <button class="btn btn-present" data-action="present" data-id="${id}" title="Mark one class attended">
            <svg class="icon"><use href="#i-check"/></svg> Present
          </button>
          <button class="btn btn-absent" data-action="absent" data-id="${id}" title="Mark one class missed">
            <svg class="icon"><use href="#i-x"/></svg> Absent
          </button>
          <button class="btn btn-outline btn-icon-only" data-action="edit" data-id="${id}" title="Edit subject" aria-label="Edit ${name}">
            <svg class="icon"><use href="#i-edit"/></svg>
          </button>
          <button class="btn btn-outline btn-icon-only danger" data-action="delete" data-id="${id}" title="Delete subject" aria-label="Delete ${name}">
            <svg class="icon"><use href="#i-trash"/></svg>
          </button>
        </div>
      </article>`;
  }).join('');

  $('syncBtn').disabled = !hasSubjects || state.autoSync;
}

/** Opens the Subjects page and briefly highlights one subject card. */
function focusSubject(id) {
  subjectQuery = '';
  $('subjectSearch').value = '';
  renderSubjects();
  showView('subjects');
  const card = document.querySelector(`[data-card-id="${CSS.escape(id)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('highlight');
  void card.offsetWidth; // restart the animation
  card.classList.add('highlight');
}

/* ---------- Save status ---------- */
function renderSaveStatus() {
  const box = $('saveStatus');
  const failed = !storageOK || lastSaveFailed;
  box.classList.toggle('error', failed);
  if (failed) {
    $('saveStatusText').textContent = 'Not saved - storage blocked';
  } else if (state.updatedAt) {
    const time = new Date(state.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('saveStatusText').textContent = 'Saved in this browser · ' + time;
  } else {
    $('saveStatusText').textContent = 'Saved in this browser';
  }
}

/* ---------- Charts (Chart.js) ---------- */

/** Reads a CSS variable, so charts match light/dark mode. */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Draws a dashed vertical "Target" line on the subject bar chart. */
const targetLinePlugin = {
  id: 'targetLine',
  afterDatasetsDraw(chart, args, options) {
    const x = chart.scales.x.getPixelForValue(options.value);
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = options.color;
    ctx.fillStyle = options.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Target ' + options.value + '%', x, top - 6);
    ctx.restore();
  }
};

/** Creates a chart the first time, then just updates it afterwards. */
function upsertChart(key, canvasId, config) {
  if (charts[key]) {
    charts[key].data = config.data;
    charts[key].options = config.options;
    charts[key].update();
  } else {
    charts[key] = new Chart($(canvasId), config);
  }
}

function renderCharts() {
  // If Chart.js failed to load (e.g. offline), show a friendly message instead
  if (typeof Chart === 'undefined') {
    document.querySelectorAll('.chart-box').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.chart-fallback').forEach(el => el.classList.remove('hidden'));
    $('subjectChartEmpty').classList.add('hidden');
    $('projectionEmpty').classList.add('hidden');
    return;
  }

  const colors = {
    emerald: cssVar('--emerald'), red: cssVar('--red'), amber: cssVar('--amber'),
    royal: cssVar('--royal'), track: cssVar('--track'), text: cssVar('--text'),
    muted: cssVar('--text-muted'), border: cssVar('--border'), surface: cssVar('--surface')
  };
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';

  renderDoughnutChart(colors);
  renderSubjectChart(colors);
  renderProjectionChart(colors);
}

function renderDoughnutChart(colors) {
  const { total, attended } = state.overall;
  const hasData = total > 0;
  $('doughnutCenter').textContent = formatPercent(attended, total);

  upsertChart('doughnut', 'doughnutChart', {
    type: 'doughnut',
    data: {
      labels: ['Attended', 'Absent'],
      datasets: [{
        data: hasData ? [attended, total - attended] : [0, 1],
        backgroundColor: hasData ? [colors.emerald, colors.red] : [colors.track, colors.track],
        borderColor: colors.surface,
        borderWidth: 3,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { position: 'bottom', labels: { color: colors.muted, usePointStyle: true, padding: 16 } },
        tooltip: {
          enabled: hasData,
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} (${formatPercent(ctx.raw, total)})` }
        }
      }
    }
  });
}

function renderSubjectChart(colors) {
  const subjects = state.subjects;
  const target = state.overall.target;
  const box = $('subjectChartBox');
  const statusColor = { excellent: colors.emerald, good: colors.royal, low: colors.amber, critical: colors.red, none: colors.track };

  $('subjectChartEmpty').classList.toggle('hidden', subjects.length > 0);
  box.classList.toggle('hidden', subjects.length === 0);
  if (subjects.length === 0) return;

  // Taller chart when there are more subjects
  box.style.height = Math.max(200, subjects.length * 46 + 70) + 'px';

  upsertChart('subjects', 'subjectChart', {
    type: 'bar',
    plugins: [targetLinePlugin],
    data: {
      labels: subjects.map(s => s.name),
      datasets: [{
        label: 'Attendance %',
        data: subjects.map(s => Math.floor((s.attended * 10000) / Math.max(s.total, 1)) / 100),
        backgroundColor: subjects.map(s => statusColor[getStatus(s.attended, s.total).key]),
        borderRadius: 8,
        barThickness: 22
      }]
    },
    options: {
      indexAxis: 'y', // horizontal bars
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20, right: 12 } },
      scales: {
        x: { min: 0, max: 100, ticks: { color: colors.muted, callback: v => v + '%' }, grid: { color: colors.border } },
        y: { ticks: { color: colors.text }, grid: { display: false } }
      },
      // Clicking a bar opens that subject on the Subjects page
      onClick: (event, elements) => {
        if (elements.length > 0) focusSubject(state.subjects[elements[0].index].id);
      },
      onHover: (event, elements) => {
        event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const s = state.subjects[ctx.dataIndex];
              return ` ${formatPercent(s.attended, s.total)}  (${s.attended}/${s.total})`;
            },
            footer: () => 'Click to open'
          }
        },
        targetLine: { value: target, color: colors.text }
      }
    }
  });
}

/** Line chart: attendance if you attend (or bunk) each of the next N classes. */
function renderProjectionChart(colors) {
  const { total, attended, target } = state.overall;
  const box = $('projectionBox');
  const show = total > 0 && !calcInputsInvalid;
  box.classList.toggle('hidden', !show);
  $('projectionEmpty').classList.toggle('hidden', show);
  if (!show) return;

  // Look far enough ahead to show the interesting part (recovery point / bunk limit)
  const need = calcRecoveryClasses(attended, total, target);
  const bunks = calcSafeBunks(attended, total, target);
  const horizon = Math.min(60, Math.max(10, (need === Infinity ? 0 : need) + 5, bunks + 5));

  const steps = [];
  for (let k = 0; k <= horizon; k++) steps.push(k);
  const truncated = (a, t) => Math.floor((a * 10000) / t) / 100;

  upsertChart('projection', 'projectionChart', {
    type: 'line',
    data: {
      labels: steps.map(k => (k === 0 ? 'Now' : '+' + k)),
      datasets: [
        {
          label: 'If I attend every class',
          data: steps.map(k => truncated(attended + k, total + k)),
          borderColor: colors.emerald,
          backgroundColor: colors.emerald,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 5,
          borderWidth: 3
        },
        {
          label: 'If I bunk every class',
          data: steps.map(k => truncated(attended, total + k)),
          borderColor: colors.red,
          backgroundColor: colors.red,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 5,
          borderWidth: 3
        },
        {
          label: `Target ${target}%`,
          data: steps.map(() => target),
          borderColor: colors.muted,
          borderDash: [6, 5],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          title: { display: true, text: 'Upcoming classes', color: colors.muted },
          ticks: { color: colors.muted, maxTicksLimit: 12 },
          grid: { display: false }
        },
        y: {
          suggestedMin: Math.max(0, Math.floor(Math.min(truncated(attended, total + horizon), target) - 5)),
          max: 100,
          ticks: { color: colors.muted, callback: v => v + '%' },
          grid: { color: colors.border }
        }
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: colors.muted, usePointStyle: true, padding: 16 } },
        tooltip: {
          callbacks: {
            title: items => (items[0].dataIndex === 0 ? 'Right now' : `After ${plural(items[0].dataIndex, 'more class')}`),
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`
          }
        }
      }
    }
  });
}


/* ==========================================================
   PART 4: EVENT HANDLERS
   ========================================================== */

/* ---------- Navigation ---------- */
const VIEW_TITLES = {
  dashboard: ['Dashboard', 'Your attendance at a glance'],
  calculator: ['Attendance Calculator', 'Calculate percentage, safe bunks and recovery'],
  subjects: ['Subjects', 'Track attendance for each subject']
};

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('pageTitle').textContent = VIEW_TITLES[name][0];
  $('pageSubtitle').textContent = VIEW_TITLES[name][1];
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openSidebar() {
  $('sidebar').classList.add('open');
  $('overlay').classList.add('show');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('overlay').classList.remove('show');
}

/* ---------- Theme ---------- */
function applyTheme() {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = state.theme || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  $('themeIcon').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  state.theme = current === 'dark' ? 'light' : 'dark';
  saveState();
  applyTheme();
  renderCharts(); // re-colour charts
}

/* ---------- Calculator inputs ---------- */
function handleCalculatorInput() {
  const classes = validateClasses(inputValue('inTotal'), inputValue('inAttended'));
  const target = validateTarget(inputValue('inTarget'));

  // With auto-sync on, totals come from subjects, so only the target is checked
  const countErrors = state.autoSync ? { total: '', attended: '' } : classes.errors;
  showFieldError('inTotal', 'errTotal', countErrors.total);
  showFieldError('inAttended', 'errAttended', countErrors.attended);
  showFieldError('inTarget', 'errTarget', target.error);

  calcInputsInvalid = Boolean(countErrors.total || countErrors.attended || target.error);
  if (calcInputsInvalid) {
    renderCalculatorResults();
    renderCharts();
    return; // don't save invalid data
  }

  if (!state.autoSync) {
    state.overall.total = classes.total;
    state.overall.attended = classes.attended;
  }
  state.overall.target = target.value;
  commit();
}

/** The - / + buttons next to the calculator inputs. */
function handleStep(button) {
  const input = $(button.dataset.for);
  if (input.disabled) return;
  const step = Number(button.dataset.step);
  const current = parseFloat(input.value) || 0;
  let next = current + step;
  if (input.id === 'inTarget') {
    next = Math.min(100, Math.max(1, next));
  } else {
    next = Math.max(0, Math.round(next));
  }
  input.value = next;
  input.dispatchEvent(new Event('input')); // runs the normal validation + save
}

function handleAutoSyncToggle() {
  const on = $('autoSyncToggle').checked;
  if (on && state.subjects.length === 0) {
    $('autoSyncToggle').checked = false;
    showToast('Add at least one subject first.', 'error');
    return;
  }
  const subjectTotal = state.subjects.reduce((sum, s) => sum + s.total, 0);
  if (on && subjectTotal > MAX_CLASSES) {
    $('autoSyncToggle').checked = false;
    showToast('Subject totals are too large to combine.', 'error');
    return;
  }
  state.autoSync = on;
  commit();
  fillCalculatorInputs();
  showToast(on ? 'Overall attendance now follows your subjects.' : 'You can now enter overall totals manually.');
}

/** One-time fill of the calculator with the sum of all subjects. */
function syncFromSubjects() {
  if (state.subjects.length === 0) {
    showToast('Add at least one subject first.', 'error');
    return;
  }
  const total = state.subjects.reduce((sum, s) => sum + s.total, 0);
  const attended = state.subjects.reduce((sum, s) => sum + s.attended, 0);
  if (total > MAX_CLASSES) {
    showToast('Subject totals are too large to combine.', 'error');
    return;
  }
  state.overall.total = total;
  state.overall.attended = attended;
  commit();
  fillCalculatorInputs();
  showToast(`Overall set from ${plural(state.subjects.length, 'subject')}: ${attended}/${total}.`);
}

function clearCalculator() {
  const snapshot = takeSnapshot();
  state.autoSync = false; // clearing means "I want to type my own numbers"
  state.overall.total = 0;
  state.overall.attended = 0;
  commit();
  fillCalculatorInputs();
  showToast('Calculator cleared.', '', { label: 'Undo', onClick: () => restoreSnapshot(snapshot) });
}

/* ---------- Subject modal (add / edit) ---------- */
function openSubjectModal(id) {
  editingSubjectId = id || null;
  const subject = state.subjects.find(s => s.id === id);

  $('subjectModalTitle').textContent = subject ? 'Edit Subject' : 'Add Subject';
  $('subjectSaveBtn').textContent = subject ? 'Save Changes' : 'Add Subject';
  $('inSubName').value = subject ? subject.name : '';
  $('inSubTotal').value = subject ? subject.total : '';
  $('inSubAttended').value = subject ? subject.attended : '';
  ['SubName', 'SubTotal', 'SubAttended'].forEach(n => showFieldError('in' + n, 'err' + n, ''));
  renderSubjectPreview();

  openModal('subjectModal');
  $('inSubName').focus();
}

/** Live preview inside the subject modal ("80.00% - Good - can bunk 2"). */
function renderSubjectPreview() {
  const classes = validateClasses(inputValue('inSubTotal'), inputValue('inSubAttended'));
  if (!classes.ok || classes.total === 0) {
    $('subPreview').textContent = '';
    return;
  }
  const target = state.overall.target;
  const status = getStatus(classes.attended, classes.total);
  const advice = subjectAdvice({ total: classes.total, attended: classes.attended }, target);
  $('subPreview').textContent = `${formatPercent(classes.attended, classes.total)} · ${status.label} · ${advice.text}`;
}

function handleSubjectSubmit(event) {
  event.preventDefault();

  const name = $('inSubName').value.trim().replace(/\s+/g, ' ');
  let nameError = '';
  if (name === '') {
    nameError = 'Subject name is required.';
  } else if (name.length > 40) {
    nameError = 'Keep the name under 40 characters.';
  } else if (state.subjects.some(s => s.id !== editingSubjectId && s.name.toLowerCase() === name.toLowerCase())) {
    nameError = 'A subject with this name already exists.';
  }

  const classes = validateClasses(inputValue('inSubTotal'), inputValue('inSubAttended'));
  showFieldError('inSubName', 'errSubName', nameError);
  showFieldError('inSubTotal', 'errSubTotal', classes.errors.total);
  showFieldError('inSubAttended', 'errSubAttended', classes.errors.attended);
  if (nameError || !classes.ok) return;

  if (editingSubjectId) {
    const subject = state.subjects.find(s => s.id === editingSubjectId);
    subject.name = name;
    subject.total = classes.total;
    subject.attended = classes.attended;
    showToast(`"${name}" updated.`);
  } else {
    state.subjects.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name,
      total: classes.total,
      attended: classes.attended
    });
    showToast(`"${name}" added.`);
  }

  closeModal('subjectModal');
  commit();
}

/** Handles Present / Absent / Edit / Delete buttons on subject cards. */
function handleSubjectAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const subject = state.subjects.find(s => s.id === button.dataset.id);
  if (!subject) return;
  const action = button.dataset.action;

  if (action === 'present' || action === 'absent') {
    if (subject.total >= MAX_CLASSES) {
      showToast('Maximum number of classes reached.', 'error');
      return;
    }
    const snapshot = takeSnapshot();
    subject.total += 1;
    if (action === 'present') subject.attended += 1;
    commit();
    showToast(`${subject.name}: marked ${action} (${formatPercent(subject.attended, subject.total)}).`, '',
      { label: 'Undo', onClick: () => restoreSnapshot(snapshot) });
  }

  if (action === 'edit') openSubjectModal(subject.id);

  if (action === 'delete') {
    openConfirm(
      'Delete subject?',
      `"${subject.name}" and its attendance will be removed.`,
      'Delete',
      () => {
        const snapshot = takeSnapshot();
        state.subjects = state.subjects.filter(s => s.id !== subject.id);
        commit();
        showToast(`"${subject.name}" deleted.`, '', { label: 'Undo', onClick: () => restoreSnapshot(snapshot) });
      }
    );
  }
}

/* ---------- Sample data & reset ---------- */
function loadSampleData() {
  const apply = () => {
    const sample = [
      ['Data Structures', 42, 38],
      ['Database Management', 40, 32],
      ['Operating Systems', 38, 27],
      ['Mathematics III', 45, 28],
      ['Web Technology', 30, 26]
    ];
    state.subjects = sample.map(([name, total, attended], i) => ({ id: 'sample' + i, name, total, attended }));
    state.overall.target = 75;
    state.autoSync = true; // overall = sum of the sample subjects
    commit();
    fillCalculatorInputs();
    showView('dashboard');
    showToast('Sample data loaded.');
  };

  const hasData = state.overall.total > 0 || state.subjects.length > 0;
  if (hasData) {
    openConfirm('Replace your data?', 'Loading sample data will replace your current attendance and subjects.', 'Load Sample', apply);
  } else {
    apply();
  }
}

function resetAllData() {
  openConfirm(
    'Reset all data?',
    'This deletes your attendance, target and all subjects from this browser.',
    'Reset Everything',
    () => {
      const snapshot = takeSnapshot();
      const theme = state.theme; // keep the user's theme choice
      state = createDefaultState();
      state.theme = theme;
      $('inPlanAttend').value = 0;
      $('inPlanBunk').value = 0;
      commit();
      fillCalculatorInputs();
      showToast('All data has been reset.', '', { label: 'Undo', onClick: () => restoreSnapshot(snapshot) });
    }
  );
}

/* ---------- Modals ---------- */
function openModal(id) {
  $(id).classList.remove('hidden');
}

function closeModal(id) {
  $(id).classList.add('hidden');
  if (id === 'confirmModal') confirmAction = null;
}

function openConfirm(title, text, okLabel, onConfirm) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  $('confirmOkBtn').textContent = okLabel;
  confirmAction = onConfirm;
  openModal('confirmModal');
  $('confirmOkBtn').focus();
}

/* ---------- Toasts ---------- */

/**
 * Shows a small message in the corner.
 * action (optional) = { label: 'Undo', onClick: function } adds a button.
 */
function showToast(message, type, action) {
  const toast = document.createElement('div');
  toast.className = 'toast' + (type === 'error' ? ' error' : '');
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  const remove = () => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 300);
  };

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { remove(); action.onClick(); }, { once: true });
    toast.appendChild(btn);
  }

  $('toasts').appendChild(toast);
  setTimeout(remove, action ? 5000 : 2600); // give more time when there's an Undo button
}

/* ---------- Wire everything up ---------- */
let storageOK = true;

function init() {
  storageOK = isStorageAvailable();
  $('storageWarning').classList.toggle('hidden', storageOK);

  applyTheme();
  fillCalculatorInputs();
  renderAll();

  // Chart.js measures label widths when a chart is created. If the Inter font
  // arrives later, rebuild the charts so long labels aren't cut off.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      Object.keys(charts).forEach(key => {
        if (charts[key]) { charts[key].destroy(); charts[key] = null; }
      });
      renderCharts();
    });
  }

  // Navigation (sidebar links + mobile bottom bar)
  document.querySelectorAll('[data-view]').forEach(btn =>
    btn.addEventListener('click', () => showView(btn.dataset.view)));
  $('menuBtn').addEventListener('click', openSidebar);
  $('overlay').addEventListener('click', closeSidebar);
  $('themeBtn').addEventListener('click', toggleTheme);

  // Generic buttons: [data-goto] switches view, [data-action] in empty state
  document.addEventListener('click', event => {
    const goto = event.target.closest('[data-goto]');
    if (goto) showView(goto.dataset.goto);

    const action = event.target.closest('#subjectsEmpty [data-action]');
    if (action && action.dataset.action === 'add-subject') openSubjectModal();
    if (action && action.dataset.action === 'load-sample') loadSampleData();
  });

  // Calculator
  ['inTotal', 'inAttended', 'inTarget'].forEach(id =>
    $(id).addEventListener('input', handleCalculatorInput));
  $('calcForm').addEventListener('submit', e => e.preventDefault());
  document.querySelectorAll('.step-btn').forEach(btn =>
    btn.addEventListener('click', () => handleStep(btn)));
  document.querySelectorAll('[data-target-preset]').forEach(btn =>
    btn.addEventListener('click', () => {
      $('inTarget').value = btn.dataset.targetPreset;
      $('inTarget').dispatchEvent(new Event('input'));
    }));
  $('autoSyncToggle').addEventListener('change', handleAutoSyncToggle);
  $('syncBtn').addEventListener('click', syncFromSubjects);
  $('clearCalcBtn').addEventListener('click', clearCalculator);
  $('inPlanAttend').addEventListener('input', renderPlanner);
  $('inPlanBunk').addEventListener('input', renderPlanner);

  // Subjects
  $('addSubjectBtn').addEventListener('click', () => openSubjectModal());
  $('subjectForm').addEventListener('submit', handleSubjectSubmit);
  $('subjectsGrid').addEventListener('click', handleSubjectAction);
  ['inSubTotal', 'inSubAttended'].forEach(id => $(id).addEventListener('input', renderSubjectPreview));
  $('subjectSearch').addEventListener('input', e => { subjectQuery = e.target.value; renderSubjects(); });
  $('subjectSort').addEventListener('change', e => { subjectSort = e.target.value; renderSubjects(); });

  // Sidebar actions
  $('sampleBtn').addEventListener('click', loadSampleData);
  $('resetBtn').addEventListener('click', resetAllData);

  // Modals: close buttons, click on dark backdrop, confirm button
  document.querySelectorAll('[data-close-modal]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.closest('.modal').id)));
  document.querySelectorAll('.modal').forEach(modal =>
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal.id); }));
  $('confirmOkBtn').addEventListener('click', () => {
    const action = confirmAction;
    closeModal('confirmModal');
    if (action) action();
  });

  // Escape key closes any open modal / the mobile menu
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal:not(.hidden)').forEach(m => closeModal(m.id));
    closeSidebar();
  });

  // Another tab changed the data: reload it so both tabs agree
  window.addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY) return;
    state = loadState();
    applyTheme();
    fillCalculatorInputs();
    renderAll();
  });

  // Follow the system theme if the user hasn't chosen one
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!state.theme) { applyTheme(); renderCharts(); }
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
