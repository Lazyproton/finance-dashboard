# Personal Finance Dashboard

A web app I built to track my own college expenses after realizing 
I had no idea where my money was going each month. It lets me log 
income and expenses, see category-wise spending, and set budget 
limits so I don't overspend on food and transport.

## Features
- Add income/expense transactions with category, date, and description
- Optional "note to self" field with emoji support
- Dashboard summary cards showing total income, expenses, and balance
- Category-wise bar chart (Chart.js) with budget limit alerts
- Monthly summary table with income vs expenses per month
- Transaction history with date range filter and delete option
- Budget limit per category — highlights in red if exceeded

## Tech Stack
- Frontend: HTML, CSS, JavaScript
- Backend: Python Flask
- Database: SQLite

## How to Run Locally
1. Clone the repo
   git clone https://github.com/Lazyproton/finance-dashboard.git

2. Install dependencies
   pip install flask

3. Run the app
   python app.py

4. Open browser and go to
   http://localhost:5000

## What I Learned
- Connecting a Flask backend to SQLite and handling database 
  connections correctly across requests
- Building REST API routes in Flask and consuming them from 
  vanilla JavaScript using fetch()
- Rendering dynamic charts with Chart.js based on live database data
