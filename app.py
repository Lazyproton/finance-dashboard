"""
FinTrack - Personal Finance Dashboard
Flask backend that serves the frontend and handles all API routes.
Uses SQLite for data storage.
"""

from flask import Flask, jsonify, request, send_from_directory
import sqlite3
import os
from datetime import datetime

# Initialize the Flask app
app = Flask(__name__, static_folder='static', static_url_path='/static')

# Path to the SQLite database file
DB_PATH = os.path.join(os.path.dirname(__file__), 'fintrack.db')


# ──────────────────────────────────────────────
# DATABASE HELPERS
# ──────────────────────────────────────────────

def get_db():
    """
    Opens a connection to the SQLite database and returns it.
    The row_factory setting lets us access columns by name (like a dict).
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # Rows behave like dictionaries
    return conn


def init_db():
    """
    Creates the database tables if they don't already exist.
    Called once when the app starts.

    Tables:
      - transactions: stores every income/expense entry
      - budget_limits: stores per-category monthly budget limits
    """
    conn = get_db()
    cursor = conn.cursor()

    # Create the transactions table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS transactions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            amount      REAL    NOT NULL,
            type        TEXT    NOT NULL CHECK(type IN ('Income', 'Expense')),
            category    TEXT    NOT NULL,
            date        TEXT    NOT NULL,
            description TEXT,
            note        TEXT,
            created_at  TEXT    DEFAULT (datetime('now'))
        )
    ''')

    # Create the budget_limits table (one row per category)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS budget_limits (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            category    TEXT    NOT NULL UNIQUE,
            limit_amount REAL   NOT NULL DEFAULT 0
        )
    ''')

    conn.commit()
    conn.close()


# ──────────────────────────────────────────────
# FRONTEND ROUTE
# ──────────────────────────────────────────────

@app.route('/')
def index():
    """
    Serves the main HTML page (index.html) from the templates folder.
    """
    return send_from_directory('templates', 'index.html')


# ──────────────────────────────────────────────
# TRANSACTIONS API
# ──────────────────────────────────────────────

@app.route('/api/transactions', methods=['GET'])
def get_transactions():
    """
    Returns all transactions from the database, ordered by date (newest first).
    Supports optional query parameters for date-range filtering:
      - start_date (YYYY-MM-DD)
      - end_date   (YYYY-MM-DD)
    """
    start_date = request.args.get('start_date')
    end_date   = request.args.get('end_date')

    conn = get_db()
    cursor = conn.cursor()

    # Build the query dynamically based on filter params
    query = "SELECT * FROM transactions WHERE 1=1"
    params = []

    if start_date:
        query += " AND date >= ?"
        params.append(start_date)
    if end_date:
        query += " AND date <= ?"
        params.append(end_date)

    query += " ORDER BY date DESC, created_at DESC"

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    # Convert each row to a plain dictionary so Flask can JSON-encode it
    transactions = [dict(row) for row in rows]
    return jsonify(transactions)


@app.route('/api/transactions', methods=['POST'])
def add_transaction():
    """
    Adds a new transaction to the database.
    Expects a JSON body with: amount, type, category, date, description, note.
    Returns the newly created transaction.
    """
    data = request.get_json()

    # Validate required fields
    required = ['amount', 'type', 'category', 'date']
    for field in required:
        if not data.get(field):
            return jsonify({'error': f'Missing required field: {field}'}), 400

    # Make sure amount is a positive number
    try:
        amount = float(data['amount'])
        if amount <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({'error': 'Amount must be a positive number'}), 400

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        INSERT INTO transactions (amount, type, category, date, description, note)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (
        amount,
        data['type'],
        data['category'],
        data['date'],
        data.get('description', ''),
        data.get('note', '')
    ))

    new_id = cursor.lastrowid
    conn.commit()

    # Fetch and return the newly created row
    cursor.execute("SELECT * FROM transactions WHERE id = ?", (new_id,))
    new_row = dict(cursor.fetchone())
    conn.close()

    return jsonify(new_row), 201


@app.route('/api/transactions/<int:transaction_id>', methods=['DELETE'])
def delete_transaction(transaction_id):
    """
    Deletes a single transaction by its ID.
    Returns a success message or 404 if not found.
    """
    conn = get_db()
    cursor = conn.cursor()

    # Check if it exists first
    cursor.execute("SELECT id FROM transactions WHERE id = ?", (transaction_id,))
    if not cursor.fetchone():
        conn.close()
        return jsonify({'error': 'Transaction not found'}), 404

    cursor.execute("DELETE FROM transactions WHERE id = ?", (transaction_id,))
    conn.commit()
    conn.close()

    return jsonify({'message': 'Transaction deleted successfully'})


# ──────────────────────────────────────────────
# SUMMARY & ANALYTICS API
# ──────────────────────────────────────────────

@app.route('/api/summary', methods=['GET'])
def get_summary():
    """
    Returns high-level summary figures:
      - total_income: sum of all income transactions
      - total_expenses: sum of all expense transactions
      - balance: income minus expenses
    """
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'Income'")
    total_income = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'Expense'")
    total_expenses = cursor.fetchone()[0]

    conn.close()

    return jsonify({
        'total_income':   round(total_income, 2),
        'total_expenses': round(total_expenses, 2),
        'balance':        round(total_income - total_expenses, 2)
    })


@app.route('/api/category-spending', methods=['GET'])
def get_category_spending():
    """
    Returns the total spending (Expense only) grouped by category.
    Used to power the bar chart on the dashboard.
    Also joins budget limits so the frontend can compare spending vs limit.
    """
    conn = get_db()
    cursor = conn.cursor()

    # Get total spending per expense category
    cursor.execute('''
        SELECT category, COALESCE(SUM(amount), 0) AS total
        FROM transactions
        WHERE type = 'Expense'
        GROUP BY category
        ORDER BY total DESC
    ''')
    spending_rows = cursor.fetchall()

    # Get all budget limits
    cursor.execute("SELECT category, limit_amount FROM budget_limits")
    limit_rows = cursor.fetchall()
    limits = {row['category']: row['limit_amount'] for row in limit_rows}

    conn.close()

    # Merge spending data with budget limits
    result = []
    for row in spending_rows:
        cat = row['category']
        spent = round(row['total'], 2)
        limit = limits.get(cat, 0)
        result.append({
            'category':     cat,
            'total':        spent,
            'limit':        limit,
            'over_budget':  limit > 0 and spent > limit
        })

    return jsonify(result)


@app.route('/api/monthly-summary', methods=['GET'])
def get_monthly_summary():
    """
    Returns a month-by-month breakdown with:
      - month (YYYY-MM)
      - total_income
      - total_expenses
      - net_balance (income - expenses)
    Ordered by month descending (newest first).
    """
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        SELECT
            strftime('%Y-%m', date) AS month,
            COALESCE(SUM(CASE WHEN type = 'Income'  THEN amount ELSE 0 END), 0) AS total_income,
            COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS total_expenses
        FROM transactions
        GROUP BY month
        ORDER BY month DESC
    ''')
    rows = cursor.fetchall()
    conn.close()

    result = []
    for row in rows:
        income   = round(row['total_income'], 2)
        expenses = round(row['total_expenses'], 2)
        result.append({
            'month':          row['month'],
            'total_income':   income,
            'total_expenses': expenses,
            'net_balance':    round(income - expenses, 2)
        })

    return jsonify(result)


# ──────────────────────────────────────────────
# BUDGET LIMITS API
# ──────────────────────────────────────────────

@app.route('/api/budget-limits', methods=['GET'])
def get_budget_limits():
    """
    Returns all budget limits stored in the database.
    Each row has: id, category, limit_amount.
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM budget_limits ORDER BY category")
    rows = cursor.fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows])


