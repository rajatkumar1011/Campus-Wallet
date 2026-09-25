'use strict';

/**
 * Campus Wallet - Student Expense Tracker
 * Internal values stored strictly as integer paise (1 INR = 100 paise).
 */

const STORAGE_KEY_EXPENSES = 'campus_wallet_expenses_v1';
const STORAGE_KEY_BUDGETS = 'campus_wallet_budgets_v1';
const MAX_INR_PER_ITEM = 10000000;
const MAX_PAISE_PER_ITEM = MAX_INR_PER_ITEM * 100;
const VALID_CATEGORIES = ['Food', 'Transport', 'Study', 'Other'];

let storageAvailable = true;

// Undo state
let pendingUndo = null; // { expense: {...}, originalIndex: number, timerId: number }

const state = {
  expenses: [],
  budgets: {},
  selectedMonth: '',
  selectedCategory: 'ALL',
  searchQuery: '',
  editingId: null
};

const elements = {
  announcer: document.getElementById('live-announcer'),
  persistentBanner: document.getElementById('persistent-storage-banner'),
  toastBanner: document.getElementById('toast-banner'),
  toastMessage: document.getElementById('toast-message'),
  toastUndoBtn: document.getElementById('toast-undo-btn'),
  activeMonthSelect: document.getElementById('active-month-select'),
  exportCsvBtn: document.getElementById('export-csv-btn'),
  insightText: document.getElementById('insight-text'),
  budgetForm: document.getElementById('budget-form'),
  monthlyBudgetInput: document.getElementById('monthly-budget-input'),
  budgetProgressBar: document.getElementById('budget-progress-bar'),
  budgetProgressTrack: document.getElementById('budget-progress-track'),
  meterPercentage: document.getElementById('meter-percentage'),
  budgetAlertHint: document.getElementById('budget-alert-hint'),
  totalSpentDisplay: document.getElementById('total-spent-display'),
  budgetAmountDisplay: document.getElementById('budget-amount-display'),
  remainingBudgetDisplay: document.getElementById('remaining-budget-display'),
  catSpendCount: document.getElementById('cat-spend-count'),
  segFood: document.getElementById('seg-food'),
  segTransport: document.getElementById('seg-transport'),
  segStudy: document.getElementById('seg-study'),
  segOther: document.getElementById('seg-other'),
  catPctFood: document.getElementById('cat-pct-food'),
  catPctTransport: document.getElementById('cat-pct-transport'),
  catPctStudy: document.getElementById('cat-pct-study'),
  catPctOther: document.getElementById('cat-pct-other'),
  catTotalFood: document.getElementById('cat-total-food'),
  catTotalTransport: document.getElementById('cat-total-transport'),
  catTotalStudy: document.getElementById('cat-total-study'),
  catTotalOther: document.getElementById('cat-total-other'),
  formHeading: document.getElementById('form-heading'),
  formModeBadge: document.getElementById('form-mode-badge'),
  expenseForm: document.getElementById('expense-form'),
  editingExpenseId: document.getElementById('editing-expense-id'),
  expenseDesc: document.getElementById('expense-desc'),
  expenseAmount: document.getElementById('expense-amount'),
  expenseDate: document.getElementById('expense-date'),
  expenseCategory: document.getElementById('expense-category'),
  formSubmitBtn: document.getElementById('form-submit-btn'),
  formCancelBtn: document.getElementById('form-cancel-btn'),
  searchInput: document.getElementById('search-input'),
  searchClearBtn: document.getElementById('search-clear-btn'),
  filterCategory: document.getElementById('filter-category'),
  expenseList: document.getElementById('expense-list'),
  emptyState: document.getElementById('empty-state'),
  emptyStateText: document.getElementById('empty-state-text')
};

// --- Currency Utilities ---

function parseToPaise(val) {
  if (typeof val !== 'string' && typeof val !== 'number') return null;
  const str = String(val).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) return null;

  const [rupeesPart, paisePart = ''] = str.split('.');
  const paddedPaise = paisePart.padEnd(2, '0');

  const rupees = parseInt(rupeesPart, 10);
  const paise = parseInt(paddedPaise, 10);

  if (!Number.isSafeInteger(rupees) || !Number.isSafeInteger(paise)) return null;

  const totalPaise = rupees * 100 + paise;
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0 || totalPaise > MAX_PAISE_PER_ITEM) {
    return null;
  }
  return totalPaise;
}

