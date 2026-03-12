/**
 * FinTrack – Frontend JavaScript
 * Handles all UI interactions, API calls, charting, and DOM updates.
 *
 * Sections:
 *  1. Constants & State
 *  2. Utility Helpers
 *  3. Tab Navigation
 *  4. Summary Cards
 *  5. Bar Chart (Category Spending)
 *  6. Monthly Summary Table
 *  7. Transaction History Table
 *  8. Add Transaction Form
 *  9. Budget Limits
 *  10. Delete Modal
 *  11. Toast Notifications
 *  12. App Initialization
 */

// ════════════════════════════════════════════════
// 1. CONSTANTS & STATE
// ════════════════════════════════════════════════

/** All valid expense categories (matches HTML selects) */
const EXPENSE_CATEGORIES = [
  'Food', 'Zomato/Swiggy', 'Transport', 'Ola/Uber',
  'Recharge', 'Rent', 'College Fees', 'Entertainment', 'Other'
];

/** Category emojis for the chart labels */
const CATEGORY_EMOJI = {
  'Food':          '🍽️',
  'Zomato/Swiggy': '🛵',
  'Transport':     '🚌',
  'Ola/Uber':      '🚗',
  'Recharge':      '📱',
  'Rent':          '🏠',
  'College Fees':  '🎓',
  'Entertainment': '🎬',
  'Salary':        '💼',
  'Freelance':     '💻',
  'Other':         '📦',
};

/** Holds the ID of the transaction pending deletion */
let pendingDeleteId = null;

/** Reference to the Chart.js instance so we can destroy/re-create it */
let categoryChart = null;


// ════════════════════════════════════════════════
// 2. UTILITY HELPERS
// ════════════════════════════════════════════════

/**
 * Formats a number as Indian Rupees.
 * e.g. formatINR(12500.5) → "₹12,500.50"
 */
function formatINR(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Formats a YYYY-MM date string to "March 2025" style.
 */
function formatMonth(yyyyMM) {
  const [year, month] = yyyyMM.split('-');
  const date = new Date(year, parseInt(month) - 1, 1);
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/**
 * Formats a YYYY-MM-DD date string to a readable format like "12 Mar 2025".
 */
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const date = new Date(y, parseInt(m) - 1, d);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Makes a fetch request to the given URL with optional options.
 * Returns parsed JSON or throws an error with the server's message.
 */
async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP error ${response.status}`);
  }
  return data;
}

/**
 * Escapes HTML special characters to prevent XSS when inserting user
 * content into the DOM via innerHTML.
 */
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// ════════════════════════════════════════════════
// 3. TAB NAVIGATION
// ════════════════════════════════════════════════

/**
 * Switches the visible tab to the one with the given name.
 * Updates the active class on buttons and shows the matching content panel.
 */
function switchTab(tabName) {
  // Update button states
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Update content panel visibility
  document.querySelectorAll('.tab-content').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-content-${tabName}`);
  });

  // Refresh data when switching to dashboard or history
  if (tabName === 'dashboard') {
    loadDashboard();
  } else if (tabName === 'history') {
    loadHistory();
  } else if (tabName === 'budget') {
    loadBudgetLimitsTable();
  }
}

/** Attaches click listeners to all tab buttons */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}


// ════════════════════════════════════════════════
// 4. SUMMARY CARDS
// ════════════════════════════════════════════════

/**
 * Fetches the financial summary from the API and updates the three cards.
 * Also adds a pulse animation to draw the user's eye to the updated values.
 */
async function loadSummaryCards() {
  try {
    const summary = await apiFetch('/api/summary');

    const incomeEl  = document.getElementById('total-income');
    const expenseEl = document.getElementById('total-expenses');
    const balanceEl = document.getElementById('current-balance');

    incomeEl.textContent  = formatINR(summary.total_income);
    expenseEl.textContent = formatINR(summary.total_expenses);
    balanceEl.textContent = formatINR(summary.balance);

    // Color the balance card based on positive/negative
    balanceEl.style.color = summary.balance >= 0
      ? 'var(--orange-400)'
      : 'var(--red-400)';

  } catch (err) {
    console.error('Failed to load summary:', err);
  }
}


// ════════════════════════════════════════════════
// 5. BAR CHART (CATEGORY SPENDING)
// ════════════════════════════════════════════════

/**
 * Fetches category-wise spending data and renders (or re-renders) the Chart.js
 * bar chart. Bars that exceed the budget limit are highlighted in red.
 * Also builds the over-budget warning banners.
 */