@app.route('/api/budget-limits', methods=['POST'])
def set_budget_limit():
    """
    Creates or updates the budget limit for a given category.
    Expects JSON: { category, limit_amount }
    Uses INSERT OR REPLACE so it works for both new and existing limits.
    """
    data = request.get_json()

    if not data.get('category') or data.get('limit_amount') is None:
        return jsonify({'error': 'category and limit_amount are required'}), 400

    try:
        limit_amount = float(data['limit_amount'])
        if limit_amount < 0:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({'error': 'limit_amount must be a non-negative number'}), 400

    conn = get_db()
    cursor = conn.cursor()

    # INSERT OR REPLACE handles both create and update in one query
    cursor.execute('''
        INSERT INTO budget_limits (category, limit_amount)
        VALUES (?, ?)
        ON CONFLICT(category) DO UPDATE SET limit_amount = excluded.limit_amount
    ''', (data['category'], limit_amount))

    conn.commit()
    conn.close()

    return jsonify({'message': f"Budget limit for '{data['category']}' set to ₹{limit_amount:.2f}"}), 200


# ──────────────────────────────────────────────
# ENTRY POINT
# ──────────────────────────────────────────────

if __name__ == '__main__':
    # Initialize the database tables before starting the server
    init_db()
    print("✅ Database initialized. Starting FinTrack server...")
    app.run(debug=True, port=5000)
