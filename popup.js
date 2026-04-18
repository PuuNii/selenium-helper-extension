/**
 * popup.js — Selenium Helper v2
 *
 * Smart locator engine with tier-based scoring, async uniqueness checking,
 * quality badges, enhanced Java code generation, and GitHub attribution.
 */

'use strict';

// ============================================================
//  CONSTANTS
// ============================================================
const STORAGE_KEY_PENDING = 'seleniumHelperPendingElement';
const STORAGE_KEY_HISTORY = 'seleniumHelperHistory';
const MAX_HISTORY_ITEMS   = 10;
const GITHUB_URL          = 'https://github.com/PuuNii';

// ============================================================
//  STATE
// ============================================================
let currentElement = null;   // Full element data from content.js
let currentLocator = null;   // Active { type, value, score, status, cssQuery, displayLabel }
let locators       = [];     // All ranked locator options

// ============================================================
//  DOM REFERENCES
// ============================================================
const btnSelectElement    = document.getElementById('btnSelectElement');
const btnClear            = document.getElementById('btnClear');
const actionSelect        = document.getElementById('actionSelect');
const sendKeysGroup       = document.getElementById('sendKeysGroup');
const sendKeysInput       = document.getElementById('sendKeysInput');
const chkPageObject       = document.getElementById('chkPageObject');
const chkBasePage         = document.getElementById('chkBasePage');
const chkPageObjectWrapper= document.getElementById('chkPageObjectWrapper');
const chkBasePageWrapper  = document.getElementById('chkBasePageWrapper');
const codeArea            = document.getElementById('codeArea');
const btnCopyCode         = document.getElementById('btnCopyCode');
const locatorList         = document.getElementById('locatorList');
const locatorCountLabel   = document.getElementById('locatorCountLabel');
const historyList         = document.getElementById('historyList');
const btnClearHistory     = document.getElementById('btnClearHistory');
const svgWarning          = document.getElementById('svgWarning');
const svgWarningText      = document.getElementById('svgWarningText');
const toast               = document.getElementById('toast');
const modalOverlay        = document.getElementById('modalOverlay');
const modalErrorText      = document.getElementById('modalErrorText');
const btnCopyError        = document.getElementById('btnCopyError');
const btnModalOk          = document.getElementById('btnModalOk');
const githubBtn           = document.getElementById('githubBtn');

// ============================================================
//  INITIALISATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  checkPendingElement();
  setupEventListeners();
});

// ============================================================
//  EVENT LISTENERS
// ============================================================
function setupEventListeners() {

  btnSelectElement.addEventListener('click', startSelection);
  btnClear.addEventListener('click', clearSelection);

  actionSelect.addEventListener('change', () => {
    toggleSendKeysInput();
    regenerateCode();
  });

  sendKeysInput.addEventListener('input', regenerateCode);

  chkPageObject.addEventListener('change', () => {
    // BasePage forces PageObject — prevent unchecking while BasePage active
    if (!chkPageObject.checked && chkBasePage.checked) {
      chkPageObject.checked = true;
      return;
    }
    updateCheckboxStyles();
    regenerateCode();
  });

  chkBasePage.addEventListener('change', () => {
    if (chkBasePage.checked) chkPageObject.checked = true;
    updateCheckboxStyles();
    regenerateCode();
  });

  btnCopyCode.addEventListener('click', copyCode);
  btnClearHistory.addEventListener('click', clearHistory);

  btnCopyError.addEventListener('click', () => {
    const txt = modalErrorText.textContent;
    if (txt) navigator.clipboard.writeText(txt).then(showToast).catch(() => {});
  });

  btnModalOk.addEventListener('click', hideModal);

  githubBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: GITHUB_URL });
  });
}

// ============================================================
//  STORAGE CHANGE LISTENER (primary channel for element data)
// ============================================================
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY_PENDING]) {
    const newVal = changes[STORAGE_KEY_PENDING].newValue;
    if (newVal) {
      processElement(newVal);
      chrome.storage.local.remove(STORAGE_KEY_PENDING);
    }
  }
});

// ============================================================
//  RUNTIME MESSAGE LISTENER (secondary channel when popup open)
// ============================================================
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'ELEMENT_SELECTED' && msg.data) {
    processElement(msg.data);
    chrome.storage.local.remove(STORAGE_KEY_PENDING);
  }
  return false;
});

