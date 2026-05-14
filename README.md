# Production Management System

Frontend-only static demo for Wax Entries, Casting Process, Metal Receiving, Inventory, Role/User Management, and Audit Logs.

## Run Locally

Open `index.html` directly in a browser.

For a local static server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Default demo login:

```text
Email: admin@example.com
Password: Admin@123
```

## Static Deployment

Deploy the project as static files. Include:

- `index.html`
- `styles.css`
- `app.js`
- `auth.js`
- `rbac.js`
- `kanban.js`
- `inventory.js`
- `README.md`
- `.gitignore`

No separate application server is required for this demo.

## Data Storage

All data is stored in the browser using `localStorage`, including users, roles, sessions, wax entries, Kanban workflow data, inventory, and audit logs.

Clearing browser storage will remove the demo data.
