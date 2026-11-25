# Stocks Scuola Web App

A responsive web adaptation of the Stocks Scuola iOS interface. It includes a dashboard, subject search and sorting, grade history, trend charts, a next-grade planner, Italian/English switching, local CSV import, and a same-origin Node.js route for Classeviva sign-in and grade refresh.

## Run locally

Use Node.js 20 or newer. From this folder, run:

```sh
npm start
```

Then open `http://localhost:3000`. Opening `index.html` directly or serving it from a static-only host will still show the demo and CSV features, but Classeviva sign-in will not work because `/api/login` and `/api/grades` need the Node server.

## Publish

Upload `WebApp` to a Git repository and deploy it as a **Node.js web service**, setting its root directory to `WebApp` and its start command to `npm start`. Use a host that provides HTTPS. Static-only hosting such as GitHub Pages cannot run the API routes required for account sign-in.

## Import grades

Choose **Importa voti / Import grades** and select a UTF-8 CSV file. Required column headers are `subject`, `date`, and `grade`; `assessment` is optional. Italian headers `materia`, `data`, `voto`, and `verifica` are also accepted. Dates must use `YYYY-MM-DD`, and grades must be numeric from 0 to 10. Example:

```csv
subject,date,grade,assessment
Matematica,2026-11-05,8,Geometria
Italiano,2026-11-11,7.5,Letteratura
```

Imported data is stored in the current browser's local storage. It is not uploaded. **Ripristina demo / Reset demo** returns to the built-in example data.

## Classeviva connection

The sign-in form sends credentials to this app's same-origin Node server, which then uses the same Classeviva login and grades routes as the existing iOS app. The server does not write or log credentials. The browser keeps them in page memory only while the tab is open so the refresh button can sign in again; closing or reloading the tab clears them. Grades are saved in the browser's local storage. Use your own account, keep the service private, and never commit credentials to Git. Deploy only over HTTPS. The Classeviva endpoints used here are not a documented public integration; they can change or stop working. Check with Spaggiari or your school before sharing this service with other students.

## Files

- `index.html` — app structure and account dialog
- `styles.css` — responsive dark interface
- `app.js` — calculations, charts, CSV import, language, sign-in form and local storage
- `server.js` — same-origin sign-in and grade relay; no credential persistence
- `package.json` — Node start command and runtime version