// ============================================================
//  CHECK FOR PENDING ELEMENT ON POPUP OPEN
// ============================================================
function checkPendingElement() {
  chrome.storage.local.get(STORAGE_KEY_PENDING, (result) => {
    const data = result[STORAGE_KEY_PENDING];
    if (data) {
      processElement(data);
      chrome.storage.local.remove(STORAGE_KEY_PENDING);
    }
  });
}

// ============================================================
//  START ELEMENT SELECTION
// ============================================================
async function startSelection() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      showError('Could not locate the active tab. Please try again.');
      return;
    }

    // Fire-and-forget: do NOT await response to avoid fake "message port closed" errors
    chrome.tabs.sendMessage(tabs[0].id, { type: 'START_SELECTION' }).catch(() => {});

    btnSelectElement.textContent = '⏳ Selecting…';
    btnSelectElement.disabled    = true;

  } catch (err) {
    showError(err.message || 'Failed to start element selection.');
    resetSelectButton();
  }
}

function resetSelectButton() {
  btnSelectElement.textContent = '▶ Select Element';
  btnSelectElement.disabled    = false;
}

// ============================================================
//  PROCESS A SELECTED ELEMENT  (async — runs uniqueness checks)
// ============================================================
async function processElement(data) {
  currentElement = data;
  resetSelectButton();
  hideSvgWarning();

  // Show SVG warning if element was originally SVG and was climbed
  if (data.isSvgElement) {
    showSvgWarning(data.climbedFrom || data.tag);
  }

  // Build initial candidate list synchronously
  const candidates = buildAllCandidates(data);

  // Show initial render while async uniqueness check runs
  locators       = candidates;
  currentLocator = locators[0] || null;
  renderLocators(false); // false = "checking" mode
  regenerateCode();

  // Run uniqueness checks asynchronously
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      await runUniquenessCheck(tabs[0].id, candidates);
    }
  } catch (_) {
    // Proceed without uniqueness data — not critical
  }

  // Re-rank after uniqueness data is in
  locators       = finalizeLocators(candidates);
  currentLocator = locators[0] || null;
  renderLocators(true);   // true = checks complete
  regenerateCode();

  addToHistory(data);
}

// ============================================================
//  SMART LOCATOR ENGINE
// ============================================================

/**
 * Build ALL possible locator candidates for the selected element.
 * Each candidate:
 *  {
 *    type:         string  — 'id' | 'testid' | 'testattr' | 'qa' | 'cy' |
 *                            'aria' | 'name' | 'placeholder' | 'title' |
 *                            'role' | 'css'
 *    value:        string  — raw attribute value (used to build By.xxx)
 *    cssQuery:     string  — CSS selector string for DOM uniqueness check
 *    score:        number  — initial 1–5 score
 *    status:       string  — quality badge key
 *    matchCount:   number|null — null until uniqueness check runs
 *    displayLabel: string  — human-readable type label in popup
 *  }
 */
