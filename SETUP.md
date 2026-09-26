# StreetSmart Backend — Setup Guide

## Prerequisites

- **Node.js v20.x** (use `nvm install 20 && nvm use 20`)
- npm
- Git

## First-time Setup

```bash
git clone https://github.com/Xolo-D/streetsmart-backend.git
cd streetsmart-backend
nvm use 20
npm install
npm rebuild better-sqlite3
# create .env with JWT_SECRET, PORT, WEATHER_API_KEY
ln -s ../streetsmart-frontend ../streetsmart-fresh
node export-data.js
node seed.js
node migrate-stock.js
node migrate-suppliers.js
node create-prediction-table.js
node create-demo-users.js
node fix-vendors.js
node server.js
```

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@streetsmart.co.za | admin123 |
| Vendor | vendor@streetsmart.co.za | vendor123 |
| Supplier | supplier@streetsmart.co.za | supplier123 |