async function loadCategoryChart() {
  try {
    const data = await apiFetch('/api/category-spending');
    const warningsContainer = document.getElementById('budget-warnings');
    const chartEmpty = document.getElementById('chart-empty');
    const chartCanvas = document.getElementById('categoryChart');

    // Clear old warnings
    warningsContainer.innerHTML = '';
    warningsContainer.classList.add('hidden');

    if (data.length === 0) {
      // No expense data yet — show empty state
      chartEmpty.classList.remove('hidden');
      chartCanvas.classList.add('hidden');
      return;
    }

    chartEmpty.classList.add('hidden');
    chartCanvas.classList.remove('hidden');

    // Build warning banners for over-budget categories
    const overBudget = data.filter(d => d.over_budget);
    if (overBudget.length > 0) {
      warningsContainer.classList.remove('hidden');
      overBudget.forEach(item => {
        const banner = document.createElement('div');
        banner.className = 'warning-banner';
        banner.innerHTML = `
          ⚠️ <strong>${escapeHTML(item.category)}</strong> spending of
          ${formatINR(item.total)} exceeds your monthly limit of
          ${formatINR(item.limit)} by ${formatINR(item.total - item.limit)}!
        `;
        warningsContainer.appendChild(banner);
      });
    }

    // Prepare chart data
    const labels = data.map(d => (CATEGORY_EMOJI[d.category] || '📌') + ' ' + d.category);
    const amounts = data.map(d => d.total);

    // Bar colors: red for over-budget, orange otherwise
    const barColors = data.map(d =>
      d.over_budget
        ? 'rgba(239, 68, 68, 0.85)'     // Red
        : 'rgba(249, 115, 22, 0.85)'    // Orange
    );
    const borderColors = data.map(d =>
      d.over_budget ? '#ef4444' : '#f97316'
    );

    // Destroy the old chart instance before creating a new one
    if (categoryChart) {
      categoryChart.destroy();
      categoryChart = null;
    }

    const ctx = chartCanvas.getContext('2d');

    categoryChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Spending (₹)',
          data: amounts,
          backgroundColor: barColors,
          borderColor: borderColors,
          borderWidth: 2,
          borderRadius: 8,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#141c35',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#f1f5f9',
            bodyColor: '#94a3b8',
            padding: 12,
            callbacks: {
              // Custom tooltip: show rupee-formatted amount
              label: (ctx) => ` ${formatINR(ctx.parsed.y)}`,
              afterLabel: (ctx) => {
                const item = data[ctx.dataIndex];
                if (item.limit > 0) {
                  const pct = ((item.total / item.limit) * 100).toFixed(1);
                  return ` ${pct}% of ₹${item.limit.toLocaleString('en-IN')} limit`;
                }
                return '';
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', font: { size: 12 } },
            grid:  { color: 'rgba(255,255,255,0.04)' }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: '#94a3b8',
              font: { size: 12 },
              callback: (val) => '₹' + val.toLocaleString('en-IN')
            },
            grid: { color: 'rgba(255,255,255,0.06)' }
          }
        }
      }
    });

  } catch (err) {
    console.error('Failed to load chart:', err);
  }
}


// ════════════════════════════════════════════════
// 6. MONTHLY SUMMARY TABLE
// ════════════════════════════════════════════════

/**
 * Fetches monthly summary data and populates the monthly summary table.
 * Colors the net balance cell green or red based on sign.
 */