function buildAllCandidates(el) {
  const candidates = [];

  /** Helper: push a candidate only if the value is non-empty */
  const add = (type, value, score, status, cssQuery, displayLabel) => {
    if (!value || !String(value).trim()) return;
    const v = String(value).trim();
    candidates.push({
      type,
      value:        v,
      cssQuery:     cssQuery  || null,
      score,
      status,
      matchCount:   null,
      displayLabel: displayLabel || type.toUpperCase(),
    });
  };

  // ── TIER 1: Automation-safe test attributes (score 5) ──────────────────
  if (el.dataTestId) add('testid', el.dataTestId, 5, 'test-ready',
    `[data-testid="${cssAttrEscape(el.dataTestId)}"]`, 'data-testid');

  if (el.dataTest)   add('testattr', el.dataTest, 5, 'test-ready',
    `[data-test="${cssAttrEscape(el.dataTest)}"]`, 'data-test');

  if (el.dataQa)     add('qa', el.dataQa, 5, 'test-ready',
    `[data-qa="${cssAttrEscape(el.dataQa)}"]`, 'data-qa');

  if (el.dataCy)     add('cy', el.dataCy, 5, 'test-ready',
    `[data-cy="${cssAttrEscape(el.dataCy)}"]`, 'data-cy');

  // ── Non-volatile unique ID (score 5 if clean, 1 if volatile) ───────────
  if (el.id) {
    if (!isVolatileId(el.id)) {
      add('id', el.id, 5, 'excellent', `#${cssIdEscape(el.id)}`, 'id');
    } else {
      add('id', el.id, 1, 'volatile', `#${cssIdEscape(el.id)}`, 'id (volatile)');
    }
  }

  // ── TIER 2: Semantic descriptive attributes (score 4) ──────────────────
  if (el.ariaLabel && !isGenericText(el.ariaLabel)) {
    add('aria', el.ariaLabel, 4, 'good',
      `[aria-label="${cssAttrEscape(el.ariaLabel)}"]`, 'aria-label');
  }

  if (el.name && !isGenericText(el.name)) {
    add('name', el.name, 4, 'good',
      `[name="${cssAttrEscape(el.name)}"]`, 'name');
  }

  if (el.placeholder && !isGenericText(el.placeholder)) {
    add('placeholder', el.placeholder, 4, 'good',
      `[placeholder="${cssAttrEscape(el.placeholder)}"]`, 'placeholder');
  }

  // Linked label text (for <label for="..."> associated inputs) — score 4
  if (el.linkedLabel && !isGenericText(el.linkedLabel)) {
    add('linkedLabel', el.linkedLabel, 4, 'good',
      `[id="${cssAttrEscape(el.id || '')}"]`, 'linked label');
  }

  // ── TIER 3: Supplementary attributes (score 3) ─────────────────────────
  if (el.title && !isGenericText(el.title)) {
    add('title', el.title, 3, 'acceptable',
      `[title="${cssAttrEscape(el.title)}"]`, 'title');
  }

  if (el.role && el.role !== 'presentation' && el.role !== 'none') {
    add('role', el.role, 3, 'acceptable',
      `[role="${cssAttrEscape(el.role)}"]`, 'role');
  }

  // ── Smart CSS combinations ─────────────────────────────────────────────
  const smartCss = buildSmartCss(el);
  smartCss.forEach((s) => {
    add('css', s.value, s.score, s.status, s.value, s.label);
  });

  // ── Tag fallback (always last resort, score 1) ─────────────────────────
  const tag = el.tag || 'div';
  if (!['svg', 'path', 'circle', 'rect', 'g'].includes(tag)) {
    add('css', tag, 1, 'weak', tag, 'tag (fallback)');
  }

  return candidates;
}

/**
 * Build smart CSS selector candidates from multiple strategies.
 * Returns array of { value, score, status, label } objects.
 */