function formatPaiseToINR(paise) {
  if (!Number.isSafeInteger(paise)) return '₹0.00';
  const isNegative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, '0');
  const formattedRupees = rupees.toLocaleString('en-IN');
  return `${isNegative ? '-' : ''}₹${formattedRupees}.${remainder}`;
}

function paiseToDecimalString(paise) {
  const isNegative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${rupees}.${remainder}`;
}

// --- Notifications & Feedback ---

function announce(message) {
  if (elements.announcer) {
    elements.announcer.textContent = message;
  }
}

function showToast(message, allowUndo = false) {
  announce(message);

  if (elements.toastBanner && elements.toastMessage) {
    elements.toastMessage.textContent = message;
    elements.toastBanner.classList.remove('hidden');

    if (allowUndo) {
      elements.toastUndoBtn.classList.remove('hidden');
    } else {
      elements.toastUndoBtn.classList.add('hidden');
    }

    clearTimeout(elements.toastBanner._timer);
    if (!allowUndo) {
      elements.toastBanner._timer = setTimeout(() => {
        elements.toastBanner.classList.add('hidden');
      }, 5000);
    }
  }
}

function hideToast() {
  if (elements.toastBanner) {
    elements.toastBanner.classList.add('hidden');
    elements.toastUndoBtn.classList.add('hidden');
  }
}

function showPersistentStorageWarning(message) {
  if (elements.persistentBanner) {
    elements.persistentBanner.textContent = message;
    elements.persistentBanner.classList.remove('hidden');
  }
}

// --- Storage & Schema Validation ---

function testStorageAvailability() {
  try {
    const testKey = '__cw_test_storage__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    storageAvailable = true;
  } catch (e) {
    storageAvailable = false;
    showPersistentStorageWarning('Offline storage is disabled or unavailable. Changes will not be saved after closing.');
  }
}

function validateExpenseItem(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.id !== 'string' || item.id.length === 0 || item.id.length > 64) return null;
  if (typeof item.desc !== 'string' || item.desc.trim().length === 0 || item.desc.length > 120) return null;
  if (!Number.isSafeInteger(item.paise) || item.paise <= 0 || item.paise > MAX_PAISE_PER_ITEM) return null;
  if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return null;
  if (!VALID_CATEGORIES.includes(item.category)) return null;

  return {
    id: item.id,
    desc: item.desc.trim(),
    paise: item.paise,
    date: item.date,
    category: item.category
  };
}

function validateBudgets(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;

  for (const [key, val] of Object.entries(raw)) {
    if (/^\d{4}-\d{2}$/.test(key) && Number.isSafeInteger(val) && val >= 0 && val <= MAX_PAISE_PER_ITEM) {
      result[key] = val;
    }
  }
  return result;
}

function saveState() {
  if (!storageAvailable) return false;
  try {
    localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(state.expenses));
    localStorage.setItem(STORAGE_KEY_BUDGETS, JSON.stringify(state.budgets));
    return true;
  } catch (err) {
    showPersistentStorageWarning('Unable to save changes: offline storage is full or restricted.');
    return false;
  }
}

function loadState() {
  state.expenses = [];
  state.budgets = {};

  if (!storageAvailable) return;

  try {
    const rawExpenses = localStorage.getItem(STORAGE_KEY_EXPENSES);
    if (rawExpenses) {
      const parsed = JSON.parse(rawExpenses);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const valid = validateExpenseItem(item);
          if (valid) state.expenses.push(valid);
        }
      }
    }

    const rawBudgets = localStorage.getItem(STORAGE_KEY_BUDGETS);
    if (rawBudgets) {
      state.budgets = validateBudgets(JSON.parse(rawBudgets));
    }
  } catch (err) {
    state.expenses = [];
    state.budgets = {};
    showToast('Stored data was corrupt or unreadable.');
  }
}

// --- Date Helpers ---

function getMonthKeyFromDate(dateStr) {
  return typeof dateStr === 'string' && /^\d{4}-\d{2}/.test(dateStr) ? dateStr.substring(0, 7) : '';
}

function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// --- CSV Export ---

function escapeCsvField(val) {
  const str = String(val == null ? '' : val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function handleExportCSV() {
  const monthKey = state.selectedMonth;
  const monthExpenses = state.expenses
    .filter(item => getMonthKeyFromDate(item.date) === monthKey)
    .sort((a, b) => b.date.localeCompare(a.date));

  const headers = ['Date', 'Description', 'Category', 'Amount (INR)'];
  const rows = [headers.map(escapeCsvField).join(',')];

  for (const item of monthExpenses) {
    const row = [
      escapeCsvField(item.date),
      escapeCsvField(item.desc),
      escapeCsvField(item.category),
      escapeCsvField(paiseToDecimalString(item.paise))
    ];
    rows.push(row.join(','));
  }

  const csvContent = rows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const safeFilename = `campus-wallet-${monthKey || 'expenses'}.csv`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(`Exported ${monthExpenses.length} expense(s) for ${monthKey} to CSV.`);
}

// --- Edit Mode Management ---

function startEditExpense(id) {
  const expense = state.expenses.find(item => item.id === id);
  if (!expense) return;

  state.editingId = id;
  elements.editingExpenseId.value = id;
  elements.expenseDesc.value = expense.desc;
  elements.expenseAmount.value = (expense.paise / 100).toFixed(2);
  elements.expenseDate.value = expense.date;
  elements.expenseCategory.value = expense.category;

  elements.formHeading.textContent = 'Edit Expense';
  elements.formModeBadge.classList.remove('hidden');
  elements.formSubmitBtn.textContent = 'Save Changes';
  elements.formCancelBtn.classList.remove('hidden');

  elements.expenseDesc.focus();
  render();
}

function cancelEditExpense() {
  state.editingId = null;
  elements.editingExpenseId.value = '';
  elements.expenseDesc.value = '';
  elements.expenseAmount.value = '';
  elements.expenseDate.value = getTodayString();
  elements.expenseCategory.value = 'Food';

  elements.formHeading.textContent = 'Add Expense';
  elements.formModeBadge.classList.add('hidden');
  elements.formSubmitBtn.textContent = 'Add Expense';
  elements.formCancelBtn.classList.add('hidden');

  render();
}

// --- Undo Deletion Handling ---

function triggerUndoAction() {
  if (!pendingUndo) return;

  clearTimeout(pendingUndo.timerId);
  const { expense, originalIndex } = pendingUndo;

  // Insert back at original position or end if array shrank
  const targetIndex = Math.min(originalIndex, state.expenses.length);
  state.expenses.splice(targetIndex, 0, expense);

  pendingUndo = null;
  saveState();
  hideToast();
  showToast(`Restored "${expense.desc}".`);
  render();
}

// --- Dynamic Monthly Insight ---

function updateMonthlyInsight(monthExpenses, totalSpentPaise, catTotals) {
  if (monthExpenses.length === 0) {
    elements.insightText.textContent = 'No expenses logged for this month yet.';
    return;
  }

  // Find top spending category
  let topCategory = 'Food';
  let topAmount = -1;

  for (const [cat, amt] of Object.entries(catTotals)) {
    if (amt > topAmount) {
      topAmount = amt;
      topCategory = cat;
    }
  }

  if (topAmount > 0 && totalSpentPaise > 0) {
    const pct = Math.round((topAmount / totalSpentPaise) * 100);
    elements.insightText.textContent = '';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = 'Top spending: ';
    const boldSpan = document.createElement('span');
    boldSpan.className = 'insight-bold';
    boldSpan.textContent = `${topCategory} (${formatPaiseToINR(topAmount)}, ${pct}% of spend)`;
    elements.insightText.appendChild(labelSpan);
    elements.insightText.appendChild(boldSpan);
  } else {
    elements.insightText.textContent = `${monthExpenses.length} expense(s) logged this month.`;
  }
}

// --- Rendering ---

function render() {
  const monthKey = state.selectedMonth;
  const currentBudgetPaise = state.budgets[monthKey] || 0;

  const monthExpenses = state.expenses.filter(item => getMonthKeyFromDate(item.date) === monthKey);

  let totalSpentPaise = 0;
  const catTotals = { Food: 0, Transport: 0, Study: 0, Other: 0 };

  for (const item of monthExpenses) {
    if (Number.isSafeInteger(totalSpentPaise + item.paise)) {
      totalSpentPaise += item.paise;
    }
    if (Object.prototype.hasOwnProperty.call(catTotals, item.category)) {
      catTotals[item.category] += item.paise;
    } else {
      catTotals.Other += item.paise;
    }
  }

  const remainingPaise = currentBudgetPaise - totalSpentPaise;

  // Header display cards
  elements.totalSpentDisplay.textContent = formatPaiseToINR(totalSpentPaise);
  elements.budgetAmountDisplay.textContent = formatPaiseToINR(currentBudgetPaise);
  elements.remainingBudgetDisplay.textContent = formatPaiseToINR(remainingPaise);

  if (remainingPaise < 0) {
    elements.remainingBudgetDisplay.classList.add('stat-negative');
  } else {
    elements.remainingBudgetDisplay.classList.remove('stat-negative');
  }

  // Budget Progress & Overbudget State
  if (currentBudgetPaise > 0) {
    const percent = Math.min(100, Math.round((totalSpentPaise / currentBudgetPaise) * 100));
    elements.meterPercentage.textContent = `${percent}%`;
    elements.budgetProgressBar.style.width = `${percent}%`;
    elements.budgetProgressTrack.setAttribute('aria-valuenow', percent);

    if (totalSpentPaise > currentBudgetPaise) {
      const overBy = totalSpentPaise - currentBudgetPaise;
      elements.budgetProgressBar.classList.add('overbudget');
      elements.budgetAlertHint.className = 'meter-hint overbudget-text';
      elements.budgetAlertHint.textContent = `Warning: Over budget by ${formatPaiseToINR(overBy)}!`;
    } else {
      elements.budgetProgressBar.classList.remove('overbudget');
      elements.budgetAlertHint.className = 'meter-hint';
      elements.budgetAlertHint.textContent = `${formatPaiseToINR(remainingPaise)} remaining under budget.`;
    }
  } else {
    elements.meterPercentage.textContent = '0%';
    elements.budgetProgressBar.style.width = '0%';
    elements.budgetProgressBar.classList.remove('overbudget');
    elements.budgetProgressTrack.setAttribute('aria-valuenow', 0);
    elements.budgetAlertHint.className = 'meter-hint';
    elements.budgetAlertHint.textContent = 'Set a budget to track spending limit.';
  }

  // Category summary counts & breakdown
  elements.catSpendCount.textContent = `${monthExpenses.length} expense${monthExpenses.length === 1 ? '' : 's'}`;

  elements.catTotalFood.textContent = formatPaiseToINR(catTotals.Food);
  elements.catTotalTransport.textContent = formatPaiseToINR(catTotals.Transport);
  elements.catTotalStudy.textContent = formatPaiseToINR(catTotals.Study);
  elements.catTotalOther.textContent = formatPaiseToINR(catTotals.Other);

  const getPct = (amt) => totalSpentPaise > 0 ? Math.round((amt / totalSpentPaise) * 100) : 0;
  const pctFood = getPct(catTotals.Food);
  const pctTransport = getPct(catTotals.Transport);
  const pctStudy = getPct(catTotals.Study);
  const pctOther = getPct(catTotals.Other);

  elements.catPctFood.textContent = `${pctFood}%`;
  elements.catPctTransport.textContent = `${pctTransport}%`;
  elements.catPctStudy.textContent = `${pctStudy}%`;
  elements.catPctOther.textContent = `${pctOther}%`;

  // Update visual segmented CSS bar
  elements.segFood.style.width = `${pctFood}%`;
  elements.segTransport.style.width = `${pctTransport}%`;
  elements.segStudy.style.width = `${pctStudy}%`;
  elements.segOther.style.width = `${pctOther}%`;

  // Update monthly insight line
  updateMonthlyInsight(monthExpenses, totalSpentPaise, catTotals);

  elements.monthlyBudgetInput.value = currentBudgetPaise > 0 ? (currentBudgetPaise / 100).toFixed(2) : '';

  // Filter layered: month + category + search
  const query = state.searchQuery.trim().toLowerCase();
  elements.searchClearBtn.classList.toggle('hidden', query.length === 0);

  const filteredList = monthExpenses.filter(item => {
    const matchCategory = state.selectedCategory === 'ALL' || item.category === state.selectedCategory;
    const matchSearch = query.length === 0 || item.desc.toLowerCase().includes(query);
    return matchCategory && matchSearch;
  });

  filteredList.sort((a, b) => b.date.localeCompare(a.date));

  // Render List safely
  elements.expenseList.innerHTML = '';
  if (filteredList.length === 0) {
    elements.emptyState.classList.remove('hidden');
    if (query.length > 0) {
      elements.emptyStateText.textContent = `No expenses match "${state.searchQuery}".`;
    } else if (state.selectedCategory !== 'ALL') {
      elements.emptyStateText.textContent = `No ${state.selectedCategory} expenses found for this month.`;
    } else {
      elements.emptyStateText.textContent = 'No expenses found for this month.';
    }
  } else {
    elements.emptyState.classList.add('hidden');
    for (const exp of filteredList) {
      const li = document.createElement('li');
      li.className = `expense-item cat-${exp.category} ${exp.id === state.editingId ? 'editing' : ''}`;

      const infoDiv = document.createElement('div');
      infoDiv.className = 'expense-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'expense-title-row';

      const descSpan = document.createElement('span');
      descSpan.className = 'expense-desc';
      descSpan.textContent = exp.desc;

      const catBadge = document.createElement('span');
      catBadge.className = 'expense-cat-badge';
      catBadge.textContent = exp.category;

      titleRow.appendChild(descSpan);
      titleRow.appendChild(catBadge);

      const dateDiv = document.createElement('div');
      dateDiv.className = 'expense-date';
      dateDiv.textContent = exp.date;

      infoDiv.appendChild(titleRow);
      infoDiv.appendChild(dateDiv);

      const actionRow = document.createElement('div');
      actionRow.className = 'expense-action-row';

      const amountSpan = document.createElement('span');
      amountSpan.className = 'expense-amount';
      amountSpan.textContent = formatPaiseToINR(exp.paise);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-action btn-edit';
      editBtn.setAttribute('aria-label', `Edit expense ${exp.desc}`);
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => startEditExpense(exp.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-action btn-danger';
      delBtn.setAttribute('aria-label', `Delete expense ${exp.desc}`);
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => handleDeleteExpense(exp.id));

      actionRow.appendChild(amountSpan);
      actionRow.appendChild(editBtn);
      actionRow.appendChild(delBtn);

      li.appendChild(infoDiv);
      li.appendChild(actionRow);

      elements.expenseList.appendChild(li);
    }
  }
}

// --- Event Handlers ---

function handleFormSubmit(e) {
  e.preventDefault();

  const desc = elements.expenseDesc.value.trim();
  const amountStr = elements.expenseAmount.value.trim();
  const dateStr = elements.expenseDate.value;
  const category = elements.expenseCategory.value;

  if (!desc) {
    showToast('Please enter an expense description.');
    elements.expenseDesc.focus();
    return;
  }

  const paise = parseToPaise(amountStr);
  if (paise === null || paise <= 0) {
    showToast(`Please enter a valid amount between ₹0.01 and ₹${MAX_INR_PER_ITEM.toLocaleString('en-IN')}.`);
    elements.expenseAmount.focus();
    return;
  }

  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    showToast('Please select a valid date.');
    elements.expenseDate.focus();
    return;
  }

  if (!VALID_CATEGORIES.includes(category)) {
    showToast('Please select a valid category.');
    return;
  }

  const expMonth = getMonthKeyFromDate(dateStr);

  if (state.editingId) {
    const index = state.expenses.findIndex(item => item.id === state.editingId);
    if (index === -1) {
      showToast('Expense to update was not found.');
      cancelEditExpense();
      return;
    }

    state.expenses[index].desc = desc;
    state.expenses[index].paise = paise;
    state.expenses[index].date = dateStr;
    state.expenses[index].category = category;

    if (state.selectedMonth !== expMonth) {
      state.selectedMonth = expMonth;
      elements.activeMonthSelect.value = expMonth;
    }

    saveState();
    showToast(`Updated "${desc}" (${formatPaiseToINR(paise)}).`);
    cancelEditExpense();
  } else {
    const newExpense = {
      id: 'exp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      desc,
      paise,
      date: dateStr,
      category
    };

    state.expenses.push(newExpense);

    if (state.selectedMonth !== expMonth) {
      state.selectedMonth = expMonth;
      elements.activeMonthSelect.value = expMonth;
    }

    saveState();

    const isHiddenByCat = state.selectedCategory !== 'ALL' && state.selectedCategory !== category;
    const isHiddenBySearch = state.searchQuery && !desc.toLowerCase().includes(state.searchQuery.toLowerCase());

    if (isHiddenByCat || isHiddenBySearch) {
      showToast(`Added "${desc}" (${formatPaiseToINR(paise)}). Note: Hidden by current filter.`);
    } else {
      showToast(`Added "${desc}" for ${formatPaiseToINR(paise)}.`);
    }

    elements.expenseDesc.value = '';
    elements.expenseAmount.value = '';
    elements.expenseDesc.focus();
    render();
  }
}

function handleDeleteExpense(id) {
  const index = state.expenses.findIndex(item => item.id === id);
  if (index === -1) return;

  // Clear previous pending undo if active
  if (pendingUndo) {
    clearTimeout(pendingUndo.timerId);
    pendingUndo = null;
  }

  const [deletedExpense] = state.expenses.splice(index, 1);

  if (state.editingId === id) {
    cancelEditExpense();
  }

  saveState();
  render();

  // Create new undo window for 8 seconds
  const timerId = setTimeout(() => {
    if (pendingUndo && pendingUndo.expense.id === deletedExpense.id) {
      pendingUndo = null;
      hideToast();
    }
  }, 8000);

  pendingUndo = {
    expense: deletedExpense,
    originalIndex: index,
    timerId
  };

  showToast(`Deleted "${deletedExpense.desc}".`, true);
}

function handleSetBudget(e) {
  e.preventDefault();
  const rawValue = elements.monthlyBudgetInput.value.trim();
  const paise = parseToPaise(rawValue);

  if (paise === null) {
    showToast(`Please enter a valid budget up to ₹${MAX_INR_PER_ITEM.toLocaleString('en-IN')}.`);
    return;
  }

  const monthKey = state.selectedMonth;
  state.budgets[monthKey] = paise;

  saveState();
  showToast(`Budget for ${monthKey} set to ${formatPaiseToINR(paise)}.`);
  render();
}

function handleMonthChange(e) {
  const newMonth = e.target.value;
  if (newMonth && /^\d{4}-\d{2}$/.test(newMonth)) {
    state.selectedMonth = newMonth;
    render();
  }
}

function handleCategoryFilterChange(e) {
  state.selectedCategory = e.target.value;
  render();
}

function handleSearchInput(e) {
  state.searchQuery = e.target.value;
  render();
}

function handleSearchClear() {
  state.searchQuery = '';
  elements.searchInput.value = '';
  elements.searchInput.focus();
  render();
}

// --- Initialization ---

function init() {
  testStorageAvailability();
  loadState();

  const todayStr = getTodayString();
  const currentMonthKey = getMonthKeyFromDate(todayStr);

  state.selectedMonth = currentMonthKey;
  elements.activeMonthSelect.value = currentMonthKey;
  elements.expenseDate.value = todayStr;

  elements.expenseForm.addEventListener('submit', handleFormSubmit);
  elements.formCancelBtn.addEventListener('click', cancelEditExpense);
  elements.budgetForm.addEventListener('submit', handleSetBudget);
  elements.activeMonthSelect.addEventListener('change', handleMonthChange);
  elements.exportCsvBtn.addEventListener('click', handleExportCSV);
  elements.filterCategory.addEventListener('change', handleCategoryFilterChange);
  elements.searchInput.addEventListener('input', handleSearchInput);
  elements.searchClearBtn.addEventListener('click', handleSearchClear);
  elements.toastUndoBtn.addEventListener('click', triggerUndoAction);

  render();
}

document.addEventListener('DOMContentLoaded', init);