async function loadMonthlySummary() {
  try {
    const data = await apiFetch('/api/monthly-summary');
    const tbody = document.getElementById('monthly-tbody');
    const emptyEl = document.getElementById('monthly-empty');

    tbody.innerHTML = '';

    if (data.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');

    data.forEach(row => {
      const tr = document.createElement('tr');
      const isPositive = row.net_balance >= 0;

      tr.innerHTML = `
        <td><strong>${escapeHTML(formatMonth(row.month))}</strong></td>
        <td class="amount-income">${formatINR(row.total_income)}</td>
        <td class="amount-expense">${formatINR(row.total_expenses)}</td>
        <td class="${isPositive ? 'balance-positive' : 'balance-negative'}">
          ${isPositive ? '+' : ''}${formatINR(row.net_balance)}
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Failed to load monthly summary:', err);
  }
}


// ════════════════════════════════════════════════
// 7. TRANSACTION HISTORY TABLE
// ════════════════════════════════════════════════

/**
 * Fetches transactions (optionally filtered by date) and renders the history table.
 * Each row has a delete button that opens the confirmation modal.
 */
async function loadHistory(startDate = '', endDate = '') {
  try {
    let url = '/api/transactions';
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate)   params.append('end_date', endDate);
    if (params.toString()) url += '?' + params.toString();

    const data = await apiFetch(url);
    const tbody = document.getElementById('history-tbody');
    const emptyEl = document.getElementById('history-empty');

    tbody.innerHTML = '';

    if (data.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');

    data.forEach(tx => {
      const tr = document.createElement('tr');
      const isIncome = tx.type === 'Income';

      tr.innerHTML = `
        <td>${escapeHTML(formatDate(tx.date))}</td>
        <td>
          <span class="badge ${isIncome ? 'badge-income' : 'badge-expense'}">
            ${isIncome ? '📈' : '📉'} ${escapeHTML(tx.type)}
          </span>
        </td>
        <td>${(CATEGORY_EMOJI[tx.category] || '📌') + ' ' + escapeHTML(tx.category)}</td>
        <td class="${isIncome ? 'amount-income' : 'amount-expense'}">
          ${isIncome ? '+' : '-'}${formatINR(tx.amount)}
        </td>
        <td>${escapeHTML(tx.description || '—')}</td>
        <td class="note-cell" title="${escapeHTML(tx.note || '')}">${escapeHTML(tx.note || '—')}</td>
        <td>
          <button
            class="btn-icon"
            onclick="openDeleteModal(${tx.id})"
            title="Delete this transaction"
            id="delete-btn-${tx.id}"
          >🗑️ Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Failed to load history:', err);
    showToast('Failed to load transactions.', 'error');
  }
}

/**
 * Reads the date filter inputs and reloads the history table with those filters.
 */
function applyDateFilter() {
  const start = document.getElementById('filter-start').value;
  const end   = document.getElementById('filter-end').value;
  loadHistory(start, end);
}

/**
 * Clears both date filter inputs and reloads the full history.
 */
function clearDateFilter() {
  document.getElementById('filter-start').value = '';
  document.getElementById('filter-end').value   = '';
  loadHistory();
}


// ════════════════════════════════════════════════
// 8. ADD TRANSACTION FORM
// ════════════════════════════════════════════════

/**
 * Sets the date input to today's date by default (nice UX touch).
 */
function setDefaultDate() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('tx-date').value = today;
}

/**
 * Shows a feedback message inside the form (success or error).
 */
function showFormMessage(elementId, text, type) {
  const el = document.getElementById(elementId);
  el.textContent = text;
  el.className = `form-message ${type}`;
  el.classList.remove('hidden');

  // Auto-hide after 4 seconds
  setTimeout(() => el.classList.add('hidden'), 4000);
}

/**
 * Handles the Add Transaction form submission.
 * Collects form data, sends a POST request, and resets the form on success.
 */
async function handleTransactionSubmit(event) {
  event.preventDefault(); // Prevent default browser form submission

  const form = event.target;
  const btn  = document.getElementById('submit-btn');

  // Read values from form
  const payload = {
    amount:      parseFloat(document.getElementById('tx-amount').value),
    type:        document.getElementById('tx-type').value,
    category:    document.getElementById('tx-category').value,
    date:        document.getElementById('tx-date').value,
    description: document.getElementById('tx-description').value.trim(),
    note:        document.getElementById('tx-note').value.trim(),
  };

  // Client-side validation
  if (!payload.amount || payload.amount <= 0) {
    showFormMessage('form-message', '⚠️ Please enter a valid positive amount.', 'error');
    return;
  }
  if (!payload.type) {
    showFormMessage('form-message', '⚠️ Please select Income or Expense.', 'error');
    return;
  }
  if (!payload.category) {
    showFormMessage('form-message', '⚠️ Please select a category.', 'error');
    return;
  }
  if (!payload.date) {
    showFormMessage('form-message', '⚠️ Please select a date.', 'error');
    return;
  }

  // Disable button to prevent double submission
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Saving...';

  try {
    await apiFetch('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    // Success!
    showFormMessage('form-message', '✅ Transaction saved successfully!', 'success');
    form.reset();
    setDefaultDate(); // Reset date back to today

    showToast('💰 Transaction added!', 'success');

  } catch (err) {
    showFormMessage('form-message', `❌ Error: ${err.message}`, 'error');
  } finally {
    // Re-enable the submit button
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Save Transaction';
  }
}


// ════════════════════════════════════════════════
// 9. BUDGET LIMITS
// ════════════════════════════════════════════════

/**
 * Handles the Budget Limit form submission.
 * Sends a POST request to create or update the limit for a category.
 */
async function handleBudgetSubmit(event) {
  event.preventDefault();

  const btn = document.getElementById('budget-submit-btn');

  const payload = {
    category:     document.getElementById('budget-category').value,
    limit_amount: parseFloat(document.getElementById('budget-limit').value)
  };

  if (!payload.category) {
    showFormMessage('budget-message', '⚠️ Please select a category.', 'error');
    return;
  }
  if (isNaN(payload.limit_amount) || payload.limit_amount < 0) {
    showFormMessage('budget-message', '⚠️ Please enter a valid limit amount.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = '💾 Saving...';

  try {
    const result = await apiFetch('/api/budget-limits', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    showFormMessage('budget-message', '✅ ' + result.message, 'success');
    showToast('🎯 Budget limit updated!', 'success');
    event.target.reset();
    loadBudgetLimitsTable(); // Refresh the table below the form

  } catch (err) {
    showFormMessage('budget-message', `❌ Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save Budget Limit';
  }
}

/**
 * Loads the current budget limits alongside actual spending,
 * and renders the Budget Limits table (with status column).
 */
async function loadBudgetLimitsTable() {
  try {
    // Fetch both budget limits and category spending in parallel
    const [limits, spending] = await Promise.all([
      apiFetch('/api/budget-limits'),
      apiFetch('/api/category-spending')
    ]);

    const tbody    = document.getElementById('budget-limits-tbody');
    const emptyEl  = document.getElementById('budget-limits-empty');

    tbody.innerHTML = '';

    if (limits.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');

    // Build a lookup map: category → total spent
    const spendingMap = {};
    spending.forEach(s => { spendingMap[s.category] = s.total; });

    limits.forEach(lim => {
      const spent     = spendingMap[lim.category] || 0;
      const remaining = lim.limit_amount - spent;
      const isOver    = spent > lim.limit_amount;

      let statusBadge;
      if (isOver) {
        statusBadge = `<span class="badge badge-warning">⚠️ Over Budget</span>`;
      } else if (lim.limit_amount === 0) {
        statusBadge = `<span class="badge badge-noset">No Limit</span>`;
      } else {
        statusBadge = `<span class="badge badge-ok">✅ Within Limit</span>`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${(CATEGORY_EMOJI[lim.category] || '📌') + ' ' + escapeHTML(lim.category)}</td>
        <td>${formatINR(lim.limit_amount)}</td>
        <td class="${spent > 0 ? 'amount-expense' : ''}">${formatINR(spent)}</td>
        <td class="${remaining >= 0 ? 'balance-positive' : 'balance-negative'}">
          ${remaining >= 0 ? formatINR(remaining) : '–' + formatINR(Math.abs(remaining))}
        </td>
        <td>${statusBadge}</td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Failed to load budget limits table:', err);
  }
}


// ════════════════════════════════════════════════
// 10. DELETE MODAL
// ════════════════════════════════════════════════

/**
 * Opens the delete confirmation modal and stores the transaction ID.
 */
function openDeleteModal(transactionId) {
  pendingDeleteId = transactionId;
  document.getElementById('delete-modal').classList.remove('hidden');
}

/**
 * Closes the delete modal without doing anything.
 */
function closeDeleteModal() {
  pendingDeleteId = null;
  document.getElementById('delete-modal').classList.add('hidden');
}

/**
 * Confirms the deletion — sends DELETE request to the API and refreshes the table.
 */
async function confirmDelete() {
  if (!pendingDeleteId) return;

  const btn = document.getElementById('confirm-delete-btn');
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  try {
    await apiFetch(`/api/transactions/${pendingDeleteId}`, { method: 'DELETE' });

    closeDeleteModal();
    showToast('🗑️ Transaction deleted.', 'success');

    // Refresh both history and dashboard (since summary cards change)
    loadHistory(
      document.getElementById('filter-start').value,
      document.getElementById('filter-end').value
    );

  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
    closeDeleteModal();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Delete';
  }
}

// Close modal when clicking the overlay background
document.getElementById('delete-modal').addEventListener('click', function(e) {
  if (e.target === this) closeDeleteModal();
});


// ════════════════════════════════════════════════
// 11. TOAST NOTIFICATIONS
// ════════════════════════════════════════════════

/** Timer ID for auto-hiding the toast */
let toastTimer = null;

/**
 * Shows a brief toast notification at the bottom-right of the screen.
 * @param {string} message - The text to display.
 * @param {'success'|'error'} type - Controls the left border color.
 */
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');

  // Clear any existing timer and set a new one
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}


// ════════════════════════════════════════════════
// 12. DASHBOARD LOADER (combines all dashboard calls)
// ════════════════════════════════════════════════

/**
 * Loads all dashboard components in parallel for efficiency.
 */
async function loadDashboard() {
  await Promise.all([
    loadSummaryCards(),
    loadCategoryChart(),
    loadMonthlySummary()
  ]);
}


// ════════════════════════════════════════════════
// APP INITIALIZATION
// ════════════════════════════════════════════════

/**
 * Called once when the page loads.
 * Sets up event listeners and loads the initial data.
 */
function init() {
  // 1. Initialize tab navigation
  initTabs();

  // 2. Set default date in the transaction form
  setDefaultDate();

  // 3. Attach form submit handlers
  document.getElementById('transaction-form').addEventListener('submit', handleTransactionSubmit);
  document.getElementById('budget-form').addEventListener('submit', handleBudgetSubmit);

  // 4. Load initial dashboard data
  loadDashboard();
}

// Run init after DOM is fully parsed
document.addEventListener('DOMContentLoaded', init);