function buildSmartCss(el) {
  const tag     = el.tag || '*';
  const results = [];

  const push = (value, score, status, label) => {
    results.push({ value, score, status, label });
  };

  // tag[type="submit"] — very specific for buttons/inputs
  if (el.type && (tag === 'input' || tag === 'button')) {
    const meaningfulTypes = ['submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'date', 'datetime-local', 'email', 'month', 'number', 'search', 'tel', 'time', 'url', 'week'];
    if (meaningfulTypes.includes(el.type)) {
      push(`${tag}[type="${el.type}"]`, 3, 'acceptable', `${tag}[type]`);
    }
  }

  // tag[placeholder="..."] — good for inputs
  if (el.placeholder && tag === 'input') {
    push(`input[placeholder="${cssAttrEscape(el.placeholder)}"]`, 3, 'acceptable', 'input[placeholder]');
  }

  // tag[aria-label="..."] — smart CSS alternative to aria strategy
  if (el.ariaLabel) {
    push(`${tag}[aria-label="${cssAttrEscape(el.ariaLabel)}"]`, 3, 'acceptable', `${tag}[aria-label]`);
  }

  // Parent > tag — if parent has a stable non-volatile ID
  if (el.parentId && !isVolatileId(el.parentId) && tag !== 'div' && tag !== 'span') {
    push(`#${cssIdEscape(el.parentId)} > ${tag}`, 2, 'acceptable', 'parent > child');
  }

  // Role-qualified CSS
  if (el.role && el.role !== 'presentation') {
    push(`${tag}[role="${el.role}"]`, 2, 'acceptable', `${tag}[role]`);
  }

  return results;
}

// ============================================================
//  UNIQUENESS CHECK  (async, runs in active tab page)
// ============================================================

/**
 * Executes CSS querySelectorAll for each candidate in the live page,
 * then updates each candidate's matchCount and status in-place.
 */
async function runUniquenessCheck(tabId, candidates) {
  // Build a simple list of CSS query strings in the same order as candidates
  const queries = candidates.map((c) => c.cssQuery || null);

  // Script that runs inside the active tab's main frame
  const pageScript = (queryList) => {
    return queryList.map((q) => {
      if (!q) return null;
      try {
        return document.querySelectorAll(q).length;
      } catch (e) {
        return -1; // invalid CSS
      }
    });
  };

  const results = await chrome.scripting.executeScript({
    target:  { tabId, allFrames: false },
    func:    pageScript,
    args:    [queries],
  });

  const counts = results && results[0] && results[0].result;
  if (!counts) return;

  // Update each candidate with real uniqueness data
  candidates.forEach((candidate, i) => {
    const count = counts[i];
    candidate.matchCount = count;

    // Test-ready attributes always keep their badge regardless
    if (['testid', 'testattr', 'qa', 'cy'].includes(candidate.type)) return;

    if (count === null)       { /* no query — keep initial status */ return; }
    if (count === -1)         { candidate.status = 'invalid'; candidate.score = 0; return; }
    if (count === 0)          { candidate.status = 'invalid'; candidate.score = 0; return; }
    if (count === 1) {
      // Unique — upgrade status based on original tier
      if (['excellent', 'good'].includes(candidate.status)) {
        // keep original excellent/good
      } else if (candidate.status === 'acceptable') {
        candidate.status = 'stable';  // acceptable + unique = stable
      } else if (candidate.status === 'weak') {
        candidate.status = 'unique';  // weak + unique = unique is fine
      } else {
        candidate.status = 'unique';
      }
      return;
    }
    if (count > 1) {
      // Not unique — downgrade
      candidate.status = 'multiple';
      candidate.score  = Math.max(1, candidate.score - 2);
    }
  });
}

/**
 * After uniqueness data is populated, sort and deduplicate candidates.
 * Returns a clean ranked list.
 */
function finalizeLocators(candidates) {
  // Remove invalid selectors
  const valid = candidates.filter((c) => c.status !== 'invalid' && c.score > 0);

  // Deduplicate: if two candidates have the exact same cssQuery, keep the one with higher score
  const seen = new Set();
  const deduped = valid.filter((c) => {
    const key = c.cssQuery || (c.type + ':' + c.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort: score descending, then by tier preference
  const tierOrder = ['test-ready', 'excellent', 'unique', 'good', 'stable', 'acceptable', 'multiple', 'weak', 'volatile'];
  deduped.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return tierOrder.indexOf(a.status) - tierOrder.indexOf(b.status);
  });

  return deduped;
}

// ============================================================
//  VOLATILE / GENERIC DETECTION HELPERS
// ============================================================

/** Returns true if the ID looks auto-generated / unstable. */
function isVolatileId(id) {
  if (!id) return true;
  const s = String(id);
  if (s.length <= 2)                            return true;  // too short
  if (/^\d+$/.test(s))                          return true;  // pure number
  if (/[a-f0-9]{8,}/i.test(s))                  return true;  // hash-like
  if (/\d{5,}/.test(s))                         return true;  // many digits
  if (/^(ng-|react-|ember-|vue-|_ng|auto)/.test(s)) return true; // framework prefix
  if (/^[a-z]{1,2}[0-9]{4,}$/i.test(s))        return true;  // e.g. a12345
  return false;
}

/** Returns true if the text is too generic to be a useful locator. */
function isGenericText(text) {
  if (!text) return true;
  const t = String(text).trim().toLowerCase();
  if (t.length <= 1)       return true;
  // Very short common words that aren't distinguishing
  const generic = new Set(['ok', 'go', 'x', 'no', 'yes', 'on', 'off', 'up', 'down', 'left', 'right', 'next', 'back']);
  if (generic.has(t))      return true;
  // Pure whitespace
  if (!t.replace(/\s/g, '')) return true;
  return false;
}

// ============================================================
//  RENDER LOCATORS LIST
// ============================================================

/**
 * Renders the locator items into the popup.
 * @param {boolean} checksComplete  — if false, show "checking" badge
 */
function renderLocators(checksComplete = true) {
  locatorList.innerHTML = '';
  locatorCountLabel.textContent = '';

  if (!locators || locators.length === 0) {
    locatorList.innerHTML = '<div class="locator-empty">No locators found</div>';
    return;
  }

  locatorCountLabel.textContent = `${locators.length} found`;

  locators.forEach((loc, idx) => {
    const isActive = (loc === currentLocator);
    const isBest   = (idx === 0);

    const item = document.createElement('div');
    item.className = 'locator-item' +
      (isActive ? ' active' : '') +
      (isBest   ? ' best-match' : '');

    // ── Top row: type badge + quality chip + stars ────────────────────
    const topRow = document.createElement('div');
    topRow.className = 'locator-item-top';

    // Type badge
    const typeBadge = document.createElement('span');
    typeBadge.className = 'locator-type-badge';
    typeBadge.textContent = escapeHtml(loc.displayLabel || loc.type);

    // Quality chip
    const qBadge = document.createElement('span');
    const status = checksComplete ? loc.status : 'checking';
    qBadge.className = `quality-badge qb-${status}`;
    qBadge.textContent = qualityBadgeLabel(status, loc.matchCount);

    // Stars
    const stars = document.createElement('span');
    stars.className = 'locator-stars';
    stars.style.color = starsColor(loc.score);
    stars.textContent = renderStars(loc.score);

    topRow.appendChild(typeBadge);
    topRow.appendChild(qBadge);
    topRow.appendChild(stars);

    // ── Value preview row ─────────────────────────────────────────────
    const valueRow = document.createElement('div');
    valueRow.className = 'locator-value';
    valueRow.title     = loc.value;
    valueRow.textContent = loc.value;

    item.appendChild(topRow);
    item.appendChild(valueRow);

    // Click handler — make active, regenerate code
    item.addEventListener('click', () => {
      currentLocator = loc;
      renderLocators(checksComplete);
      regenerateCode();
    });

    locatorList.appendChild(item);
  });
}

/** Maps a status key to a display label string. */
function qualityBadgeLabel(status, count) {
  switch (status) {
    case 'test-ready':  return '⚡ Test-Ready';
    case 'excellent':   return '★ Excellent';
    case 'unique':      return '✓ Unique';
    case 'good':        return '✓ Good';
    case 'stable':      return '◎ Stable';
    case 'acceptable':  return '· Acceptable';
    case 'multiple':    return count != null ? `⚠ Multiple (${count})` : '⚠ Multiple';
    case 'weak':        return '⚠ Weak';
    case 'volatile':    return '✗ Volatile';
    case 'invalid':     return '✗ Invalid';
    case 'checking':    return '⟳ Checking…';
    default:            return '· Unknown';
  }
}

// ============================================================
//  STARS
// ============================================================
function renderStars(score) {
  const s = Math.max(0, Math.min(5, score));
  return '★'.repeat(s) + '☆'.repeat(5 - s);
}
function starsColor(score) {
  if (score >= 5) return '#22c55e';
  if (score >= 4) return '#84cc16';
  if (score >= 3) return '#eab308';
  if (score >= 2) return '#f97316';
  return '#ef4444';
}

// ============================================================
//  VARIABLE NAME GENERATION  (smart, semantic)
// ============================================================
function getVarName(el) {
  // Priority-ordered sources for the best semantic name
  const sources = [
    el.ariaLabel,
    el.placeholder,
    el.linkedLabel,
    el.title,
    (el.id && !isVolatileId(el.id)) ? el.id : null,
    el.name,
    el.dataTestId,
    el.dataTest,
    el.dataQa,
    el.dataCy,
    // Compose from tag + type
    buildTagTypeName(el),
    el.tag,
    'element',
  ];

  for (const src of sources) {
    if (!src) continue;
    const cleaned = toJavaCamelCase(String(src).trim());
    if (cleaned && cleaned !== 'element' && cleaned.length > 1) {
      return cleaned;
    }
  }
  return 'element';
}

/** Compose a name from tag + type, e.g. "submitButton", "checkboxInput" */
function buildTagTypeName(el) {
  const tag  = el.tag  || '';
  const type = el.type || '';
  if (!tag) return null;

  const meaningfulTypes = {
    submit: 'Submit', reset: 'Reset', checkbox: 'Checkbox',
    radio: 'Radio', file: 'File', range: 'Range',
    search: 'Search', email: 'Email', tel: 'Tel',
    number: 'Number', date: 'Date', password: 'Password',
  };
  if (type && meaningfulTypes[type]) {
    if (tag === 'input')  return `${meaningfulTypes[type]}Input`;
    if (tag === 'button') return `${meaningfulTypes[type]}Button`;
  }
  if (tag === 'select') return 'dropdown';
  if (tag === 'a')      return 'link';
  if (tag === 'img')    return 'image';
  return null;
}

function toJavaCamelCase(str) {
  if (!str) return 'element';
  const result = str
    .replace(/[^a-zA-Z0-9\s\-_]/g, ' ')
    .trim()
    .replace(/[\-_\s]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase())
    .replace(/[^a-zA-Z0-9]/g, '');
  return result || 'element';
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================
//  LOCATOR EXPRESSION BUILDERS
// ============================================================

/** Builds a Selenium By.xxx(...) expression for normal mode. */
function buildByLocator(loc) {
  switch (loc.type) {
    case 'id':          return `By.id("${escapeJava(loc.value)}")`;
    case 'name':        return `By.name("${escapeJava(loc.value)}")`;
    case 'testid':      return `By.cssSelector("[data-testid='${escapeJavaSingleQ(loc.value)}']")`;
    case 'testattr':    return `By.cssSelector("[data-test='${escapeJavaSingleQ(loc.value)}']")`;
    case 'qa':          return `By.cssSelector("[data-qa='${escapeJavaSingleQ(loc.value)}']")`;
    case 'cy':          return `By.cssSelector("[data-cy='${escapeJavaSingleQ(loc.value)}']")`;
    case 'aria':        return `By.cssSelector("[aria-label='${escapeJavaSingleQ(loc.value)}']")`;
    case 'placeholder': return `By.cssSelector("[placeholder='${escapeJavaSingleQ(loc.value)}']")`;
    case 'title':       return `By.cssSelector("[title='${escapeJavaSingleQ(loc.value)}']")`;
    case 'role':        return `By.cssSelector("[role='${escapeJavaSingleQ(loc.value)}']")`;
    case 'linkedLabel': return loc.cssQuery
      ? `By.cssSelector("${escapeJava(loc.cssQuery)}")`
      : `By.id("${escapeJava(loc.value)}")`;
    case 'css':         return `By.cssSelector("${escapeJava(loc.value)}")`;
    default:            return `By.cssSelector("${escapeJava(loc.value)}")`;
  }
}

/** Builds a @FindBy annotation for Page Object mode. */
function buildFindBy(loc) {
  switch (loc.type) {
    case 'id':          return `@FindBy(id = "${escapeJava(loc.value)}")`;
    case 'name':        return `@FindBy(name = "${escapeJava(loc.value)}")`;
    case 'testid':      return `@FindBy(css = "[data-testid='${escapeJavaSingleQ(loc.value)}']")`;
    case 'testattr':    return `@FindBy(css = "[data-test='${escapeJavaSingleQ(loc.value)}']")`;
    case 'qa':          return `@FindBy(css = "[data-qa='${escapeJavaSingleQ(loc.value)}']")`;
    case 'cy':          return `@FindBy(css = "[data-cy='${escapeJavaSingleQ(loc.value)}']")`;
    case 'aria':        return `@FindBy(css = "[aria-label='${escapeJavaSingleQ(loc.value)}']")`;
    case 'placeholder': return `@FindBy(css = "[placeholder='${escapeJavaSingleQ(loc.value)}']")`;
    case 'title':       return `@FindBy(css = "[title='${escapeJavaSingleQ(loc.value)}']")`;
    case 'role':        return `@FindBy(css = "[role='${escapeJavaSingleQ(loc.value)}']")`;
    case 'linkedLabel': return loc.cssQuery
      ? `@FindBy(css = "${escapeJava(loc.cssQuery)}")`
      : `@FindBy(id = "${escapeJava(loc.value)}")`;
    case 'css':         return `@FindBy(css = "${escapeJava(loc.value)}")`;
    default:            return `@FindBy(css = "${escapeJava(loc.value)}")`;
  }
}

// ============================================================
//  FRAME SWITCHING
// ============================================================
function buildFrameSwitch(framePath) {
  if (!framePath || framePath.length === 0) {
    return { before: [], after: [] };
  }
  const before = framePath.map((f) => {
    if (f.id)   return `driver.switchTo().frame("${escapeJava(f.id)}");`;
    if (f.name) return `driver.switchTo().frame("${escapeJava(f.name)}");`;
    return `driver.switchTo().frame(${f.index});`;
  });
  return { before, after: ['driver.switchTo().defaultContent();'] };
}

// ============================================================
//  CODE GENERATION
// ============================================================
function regenerateCode() {
  if (!currentElement || !currentLocator) {
    codeArea.innerHTML = '<span class="code-placeholder">// Select an element to generate code…</span>';
    return;
  }

  const action       = actionSelect.value;
  const sendKeysText = sendKeysInput.value.trim() || 'your text here';
  const isPageObject = chkPageObject.checked;
  const isBasePage   = chkBasePage.checked;

  const code = isPageObject
    ? generatePageObjectCode(currentElement, currentLocator, action, sendKeysText)
    : generateNormalCode    (currentElement, currentLocator, action, sendKeysText);

  codeArea.textContent = code;
}

// ─── Normal Selenium (driver.findElement) ─────────────────────
function generateNormalCode(el, loc, action, sendKeysText) {
  const varName = getVarName(el);
  const byStr   = buildByLocator(loc);
  const frame   = buildFrameSwitch(el.framePath);
  const lines   = [];

  if (frame.before.length) {
    frame.before.forEach((l) => lines.push(l));
    lines.push('');
  }

  switch (action) {
    case 'click':
      lines.push(`WebElement ${varName} = driver.findElement(${byStr});`);
      lines.push(`${varName}.click();`);
      break;
    case 'sendKeys':
      lines.push(`WebElement ${varName} = driver.findElement(${byStr});`);
      lines.push(`${varName}.sendKeys("${escapeJava(sendKeysText)}");`);
      break;
    case 'getText':
      lines.push(`WebElement ${varName} = driver.findElement(${byStr});`);
      lines.push(`String text = ${varName}.getText();`);
      break;
    case 'assertVisible':
      lines.push(`WebElement ${varName} = driver.findElement(${byStr});`);
      lines.push(`Assert.assertTrue(${varName}.isDisplayed());`);
      break;
    default:
      lines.push(`// Unknown action: ${action}`);
  }

  if (frame.after.length) {
    lines.push('');
    frame.after.forEach((l) => lines.push(l));
  }

  return lines.join('\n');
}

// ─── Page Object (@FindBy) ─────────────────────────────────────
function generatePageObjectCode(el, loc, action, sendKeysText) {
  const varName  = getVarName(el);
  const findBy   = buildFindBy(loc);
  const frame    = buildFrameSwitch(el.framePath);
  const hasFrame = frame.before.length > 0;
  const lines    = [];
  const body     = [];

  if (hasFrame) {
    frame.before.forEach((l) => body.push(`    ${l}`));
    body.push('');
  }

  let methodName;
  let returnType = 'void';

  switch (action) {
    case 'click':
      methodName = `click${capitalize(varName)}`;
      body.push(`    ${varName}.click();`);
      break;
    case 'sendKeys':
      methodName = `type${capitalize(varName)}`;
      body.push(`    ${varName}.sendKeys("${escapeJava(sendKeysText)}");`);
      break;
    case 'getText':
      methodName  = `get${capitalize(varName)}Text`;
      returnType  = 'String';
      body.push(`    return ${varName}.getText();`);
      break;
    case 'assertVisible':
      methodName = `assert${capitalize(varName)}IsVisible`;
      body.push(`    Assert.assertTrue(${varName}.isDisplayed());`);
      break;
    default:
      methodName = 'doAction';
      body.push(`    // Unknown action: ${action}`);
  }

  if (hasFrame) {
    body.push('');
    frame.after.forEach((l) => body.push(`    ${l}`));
  }

  lines.push(findBy);
  lines.push(`private WebElement ${varName};`);
  lines.push('');
  lines.push(`public ${returnType} ${methodName}() {`);
  body.forEach((l) => lines.push(l));
  lines.push('}');

  return lines.join('\n');
}

// ============================================================
//  SVG WARNING BANNER
// ============================================================
function showSvgWarning(climbedFrom) {
  svgWarningText.textContent =
    `SVG element detected (originally <${climbedFrom || 'svg'}>). ` +
    `The extension found the closest useful parent. ` +
    `Verify locators manually.`;
  svgWarning.classList.add('show');
}
function hideSvgWarning() {
  svgWarning.classList.remove('show');
}

// ============================================================
//  CHECKBOX UI
// ============================================================
function updateCheckboxStyles() {
  chkPageObjectWrapper.classList.toggle('checked', chkPageObject.checked);
  chkBasePageWrapper  .classList.toggle('checked', chkBasePage.checked);
}

// ============================================================
//  SEND KEYS TOGGLE
// ============================================================
function toggleSendKeysInput() {
  sendKeysGroup.classList.toggle('hidden', actionSelect.value !== 'sendKeys');
}

// ============================================================
//  CLEAR SELECTION
// ============================================================
function clearSelection() {
  currentElement = null;
  currentLocator = null;
  locators       = [];
  hideSvgWarning();
  codeArea.innerHTML = '<span class="code-placeholder">// Select an element to generate code…</span>';
  locatorList.innerHTML = '<div class="locator-empty">No element selected</div>';
  locatorCountLabel.textContent = '';
  resetSelectButton();
}

// ============================================================
//  COPY CODE
// ============================================================
function copyCode() {
  const code = codeArea.textContent;
  if (!code || code.startsWith('//')) return;
  navigator.clipboard.writeText(code)
    .then(showToast)
    .catch((err) => showError('Clipboard write failed: ' + (err.message || 'Unknown error')));
}

// ============================================================
//  HISTORY
// ============================================================
function loadHistory() {
  chrome.storage.local.get(STORAGE_KEY_HISTORY, (result) => {
    renderHistory(result[STORAGE_KEY_HISTORY] || []);
  });
}

function addToHistory(el) {
  chrome.storage.local.get(STORAGE_KEY_HISTORY, (result) => {
    let items = result[STORAGE_KEY_HISTORY] || [];
    const label = getHistoryLabel(el);
    items = items.filter((i) => getHistoryLabel(i) !== label);
    items.unshift(el);
    if (items.length > MAX_HISTORY_ITEMS) items = items.slice(0, MAX_HISTORY_ITEMS);
    chrome.storage.local.set({ [STORAGE_KEY_HISTORY]: items }, () => renderHistory(items));
  });
}

function clearHistory() {
  chrome.storage.local.remove(STORAGE_KEY_HISTORY, () => renderHistory([]));
}

function getHistoryLabel(el) {
  return el.id && !isVolatileId(el.id) ? el.id
       : el.dataTestId ? el.dataTestId
       : el.ariaLabel  ? el.ariaLabel
       : el.name       ? el.name
       : el.tag        ? el.tag
       : 'element';
}

function renderHistory(items) {
  historyList.innerHTML = '';
  if (!items || items.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No history yet</div>';
    return;
  }
  items.forEach((el) => {
    const label    = getHistoryLabel(el);
    const hasFrame = el.framePath && el.framePath.length > 0;
    const item     = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML =
      `<span class="history-tag">&lt;${escapeHtml(el.tag || '?')}&gt;</span>` +
      `<span class="history-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>` +
      (hasFrame ? `<span class="history-frame-tag">iframe</span>` : '');
    item.addEventListener('click', () => processElement(el));
    historyList.appendChild(item);
  });
}

// ============================================================
//  TOAST
// ============================================================
let toastTimer = null;
function showToast() {
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastTimer = null;
  }, 1500);
}

// ============================================================
//  ERROR MODAL
// ============================================================
const BENIGN_ERRORS = [
  'Receiving end does not exist',
  'The message port closed before a response was received',
  'Could not establish connection',
  'Extension context invalidated',
];

function showError(message) {
  if (!message) return;
  if (BENIGN_ERRORS.some((p) => message.includes(p))) return;
  modalErrorText.textContent = message;
  modalOverlay.classList.add('show');
}
function hideModal() {
  modalOverlay.classList.remove('show');
}

// ============================================================
//  UTILITIES
// ============================================================

/** Escape a string for safe HTML insertion. */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escape a string for use in a Java double-quoted string literal. */
function escapeJava(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/** Escape a string for use in a Java single-quoted CSS attribute value. */
function escapeJavaSingleQ(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/\\/g, '\\\\');
}

/** Escape a string for a CSS attribute selector value (double-quoted). */
function cssAttrEscape(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape an ID for use in a CSS ID selector (#...). */
function cssIdEscape(id) {
  if (!id) return '';
  // Escape characters that have meaning in CSS selectors
  return String(id).replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}
